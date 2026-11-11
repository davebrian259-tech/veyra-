//! UNDO — milestone escrow and conditional payments for Veyra.
//!
//! The contract holds funds before release and enforces the agreement rules on its own.
//! Nothing off-chain (including Veyra's AI agent or backend) can release funds: a milestone
//! is paid only when
//!   * the `approver` (the human owner) or an authorised `reviewer` accepts it, or
//!   * the provider submitted evidence and the review period lapsed without a response, or
//!   * the dispute `arbiter` resolves a dispute.
//!
//! Funds that were never earned are refunded to `refund_to` after the deadline. A finished
//! transfer cannot be reversed: protection exists only while funds sit in escrow.
//!
//! Every state transition emits a NEP-297 event (`standard: "veyra_escrow"`) for indexers.

// near-sdk schedules a Promise when it is dropped, so statement-position promises are intentional.
#![allow(unused_must_use)]

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

pub const EVENT_STANDARD: &str = "veyra_escrow";
pub const EVENT_VERSION: &str = "1.0.0";
pub const MAX_MILESTONES: usize = 20;
pub const MAX_EVIDENCE_PER_MILESTONE: usize = 10;
pub const MAX_TEXT: usize = 256;
pub const MAX_HASH: usize = 128;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Asset {
    /// Native NEAR, amounts in yoctoNEAR.
    Native,
    /// A NEP-141 fungible token, amounts in the token's atomic units.
    Ft { contract_id: AccountId },
}

