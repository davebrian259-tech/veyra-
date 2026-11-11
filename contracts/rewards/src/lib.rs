//! PROOF OF LIFE — challenges, bounties and verified reward payouts for Veyra.
//!
//! A creator funds a challenge's reward pool up front (the pool is the challenge treasury).
//! Contributors submit evidence hashes; the creator or a listed reviewer approves or rejects
//! each submission. Approval pays the fixed reward straight from the pool, and contributor
//! stats (approvals, rejections, earnings) are kept on-chain as a verifiable reputation record.
//! Large evidence stays off-chain; only its hash is anchored here.
//!
//! No token is required: rewards are native NEAR. Events use NEP-297 (`standard: "veyra_pol"`).

// near-sdk schedules a Promise when it is dropped, so statement-position promises are intentional.
#![allow(unused_must_use)]

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

pub const EVENT_STANDARD: &str = "veyra_pol";
pub const EVENT_VERSION: &str = "1.0.0";
pub const MAX_TEXT: usize = 256;
pub const MAX_REVIEWERS: usize = 10;
pub const MAX_WINNERS: u32 = 1_000;
/// After the deadline, reviewers get this long to finish pending reviews before the creator
/// can close the challenge and reclaim the remaining pool.
pub const REVIEW_GRACE_NS: u64 = 3 * 86_400_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeKind {
    Challenge,
    Bounty,
    CommunityObjective,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeStatus {
    Open,
    Closed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Challenge {
    pub id: U64,
    pub kind: ChallengeKind,
    pub creator: AccountId,
    pub title: String,
    /// Off-chain description/rules document and its hash.
    pub metadata_uri: Option<String>,
    pub rules_hash: String,
    pub reviewers: Vec<AccountId>,
    pub reward_per_approval: U128,
    pub max_approvals: u32,
    pub approved_count: u32,
    pub pending_count: u32,
    pub pool_remaining: U128,
    pub deadline_ns: U64,
    pub status: ChallengeStatus,
    pub created_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Submission {
    pub challenge_id: U64,
    pub contributor: AccountId,
    pub evidence_hash: String,
    pub evidence_uri: Option<String>,
    pub status: SubmissionStatus,
    pub submitted_at_ns: U64,
    pub reviewed_by: Option<AccountId>,
    pub review_note: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct ContributorStats {
    pub submitted: u32,
    pub approved: u32,
    pub rejected: u32,
    pub total_earned: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    next_id: u64,
    challenges: IterableMap<u64, Challenge>,
    /// Key: "<challenge id>|<contributor>"
    submissions: LookupMap<String, Submission>,
    /// Contributors per challenge, in submission order.
    contributors_of: LookupMap<u64, Vec<AccountId>>,
    stats: IterableMap<AccountId, ContributorStats>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let payload = near_sdk::serde_json::json!({
        "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

fn check_text(label: &str, value: &str) {
    require!(!value.is_empty(), format!("{label} must not be empty"));
    require!(value.len() <= MAX_TEXT, format!("{label} is too long"));
}

fn sub_key(id: u64, who: &AccountId) -> String {
    format!("{id}|{who}")
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            next_id: 0,
            challenges: IterableMap::new(b"c"),
            submissions: LookupMap::new(b"s"),
            contributors_of: LookupMap::new(b"o"),
            stats: IterableMap::new(b"t"),
        }
    }

    /// Creates and funds a challenge. Attach `reward_per_approval * max_approvals` plus storage.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_challenge(
        &mut self,
        kind: ChallengeKind,
        title: String,
        rules_hash: String,
        metadata_uri: Option<String>,
        reviewers: Vec<AccountId>,
        reward_per_approval: U128,
        max_approvals: u32,
        deadline_ns: U64,
    ) -> U64 {
        let creator = env::predecessor_account_id();
        check_text("title", &title);
        check_text("rules_hash", &rules_hash);
        if let Some(u) = &metadata_uri {
            check_text("metadata_uri", u);
        }
        require!(reviewers.len() <= MAX_REVIEWERS, "too many reviewers");
        require!(reward_per_approval.0 > 0, "reward must be positive");
        require!(max_approvals > 0 && max_approvals <= MAX_WINNERS, "invalid max_approvals");
        require!(deadline_ns.0 > env::block_timestamp(), "deadline must be in the future");
        let pool = reward_per_approval.0.checked_mul(max_approvals as u128).expect("overflow");

        let before = env::storage_usage();
        let id = self.next_id;
        self.next_id += 1;
        self.challenges.insert(
            id,
            Challenge {
                id: U64(id),
                kind: kind.clone(),
                creator: creator.clone(),
                title: title.clone(),
                metadata_uri,
                rules_hash,
                reviewers,
                reward_per_approval,
                max_approvals,
                approved_count: 0,
                pending_count: 0,
                pool_remaining: U128(pool),
                deadline_ns,
                status: ChallengeStatus::Open,
                created_at_ns: U64(env::block_timestamp()),
            },
        );
        self.challenges.flush();
        let storage = storage_cost(before);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= pool + storage,
            format!("attach the reward pool plus storage: {} yoctoNEAR", pool + storage)
        );
        refund_excess(&creator, attached - pool - storage);
        emit(
            "challenge_created",
            near_sdk::serde_json::json!({
                "challenge_id": U64(id), "kind": kind, "creator": creator, "title": title,
                "reward_per_approval": reward_per_approval, "max_approvals": max_approvals,
                "pool": U128(pool), "deadline_ns": deadline_ns,
            }),
        );
        U64(id)
    }

    /// Submits (or replaces a rejected) contribution. Attach storage for new submissions.
    #[payable]
    pub fn submit(&mut self, challenge_id: U64, evidence_hash: String, evidence_uri: Option<String>) {
        let who = env::predecessor_account_id();
        check_text("evidence_hash", &evidence_hash);
        if let Some(u) = &evidence_uri {
            check_text("evidence_uri", u);
        }
        let mut c = self.get(challenge_id.0);
        require!(c.status == ChallengeStatus::Open, "challenge is closed");
        require!(env::block_timestamp() <= c.deadline_ns.0, "deadline has passed");
        require!(who != c.creator, "creator cannot submit to own challenge");
        require!(!c.reviewers.contains(&who), "reviewers cannot submit");
        require!(c.approved_count < c.max_approvals, "all rewards have been claimed");
        let key = sub_key(challenge_id.0, &who);
        let before = env::storage_usage();
        if let Some(existing) = self.submissions.get(&key) {
            require!(
                existing.status == SubmissionStatus::Rejected,
                "you already have a submission for this challenge"
            );
        } else {
            let mut list = self.contributors_of.get(&challenge_id.0).cloned().unwrap_or_default();
            list.push(who.clone());
            self.contributors_of.insert(challenge_id.0, list);
        }
        self.submissions.insert(
            key,
            Submission {
                challenge_id,
                contributor: who.clone(),
                evidence_hash: evidence_hash.clone(),
                evidence_uri,
                status: SubmissionStatus::Pending,
                submitted_at_ns: U64(env::block_timestamp()),
                reviewed_by: None,
                review_note: None,
            },
        );
        c.pending_count += 1;
        self.challenges.insert(challenge_id.0, c);
        let mut s = self.stats.get(&who).cloned().unwrap_or_default();
        s.submitted += 1;
        self.stats.insert(who.clone(), s);
        self.submissions.flush();
        self.contributors_of.flush();
        self.challenges.flush();
        self.stats.flush();
        let cost = storage_cost(before);
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= cost, format!("attach at least {cost} yoctoNEAR for storage"));
        refund_excess(&who, attached - cost);
        emit(
            "submission_created",
            near_sdk::serde_json::json!({ "challenge_id": challenge_id, "contributor": who, "evidence_hash": evidence_hash }),
        );
    }

    /// Creator or reviewer verifies a submission. Approval pays the reward immediately.
    pub fn review(&mut self, challenge_id: U64, contributor: AccountId, approve: bool, note: Option<String>) {
        let who = env::predecessor_account_id();
        if let Some(n) = &note {
            check_text("note", n);
        }
        let mut c = self.get(challenge_id.0);
        require!(who == c.creator || c.reviewers.contains(&who), "only the creator or a reviewer");
        require!(who != contributor, "cannot review your own submission");
        require!(c.status == ChallengeStatus::Open, "challenge is closed");
        let key = sub_key(challenge_id.0, &contributor);
        let mut sub = self.submissions.get(&key).cloned().expect("submission not found");
        require!(sub.status == SubmissionStatus::Pending, "submission already reviewed");
        let mut stats = self.stats.get(&contributor).cloned().unwrap_or_default();
        c.pending_count -= 1;
        sub.reviewed_by = Some(who.clone());
        sub.review_note = note.clone();
        let reward = c.reward_per_approval.0;
        if approve {
            require!(c.approved_count < c.max_approvals, "no rewards left");
            sub.status = SubmissionStatus::Approved;
            c.approved_count += 1;
            c.pool_remaining = U128(c.pool_remaining.0 - reward);
            stats.approved += 1;
            stats.total_earned = U128(stats.total_earned.0 + reward);
        } else {
            sub.status = SubmissionStatus::Rejected;
            stats.rejected += 1;
        }
        let exhausted = c.approved_count == c.max_approvals;
        if exhausted {
            c.status = ChallengeStatus::Closed;
        }
        self.challenges.insert(challenge_id.0, c);
        self.submissions.insert(key, sub);
        self.stats.insert(contributor.clone(), stats);
        emit(
            if approve { "submission_approved" } else { "submission_rejected" },
            near_sdk::serde_json::json!({
                "challenge_id": challenge_id, "contributor": contributor, "reviewer": who,
                "reward": if approve { U128(reward) } else { U128(0) }, "note": note,
            }),
        );
        if approve {
            Promise::new(contributor).transfer(NearToken::from_yoctonear(reward));
        }
        if exhausted {
            emit("challenge_closed", near_sdk::serde_json::json!({ "challenge_id": challenge_id, "reason": "all_rewards_paid", "refund": U128(0) }));
        }
    }

    /// Creator closes the challenge and reclaims the unspent pool. Allowed when no submissions
    /// are pending, or once the review grace period after the deadline has elapsed (pending
    /// submissions then expire).
    pub fn close_challenge(&mut self, challenge_id: U64) {
        let who = env::predecessor_account_id();
        let mut c = self.get(challenge_id.0);
        require!(who == c.creator, "only the creator can close");
        require!(c.status == ChallengeStatus::Open, "challenge is already closed");
        let grace_over = env::block_timestamp() > c.deadline_ns.0 + REVIEW_GRACE_NS;
        require!(
            c.pending_count == 0 || grace_over,
            "submissions are pending review; wait for the review grace period"
        );
        if c.pending_count > 0 {
            if let Some(list) = self.contributors_of.get(&challenge_id.0).cloned() {
                for contributor in list {
                    let key = sub_key(challenge_id.0, &contributor);
                    if let Some(mut s) = self.submissions.get(&key).cloned() {
                        if s.status == SubmissionStatus::Pending {
                            s.status = SubmissionStatus::Expired;
                            self.submissions.insert(key, s);
                        }
                    }
                }
            }
            c.pending_count = 0;
        }
        let refund = c.pool_remaining.0;
        c.pool_remaining = U128(0);
        c.status = ChallengeStatus::Closed;
        let creator = c.creator.clone();
        self.challenges.insert(challenge_id.0, c);
        emit("challenge_closed", near_sdk::serde_json::json!({ "challenge_id": challenge_id, "reason": "closed_by_creator", "refund": U128(refund) }));
        if refund > 0 {
            Promise::new(creator).transfer(NearToken::from_yoctonear(refund));
        }
    }

    // ------------------------------------------------------------------ views

    pub fn get_challenge(&self, challenge_id: U64) -> Option<Challenge> {
        self.challenges.get(&challenge_id.0).cloned()
    }

    pub fn get_challenges(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Challenge> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        (from..self.next_id).filter_map(|i| self.challenges.get(&i).cloned()).take(limit).collect()
    }

    pub fn get_submissions(&self, challenge_id: U64) -> Vec<Submission> {
        self.contributors_of
            .get(&challenge_id.0)
            .map(|list| {
                list.iter()
                    .filter_map(|a| self.submissions.get(&sub_key(challenge_id.0, a)).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_submission(&self, challenge_id: U64, contributor: AccountId) -> Option<Submission> {
        self.submissions.get(&sub_key(challenge_id.0, &contributor)).cloned()
    }

    pub fn get_contributor(&self, account_id: AccountId) -> ContributorStats {
        self.stats.get(&account_id).cloned().unwrap_or_default()
    }

    /// Paginated contributor stats; leaderboards are sorted off-chain from this.
    pub fn get_contributors(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(AccountId, ContributorStats)> {
        self.stats
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100).min(200) as usize)
            .map(|(a, s)| (a.clone(), s.clone()))
            .collect()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

impl Contract {
    fn get(&self, id: u64) -> Challenge {
        self.challenges.get(&id).cloned().expect("challenge not found")
    }
}

fn storage_cost(before: u64) -> u128 {
    let after = env::storage_usage();
    if after <= before {
        return 0;
    }
    env::storage_byte_cost().saturating_mul((after - before) as u128).as_yoctonear()
}

fn refund_excess(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const DAY: u64 = 86_400_000_000_000;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(p: &str, deposit: u128, ts: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("pol.veyra.testnet"))
            .predecessor_account_id(acc(p))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts);
        testing_env!(b.build());
    }
    fn setup() -> (Contract, U64) {
        ctx("owner.near", 0, 1);
        let mut c = Contract::new(acc("owner.near"));
        ctx("dao.near", 3 * NEAR + NEAR / 10, 10);
        let id = c.create_challenge(
            ChallengeKind::Bounty,
            "Translate docs".into(),
            "sha256:rules".into(),
            None,
            vec![acc("rev.near")],
            U128(NEAR),
            3,
            U64(10 + DAY),
        );
        (c, id)
    }

    #[test]
    fn full_lifecycle() {
        let (mut c, id) = setup();
        ctx("ann.near", NEAR / 100, 20);
        c.submit(id, "sha256:a".into(), None);
        ctx("ben.near", NEAR / 100, 21);
        c.submit(id, "sha256:b".into(), None);
        ctx("rev.near", 0, 30);
        c.review(id, acc("ann.near"), true, Some("great".into()));
        c.review(id, acc("ben.near"), false, Some("incomplete".into()));
        let ch = c.get_challenge(id).unwrap();
        assert_eq!(ch.approved_count, 1);
        assert_eq!(ch.pool_remaining, U128(2 * NEAR));
        assert_eq!(c.get_contributor(acc("ann.near")).total_earned, U128(NEAR));
        assert_eq!(c.get_contributor(acc("ben.near")).rejected, 1);
        // Rejected contributor may resubmit.
        ctx("ben.near", NEAR / 100, 40);
        c.submit(id, "sha256:b2".into(), None);
        assert_eq!(c.get_submission(id, acc("ben.near")).unwrap().status, SubmissionStatus::Pending);
        ctx("dao.near", 0, 50);
        c.review(id, acc("ben.near"), true, None);
        ctx("dao.near", 0, 60);
        c.close_challenge(id);
        let ch = c.get_challenge(id).unwrap();
        assert_eq!(ch.status, ChallengeStatus::Closed);
        assert_eq!(ch.pool_remaining, U128(0));
        assert_eq!(c.get_contributors(None, None).len(), 2);
    }

    #[test]
    #[should_panic(expected = "attach the reward pool")]
    fn pool_must_be_funded() {
        ctx("owner.near", 0, 1);
        let mut c = Contract::new(acc("owner.near"));
        ctx("dao.near", NEAR, 10);
        c.create_challenge(ChallengeKind::Challenge, "t".into(), "h".into(), None, vec![], U128(NEAR), 3, U64(DAY));
    }

    #[test]
    #[should_panic(expected = "only the creator or a reviewer")]
    fn stranger_cannot_approve() {
        let (mut c, id) = setup();
        ctx("ann.near", NEAR / 100, 20);
        c.submit(id, "sha256:a".into(), None);
        ctx("ann-friend.near", 0, 30);
        c.review(id, acc("ann.near"), true, None);
    }

    #[test]
    #[should_panic(expected = "already have a submission")]
    fn no_duplicate_submissions() {
        let (mut c, id) = setup();
        ctx("ann.near", NEAR / 100, 20);
        c.submit(id, "sha256:a".into(), None);
        c.submit(id, "sha256:a2".into(), None);
    }

    #[test]
    #[should_panic(expected = "reviewers cannot submit")]
    fn reviewer_cannot_submit() {
        let (mut c, id) = setup();
        ctx("rev.near", NEAR / 100, 20);
        c.submit(id, "sha256:a".into(), None);
    }

    #[test]
    #[should_panic(expected = "submissions are pending")]
    fn creator_cannot_rug_pending_contributors() {
        let (mut c, id) = setup();
        ctx("ann.near", NEAR / 100, 20);
        c.submit(id, "sha256:a".into(), None);
        ctx("dao.near", 0, 30);
        c.close_challenge(id);
    }

    #[test]
    fn close_after_grace_expires_pending() {
        let (mut c, id) = setup();
        ctx("ann.near", NEAR / 100, 20);
        c.submit(id, "sha256:a".into(), None);
        ctx("dao.near", 0, 10 + DAY + REVIEW_GRACE_NS + 1);
        c.close_challenge(id);
        assert_eq!(c.get_submission(id, acc("ann.near")).unwrap().status, SubmissionStatus::Expired);
    }

    #[test]
    fn closes_automatically_when_rewards_exhausted() {
        let (mut c, id) = setup();
        for (i, who) in ["a.near", "b.near", "c.near"].iter().enumerate() {
            ctx(who, NEAR / 100, 20 + i as u64);
            c.submit(id, format!("sha256:{i}"), None);
        }
        ctx("rev.near", 0, 40);
        for who in ["a.near", "b.near", "c.near"] {
            c.review(id, acc(who), true, None);
        }
        assert_eq!(c.get_challenge(id).unwrap().status, ChallengeStatus::Closed);
    }
}