impl Asset {
    fn key(&self) -> String {
        match self {
            Asset::Native => "native".to_string(),
            Asset::Ft { contract_id } => format!("ft:{contract_id}"),
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EscrowStatus {
    AwaitingFunding,
    Active,
    Disputed,
    Completed,
    Refunded,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MilestoneStatus {
    Pending,
    Submitted,
    Rejected,
    Released,
    Refunded,
    Resolved,
}

impl MilestoneStatus {
    fn is_final(&self) -> bool {
        matches!(
            self,
            MilestoneStatus::Released | MilestoneStatus::Refunded | MilestoneStatus::Resolved
        )
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Evidence {
    /// Hash of the off-chain evidence bundle, e.g. `sha256:<hex>`.
    pub hash: String,
    /// Where the evidence can be fetched (IPFS, HTTPS, ...). Optional.
    pub uri: Option<String>,
    pub submitted_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub title: String,
    pub amount: U128,
    pub status: MilestoneStatus,
    pub evidence: Vec<Evidence>,
    pub submitted_at_ns: Option<U64>,
    pub rejection_reason: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MilestoneInput {
    pub title: String,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub opened_by: AccountId,
    pub milestone_index: Option<u32>,
    pub reason: String,
    pub opened_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: U64,
    /// Account that created and funds the escrow (may be an agent account).
    pub payer: AccountId,
    /// Account that may accept/reject work. Usually the human owner. Defaults to `payer`.
    pub approver: AccountId,
    pub provider: AccountId,
    /// Optional authorised reviewer that may also accept or reject work.
    pub reviewer: Option<AccountId>,
    /// Resolves disputes. Falls back to the contract owner when unset.
    pub arbiter: Option<AccountId>,
    /// Where unearned funds go.
    pub refund_to: AccountId,
    pub asset: Asset,
    pub total: U128,
    pub funded: U128,
    pub released: U128,
    pub refunded: U128,
    pub milestones: Vec<Milestone>,
    pub deadline_ns: U64,
    /// After a submission, the approver has this long to respond before the provider can claim.
    /// Zero disables auto-release.
    pub review_period_ns: U64,
    /// Hash of the off-chain agreement (completion conditions, evidence requirements, dispute
    /// rules). Lets both parties prove which terms they agreed to.
    pub terms_hash: String,
    pub status: EscrowStatus,
    pub dispute: Option<Dispute>,
    pub created_at_ns: U64,
}

impl Escrow {
    fn outstanding(&self) -> u128 {
        self.funded.0 - self.released.0 - self.refunded.0
    }
    fn can_review(&self, who: &AccountId) -> bool {
        &self.approver == who || self.reviewer.as_ref() == Some(who)
    }
    fn settle_status_if_done(&mut self) {
        if self.milestones.iter().all(|m| m.status.is_final()) {
            self.status = if self.released.0 == 0 {
                EscrowStatus::Refunded
            } else {
                EscrowStatus::Completed
            };
        }
    }
}

#[near(serializers = [json])]
pub struct FtOnTransferMsg {
    pub escrow_id: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    next_id: u64,
    escrows: IterableMap<u64, Escrow>,
    by_account: LookupMap<AccountId, Vec<u64>>,
    /// Payouts whose transfer failed (e.g. receiver not registered on the FT contract).
    /// Key: "<account>|<asset key>". The receiver can retry with `withdraw_unclaimed`.
    unclaimed: LookupMap<String, (Asset, u128)>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let payload = near_sdk::serde_json::json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

fn check_text(label: &str, value: &str, max: usize) {
    require!(!value.is_empty(), format!("{label} must not be empty"));
    require!(value.len() <= max, format!("{label} is too long"));
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            next_id: 0,
            escrows: IterableMap::new(b"e"),
            by_account: LookupMap::new(b"a"),
            unclaimed: LookupMap::new(b"u"),
        }
    }

    // ------------------------------------------------------------------ create & fund

    /// Creates an escrow. Attach storage cost; for `Native` escrows any amount attached beyond
    /// storage funds the escrow (excess above `total` is returned).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_escrow(
        &mut self,
        provider: AccountId,
        asset: Asset,
        milestones: Vec<MilestoneInput>,
        deadline_ns: U64,
        terms_hash: String,
        review_period_ns: Option<U64>,
        approver: Option<AccountId>,
        reviewer: Option<AccountId>,
        arbiter: Option<AccountId>,
        refund_to: Option<AccountId>,
    ) -> U64 {
        let payer = env::predecessor_account_id();
        let now = env::block_timestamp();
        require!(provider != payer, "provider cannot be the payer");
        require!(!milestones.is_empty(), "at least one milestone is required");
        require!(milestones.len() <= MAX_MILESTONES, "too many milestones");
        require!(deadline_ns.0 > now, "deadline must be in the future");
        check_text("terms_hash", &terms_hash, MAX_HASH);
        let approver = approver.unwrap_or_else(|| payer.clone());
        require!(approver != provider, "provider cannot approve its own work");
        if let Some(r) = &reviewer {
            require!(r != &provider, "provider cannot review its own work");
        }
        if let Some(a) = &arbiter {
            require!(a != &provider, "provider cannot arbitrate");
        }

        let mut total: u128 = 0;
        let ms: Vec<Milestone> = milestones
            .into_iter()
            .map(|m| {
                check_text("milestone title", &m.title, MAX_TEXT);
                require!(m.amount.0 > 0, "milestone amount must be positive");
                total = total.checked_add(m.amount.0).expect("overflow");
                Milestone {
                    title: m.title,
                    amount: m.amount,
                    status: MilestoneStatus::Pending,
                    evidence: vec![],
                    submitted_at_ns: None,
                    rejection_reason: None,
                }
            })
            .collect();

        let storage_before = env::storage_usage();
        let id = self.next_id;
        self.next_id += 1;
        let escrow = Escrow {
            id: U64(id),
            payer: payer.clone(),
            approver: approver.clone(),
            provider: provider.clone(),
            reviewer: reviewer.clone(),
            arbiter,
            refund_to: refund_to.unwrap_or_else(|| payer.clone()),
            asset: asset.clone(),
            total: U128(total),
            funded: U128(0),
            released: U128(0),
            refunded: U128(0),
            milestones: ms,
            deadline_ns,
            review_period_ns: review_period_ns.unwrap_or(U64(0)),
            terms_hash,
            status: EscrowStatus::AwaitingFunding,
            dispute: None,
            created_at_ns: U64(now),
        };
        self.escrows.insert(id, escrow);
        let mut parties = vec![payer.clone(), approver, provider];
        if let Some(r) = reviewer {
            parties.push(r);
        }
        parties.sort();
        parties.dedup();
        for p in parties {
            let mut list = self.by_account.get(&p).cloned().unwrap_or_default();
            list.push(id);
            self.by_account.insert(p, list);
        }
        self.escrows.flush();
        self.by_account.flush();
        let storage_cost = env::storage_byte_cost()
            .saturating_mul((env::storage_usage() - storage_before) as u128)
            .as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= storage_cost,
            format!("attach at least {storage_cost} yoctoNEAR for storage")
        );

        emit(
            "escrow_created",
            near_sdk::serde_json::json!({
                "escrow_id": U64(id),
                "payer": payer,
                "provider": self.escrows.get(&id).unwrap().provider,
                "asset": asset,
                "total": U128(total),
                "deadline_ns": deadline_ns,
            }),
        );

        let remainder = attached - storage_cost;
        if remainder > 0 {
            match asset {
                Asset::Native => {
                    self.apply_funding(id, &payer, remainder, true);
                }
                Asset::Ft { .. } => {
                    Promise::new(payer).transfer(NearToken::from_yoctonear(remainder));
                }
            }
        }
        U64(id)
    }

    /// Adds native NEAR funding to an escrow. Only the payer may fund.
    #[payable]
    pub fn deposit(&mut self, escrow_id: U64) {
        let payer = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach the amount to deposit");
        let escrow = self.get(escrow_id.0);
        require!(escrow.asset == Asset::Native, "escrow is not denominated in NEAR");
        self.apply_funding(escrow_id.0, &payer, amount, true);
    }

    /// NEP-141 receiver. `msg` must be `{"escrow_id":"<id>"}`. Unused tokens are returned.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let parsed: FtOnTransferMsg =
            near_sdk::serde_json::from_str(&msg).expect("msg must be {\"escrow_id\":\"<id>\"}");
        let escrow = self.get(parsed.escrow_id.0);
        require!(
            escrow.asset == Asset::Ft { contract_id: token },
            "token does not match escrow asset"
        );
        let unused = self.apply_funding(parsed.escrow_id.0, &sender_id, amount.0, false);
        PromiseOrValue::Value(U128(unused))
    }

    // ------------------------------------------------------------------ work lifecycle

    /// Provider submits a reference to completion evidence. Attach storage for the evidence.
    #[payable]
    pub fn submit_evidence(
        &mut self,
        escrow_id: U64,
        milestone_index: u32,
        evidence_hash: String,
        evidence_uri: Option<String>,
    ) {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp();
        check_text("evidence_hash", &evidence_hash, MAX_HASH);
        if let Some(uri) = &evidence_uri {
            check_text("evidence_uri", uri, MAX_TEXT);
        }
        let storage_before = env::storage_usage();
        let mut escrow = self.get(escrow_id.0);
        require!(caller == escrow.provider, "only the provider can submit evidence");
        require!(escrow.status == EscrowStatus::Active, "escrow is not active");
        require!(now <= escrow.deadline_ns.0, "deadline has passed");
        let m = milestone_mut(&mut escrow, milestone_index);
        require!(
            matches!(
                m.status,
                MilestoneStatus::Pending | MilestoneStatus::Rejected | MilestoneStatus::Submitted
            ),
            "milestone is not open for submissions"
        );
        require!(
            m.evidence.len() < MAX_EVIDENCE_PER_MILESTONE,
            "too much evidence on this milestone"
        );
        m.evidence.push(Evidence {
            hash: evidence_hash.clone(),
            uri: evidence_uri.clone(),
            submitted_at_ns: U64(now),
        });
        m.status = MilestoneStatus::Submitted;
        m.submitted_at_ns = Some(U64(now));
        m.rejection_reason = None;
        self.escrows.insert(escrow_id.0, escrow);
        self.escrows.flush();
        self.charge_storage(storage_before, &caller);
        emit(
            "evidence_submitted",
            near_sdk::serde_json::json!({
                "escrow_id": escrow_id, "milestone_index": milestone_index,
                "evidence_hash": evidence_hash, "evidence_uri": evidence_uri,
            }),
        );
    }

    /// Approver or reviewer accepts a submitted milestone; payment is released to the provider.
    pub fn accept_milestone(&mut self, escrow_id: U64, milestone_index: u32) -> Promise {
        let caller = env::predecessor_account_id();
        let escrow = self.get(escrow_id.0);
        require!(escrow.can_review(&caller), "only the approver or reviewer can accept");
        self.release(escrow_id.0, milestone_index, "accepted", caller)
    }

    /// Approver or reviewer rejects a submission. The provider may resubmit before the deadline.
    pub fn reject_milestone(&mut self, escrow_id: U64, milestone_index: u32, reason: String) {
        let caller = env::predecessor_account_id();
        check_text("reason", &reason, MAX_TEXT);
        let mut escrow = self.get(escrow_id.0);
        require!(escrow.can_review(&caller), "only the approver or reviewer can reject");
        require!(escrow.status == EscrowStatus::Active, "escrow is not active");
        let m = milestone_mut(&mut escrow, milestone_index);
        require!(m.status == MilestoneStatus::Submitted, "milestone was not submitted");
        m.status = MilestoneStatus::Rejected;
        m.rejection_reason = Some(reason.clone());
        self.escrows.insert(escrow_id.0, escrow);
        emit(
            "milestone_rejected",
            near_sdk::serde_json::json!({
                "escrow_id": escrow_id, "milestone_index": milestone_index,
                "by": caller, "reason": reason,
            }),
        );
    }

    /// Provider claims a submitted milestone when the review period passed with no response.
    pub fn claim_after_review_period(&mut self, escrow_id: U64, milestone_index: u32) -> Promise {
        let caller = env::predecessor_account_id();
        let escrow = self.get(escrow_id.0);
        require!(caller == escrow.provider, "only the provider can claim");
        require!(escrow.review_period_ns.0 > 0, "auto-release is disabled for this escrow");
        let m = escrow.milestones.get(milestone_index as usize).expect("no such milestone");
        require!(m.status == MilestoneStatus::Submitted, "milestone was not submitted");
        let submitted = m.submitted_at_ns.expect("missing submission time").0;
        require!(
            env::block_timestamp() >= submitted + escrow.review_period_ns.0,
            "review period has not elapsed"
        );
        self.release(escrow_id.0, milestone_index, "review_period_elapsed", caller)
    }

    /// Opens a dispute. Freezes all releases and refunds until the arbiter resolves it.
    pub fn open_dispute(&mut self, escrow_id: U64, milestone_index: Option<u32>, reason: String) {
        let caller = env::predecessor_account_id();
        check_text("reason", &reason, MAX_TEXT);
        let mut escrow = self.get(escrow_id.0);
        require!(
            escrow.can_review(&caller) || caller == escrow.provider || caller == escrow.payer,
            "only a party to the escrow can open a dispute"
        );
        require!(escrow.status == EscrowStatus::Active, "escrow is not active");
        if let Some(i) = milestone_index {
            require!((i as usize) < escrow.milestones.len(), "no such milestone");
        }
        escrow.status = EscrowStatus::Disputed;
        escrow.dispute = Some(Dispute {
            opened_by: caller.clone(),
            milestone_index,
            reason: reason.clone(),
            opened_at_ns: U64(env::block_timestamp()),
        });
        self.escrows.insert(escrow_id.0, escrow);
        emit(
            "dispute_opened",
            near_sdk::serde_json::json!({
                "escrow_id": escrow_id, "by": caller,
                "milestone_index": milestone_index, "reason": reason,
            }),
        );
    }

    /// Arbiter splits the outstanding funds: `provider_amount` to the provider, rest refunded.
    pub fn resolve_dispute(&mut self, escrow_id: U64, provider_amount: U128, note: String) {
        let caller = env::predecessor_account_id();
        check_text("note", &note, MAX_TEXT);
        let mut escrow = self.get(escrow_id.0);
        let arbiter = escrow.arbiter.clone().unwrap_or_else(|| self.owner.clone());
        require!(caller == arbiter, "only the arbiter can resolve disputes");
        require!(escrow.status == EscrowStatus::Disputed, "escrow is not disputed");
        let outstanding = escrow.outstanding();
        require!(provider_amount.0 <= outstanding, "provider_amount exceeds outstanding funds");
        let refund = outstanding - provider_amount.0;
        escrow.released = U128(escrow.released.0 + provider_amount.0);
        escrow.refunded = U128(escrow.refunded.0 + refund);
        for m in escrow.milestones.iter_mut() {
            if !m.status.is_final() {
                m.status = MilestoneStatus::Resolved;
            }
        }
        escrow.status = if provider_amount.0 == 0 && escrow.released.0 == 0 {
            EscrowStatus::Refunded
        } else {
            EscrowStatus::Completed
        };
        let (provider, refund_to, asset) =
            (escrow.provider.clone(), escrow.refund_to.clone(), escrow.asset.clone());
        self.escrows.insert(escrow_id.0, escrow);
        emit(
            "dispute_resolved",
            near_sdk::serde_json::json!({
                "escrow_id": escrow_id, "by": caller, "provider_amount": provider_amount,
                "refund_amount": U128(refund), "note": note,
            }),
        );
        if provider_amount.0 > 0 {
            self.payout(escrow_id.0, provider, asset.clone(), provider_amount.0);
        }
        if refund > 0 {
            self.payout(escrow_id.0, refund_to, asset, refund);
        }
    }

    /// After the deadline, refunds every milestone that was never submitted (or was rejected).
    /// Anyone may call it; funds only ever go to `refund_to`.
    pub fn refund_expired(&mut self, escrow_id: U64) {
        let mut escrow = self.get(escrow_id.0);
        require!(env::block_timestamp() > escrow.deadline_ns.0, "deadline has not passed");
        require!(
            escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::AwaitingFunding,
            "escrow is not refundable"
        );
        let refund = if escrow.status == EscrowStatus::AwaitingFunding {
            for m in escrow.milestones.iter_mut() {
                m.status = MilestoneStatus::Refunded;
            }
            escrow.status = EscrowStatus::Cancelled;
            escrow.outstanding()
        } else {
            let mut sum = 0u128;
            for m in escrow.milestones.iter_mut() {
                if matches!(m.status, MilestoneStatus::Pending | MilestoneStatus::Rejected) {
                    m.status = MilestoneStatus::Refunded;
                    sum += m.amount.0;
                }
            }
            escrow.settle_status_if_done();
            sum
        };
        require!(refund > 0, "nothing to refund");
        escrow.refunded = U128(escrow.refunded.0 + refund);
        let (to, asset) = (escrow.refund_to.clone(), escrow.asset.clone());
        self.escrows.insert(escrow_id.0, escrow);
        emit(
            "escrow_refunded",
            near_sdk::serde_json::json!({ "escrow_id": escrow_id, "amount": U128(refund), "to": to, "reason": "deadline_expired" }),
        );
        self.payout(escrow_id.0, to, asset, refund);
    }

    /// Payer or approver cancels an escrow that is not fully funded yet; partial funds return.
    pub fn cancel_escrow(&mut self, escrow_id: U64) {
        let caller = env::predecessor_account_id();
        let mut escrow = self.get(escrow_id.0);
        require!(caller == escrow.payer || caller == escrow.approver, "not allowed");
        require!(escrow.status == EscrowStatus::AwaitingFunding, "escrow is already active");
        let refund = escrow.outstanding();
        for m in escrow.milestones.iter_mut() {
            m.status = MilestoneStatus::Refunded;
        }
        escrow.status = EscrowStatus::Cancelled;
        escrow.refunded = U128(escrow.refunded.0 + refund);
        let (to, asset) = (escrow.refund_to.clone(), escrow.asset.clone());
        self.escrows.insert(escrow_id.0, escrow);
        emit("escrow_cancelled", near_sdk::serde_json::json!({ "escrow_id": escrow_id, "by": caller, "refund": U128(refund) }));
        if refund > 0 {
            self.payout(escrow_id.0, to, asset, refund);
        }
    }

    /// Provider walks away: every unreleased milestone is refunded.
    pub fn provider_withdraw(&mut self, escrow_id: U64) {
        let caller = env::predecessor_account_id();
        let mut escrow = self.get(escrow_id.0);
        require!(caller == escrow.provider, "only the provider can withdraw");
        require!(escrow.status == EscrowStatus::Active, "escrow is not active");
        let mut refund = 0u128;
        for m in escrow.milestones.iter_mut() {
            if !m.status.is_final() {
                m.status = MilestoneStatus::Refunded;
                refund += m.amount.0;
            }
        }
        escrow.refunded = U128(escrow.refunded.0 + refund);
        escrow.settle_status_if_done();
        let (to, asset) = (escrow.refund_to.clone(), escrow.asset.clone());
        self.escrows.insert(escrow_id.0, escrow);
        emit("escrow_refunded", near_sdk::serde_json::json!({ "escrow_id": escrow_id, "amount": U128(refund), "to": to, "reason": "provider_withdrew" }));
        if refund > 0 {
            self.payout(escrow_id.0, to, asset, refund);
        }
    }

    /// Retries a payout that failed earlier (for example an unregistered FT receiver).
    pub fn withdraw_unclaimed(&mut self, asset: Asset) {
        let who = env::predecessor_account_id();
        let key = format!("{who}|{}", asset.key());
        let (asset, amount) = self.unclaimed.remove(&key).expect("nothing unclaimed");
        self.payout(u64::MAX, who, asset, amount);
    }

    // ------------------------------------------------------------------ admin

    pub fn set_owner(&mut self, owner: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        self.owner = owner;
    }

    // ------------------------------------------------------------------ callbacks

    #[private]
    pub fn on_payout(
        &mut self,
        escrow_id: u64,
        receiver: AccountId,
        asset: Asset,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            emit("payout_completed", near_sdk::serde_json::json!({ "escrow_id": U64(escrow_id), "receiver": receiver, "amount": amount, "asset": asset }));
            return true;
        }
        let key = format!("{receiver}|{}", asset.key());
        let prev = self.unclaimed.get(&key).map(|(_, a)| *a).unwrap_or(0);
        self.unclaimed.insert(key, (asset.clone(), prev + amount.0));
        emit("payout_failed", near_sdk::serde_json::json!({ "escrow_id": U64(escrow_id), "receiver": receiver, "amount": amount, "asset": asset }));
        false
    }

    // ------------------------------------------------------------------ views

    pub fn get_escrow(&self, escrow_id: U64) -> Option<Escrow> {
        self.escrows.get(&escrow_id.0).cloned()
    }

    pub fn get_escrows(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Escrow> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.next_id)
            .filter_map(|id| self.escrows.get(&id).cloned())
            .take(limit as usize)
            .collect()
    }

    pub fn get_escrows_for(&self, account_id: AccountId) -> Vec<Escrow> {
        self.by_account
            .get(&account_id)
            .map(|ids| ids.iter().filter_map(|id| self.escrows.get(id).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_unclaimed(&self, account_id: AccountId, asset: Asset) -> U128 {
        U128(
            self.unclaimed
                .get(&format!("{account_id}|{}", asset.key()))
                .map(|(_, a)| *a)
                .unwrap_or(0),
        )
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn escrow_count(&self) -> U64 {
        U64(self.next_id)
    }
}

fn milestone_mut(escrow: &mut Escrow, index: u32) -> &mut Milestone {
    escrow.milestones.get_mut(index as usize).expect("no such milestone")
}

impl Contract {
    fn get(&self, id: u64) -> Escrow {
        self.escrows.get(&id).cloned().expect("escrow not found")
    }

    /// Credits funding; returns unused amount (for FT returns; native excess is transferred back).
    fn apply_funding(&mut self, id: u64, from: &AccountId, amount: u128, native: bool) -> u128 {
        let mut escrow = self.get(id);
        require!(from == &escrow.payer, "only the payer can fund this escrow");
        require!(escrow.status == EscrowStatus::AwaitingFunding, "escrow is not awaiting funding");
        let needed = escrow.total.0 - escrow.funded.0;
        let used = amount.min(needed);
        let unused = amount - used;
        escrow.funded = U128(escrow.funded.0 + used);
        let fully = escrow.funded == escrow.total;
        if fully {
            escrow.status = EscrowStatus::Active;
        }
        self.escrows.insert(id, escrow);
        emit("escrow_funded", near_sdk::serde_json::json!({ "escrow_id": U64(id), "amount": U128(used), "fully_funded": fully }));
        if native && unused > 0 {
            Promise::new(from.clone()).transfer(NearToken::from_yoctonear(unused));
            return 0;
        }
        unused
    }

    fn release(&mut self, id: u64, index: u32, reason: &str, by: AccountId) -> Promise {
        let mut escrow = self.get(id);
        require!(escrow.status == EscrowStatus::Active, "escrow is not active (disputed or closed)");
        let m = milestone_mut(&mut escrow, index);
        require!(m.status == MilestoneStatus::Submitted, "milestone was not submitted");
        m.status = MilestoneStatus::Released;
        let amount = m.amount.0;
        escrow.released = U128(escrow.released.0 + amount);
        escrow.settle_status_if_done();
        let (provider, asset) = (escrow.provider.clone(), escrow.asset.clone());
        self.escrows.insert(id, escrow);
        emit(
            "milestone_released",
            near_sdk::serde_json::json!({ "escrow_id": U64(id), "milestone_index": index, "amount": U128(amount), "by": by, "reason": reason }),
        );
        self.payout(id, provider, asset, amount)
    }

    fn payout(&mut self, escrow_id: u64, to: AccountId, asset: Asset, amount: u128) -> Promise {
        let transfer = match &asset {
            Asset::Native => Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)),
            Asset::Ft { contract_id } => ext_ft::ext(contract_id.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(to.clone(), U128(amount), Some(format!("veyra escrow {escrow_id}"))),
        };
        transfer.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CALLBACK)
                .on_payout(escrow_id, to, asset, U128(amount)),
        )
    }

    fn charge_storage(&self, before: u64, payer: &AccountId) {
        let after = env::storage_usage();
        let cost = if after > before {
            env::storage_byte_cost().saturating_mul((after - before) as u128).as_yoctonear()
        } else {
            0
        };
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= cost, format!("attach at least {cost} yoctoNEAR for storage"));
        if attached > cost {
            Promise::new(payer.clone()).transfer(NearToken::from_yoctonear(attached - cost));
        }
    }
}

#[cfg(test)]
mod tests;
