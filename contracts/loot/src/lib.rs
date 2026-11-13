//! Veyra Heist loot: every item in the game lives in this one NEP-245 multi-token contract.
//!
//! Each vault has its own item type, a gold bar. The referee mints the bar to the player who
//! cracks that vault in a ranked heist. Players own their bars: they can send them to anyone,
//! one at a time or in batches, or hand them to another contract with `mt_transfer_call`.
//!
//! Implements the NEP-245 core (`mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`,
//! `mt_batch_transfer_call`, `mt_token`, `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`,
//! `mt_batch_supply`), the metadata views, and NEP-297 `mt_mint` / `mt_transfer` events.
//! Approval management is not implemented: the `approval` arguments must be null.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue};

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
const GAS_FOR_CALL: Gas = Gas::from_tgas(25);

type Approval = Option<(AccountId, u64)>;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct ItemMetadata {
    pub title: String,
    pub description: String,
    pub media: Option<String>,
}

/// NEP-245 `Token`. Items are fungible within their type, so a token has no single owner.
#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct MtContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct Item {
    pub token_id: String,
    pub metadata: ItemMetadata,
    pub supply: U128,
}

#[ext_contract(ext_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(&mut self, sender_id: AccountId, previous_owner_ids: Vec<AccountId>, token_ids: Vec<String>, amounts: Vec<U128>, msg: String) -> PromiseOrValue<Vec<U128>>;
}

#[ext_contract(ext_self)]
pub trait MtResolver {
    fn mt_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) -> Vec<U128>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Loot {
    owner: AccountId,
    minter: AccountId,
    items: IterableMap<String, ItemMetadata>,
    supply: LookupMap<String, u128>,
    balances: LookupMap<(String, AccountId), u128>,
}

#[near]
impl Loot {
    #[init]
    pub fn new(owner: AccountId, minter: AccountId) -> Self {
        Self { owner, minter, items: IterableMap::new(b"i"), supply: LookupMap::new(b"s"), balances: LookupMap::new(b"b") }
    }

    // ------------------------------------------------------------------ owner and minter

    /// Defines a new item type. Owner only.
    pub fn add_item(&mut self, token_id: String, metadata: ItemMetadata) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        require!(!token_id.is_empty() && token_id.len() <= 64, "token_id must be 1 to 64 characters");
        require!(!self.items.contains_key(&token_id), "item already exists");
        self.items.insert(token_id, metadata);
    }

    pub fn set_minter(&mut self, minter: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        self.minter = minter;
    }

    /// Mints items to a player. Minter (the Heist referee) only.
    pub fn mt_mint(&mut self, owner_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>) {
        require!(env::predecessor_account_id() == self.minter, "only the minter can mint");
        require!(!token_ids.is_empty() && token_ids.len() == amounts.len(), "token_ids and amounts must match");
        for (id, amount) in token_ids.iter().zip(amounts.iter()) {
            require!(self.items.contains_key(id), "no such item");
            require!(amount.0 > 0, "amount must be positive");
            let key = (id.clone(), owner_id.clone());
            let bal = self.balances.get(&key).copied().unwrap_or(0);
            self.balances.insert(key, bal + amount.0);
            let s = self.supply.get(id).copied().unwrap_or(0);
            self.supply.insert(id.clone(), s + amount.0);
        }
        emit("mt_mint", serde_json::json!([{ "owner_id": owner_id, "token_ids": token_ids, "amounts": amounts, "memo": memo }]));
    }

    // ------------------------------------------------------------------ NEP-245 core

    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Approval, memo: Option<String>) {
        assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &[token_id], &[amount], memo);
    }

    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Approval>>, memo: Option<String>) {
        assert_one_yocto();
        require!(approvals.map_or(true, |a| a.iter().all(|x| x.is_none())), "approvals are not supported");
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &token_ids, &amounts, memo);
    }

    #[payable]
    pub fn mt_transfer_call(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Approval, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        self.transfer_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Approval>>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(approvals.map_or(true, |a| a.iter().all(|x| x.is_none())), "approvals are not supported");
        self.transfer_call(receiver_id, token_ids, amounts, memo, msg)
    }

    /// Finishes `mt_transfer_call`: returns unused items to the sender (all of them if the
    /// receiver failed) and reports how many the receiver kept.
    #[private]
    pub fn mt_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) -> Vec<U128> {
        // a failed, oversized or malformed answer refunds everything
        let unused: Vec<u128> = match env::promise_result_checked(0, 4_096) {
            Ok(v) => match serde_json::from_slice::<Vec<U128>>(&v) {
                Ok(u) if u.len() == amounts.len() => u.iter().zip(amounts.iter()).map(|(u, a)| u.0.min(a.0)).collect(),
                _ => amounts.iter().map(|a| a.0).collect(),
            },
            Err(_) => amounts.iter().map(|a| a.0).collect(),
        };
        let mut refunded_ids = vec![];
        let mut refunded = vec![];
        let mut used = vec![];
        for ((id, amount), back) in token_ids.iter().zip(amounts.iter()).zip(unused.iter()) {
            let key = (id.clone(), receiver_id.clone());
            let have = self.balances.get(&key).copied().unwrap_or(0);
            let back = (*back).min(have);
            if back > 0 {
                self.balances.insert(key, have - back);
                let skey = (id.clone(), sender_id.clone());
                let s = self.balances.get(&skey).copied().unwrap_or(0);
                self.balances.insert(skey, s + back);
                refunded_ids.push(id.clone());
                refunded.push(U128(back));
            }
            used.push(U128(amount.0 - back));
        }
        if !refunded_ids.is_empty() {
            emit("mt_transfer", serde_json::json!([{ "old_owner_id": receiver_id, "new_owner_id": sender_id, "token_ids": refunded_ids, "amounts": refunded, "memo": "refund" }]));
        }
        used
    }

    // ------------------------------------------------------------------ views

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Token>> {
        token_ids.into_iter().map(|id| if self.items.contains_key(&id) { Some(Token { token_id: id, owner_id: None }) } else { None }).collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.balances.get(&(token_id, account_id)).copied().unwrap_or(0))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.into_iter().map(|id| U128(self.balances.get(&(id, account_id.clone())).copied().unwrap_or(0))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        if self.items.contains_key(&token_id) { Some(U128(self.supply.get(&token_id).copied().unwrap_or(0))) } else { None }
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|id| self.mt_supply(id)).collect()
    }

    pub fn mt_metadata_contract(&self) -> MtContractMetadata {
        MtContractMetadata {
            spec: "mt-1.0.0".into(),
            name: "Veyra Heist loot".into(),
            symbol: "LOOT".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Option<ItemMetadata>> {
        token_ids.into_iter().map(|id| self.items.get(&id).cloned()).collect()
    }

    /// Every item type with its metadata and supply, for game clients.
    pub fn items(&self) -> Vec<Item> {
        self.items.iter().map(|(id, m)| Item { token_id: id.clone(), metadata: m.clone(), supply: U128(self.supply.get(id).copied().unwrap_or(0)) }).collect()
    }

    pub fn get_config(&self) -> (AccountId, AccountId) {
        (self.owner.clone(), self.minter.clone())
    }

    // ------------------------------------------------------------------ internal

    fn transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &token_ids, &amounts, memo);
        let previous = vec![sender.clone(); token_ids.len()];
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_CALL)
            .mt_on_transfer(sender.clone(), previous, token_ids.clone(), amounts.clone(), msg)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_FOR_RESOLVE).mt_resolve_transfer(sender, receiver_id, token_ids, amounts))
            .into()
    }

    fn internal_transfer(&mut self, sender: &AccountId, receiver: &AccountId, token_ids: &[String], amounts: &[U128], memo: Option<String>) {
        require!(sender != receiver, "sender and receiver must differ");
        require!(!token_ids.is_empty() && token_ids.len() == amounts.len(), "token_ids and amounts must match");
        for (id, amount) in token_ids.iter().zip(amounts.iter()) {
            require!(self.items.contains_key(id), "no such item");
            require!(amount.0 > 0, "amount must be positive");
            let from = (id.clone(), sender.clone());
            let have = self.balances.get(&from).copied().unwrap_or(0);
            require!(have >= amount.0, "not enough of this item");
            self.balances.insert(from, have - amount.0);
            let to = (id.clone(), receiver.clone());
            let bal = self.balances.get(&to).copied().unwrap_or(0);
            self.balances.insert(to, bal + amount.0);
        }
        emit("mt_transfer", serde_json::json!([{ "old_owner_id": sender, "new_owner_id": receiver, "token_ids": token_ids, "amounts": amounts, "memo": memo }]));
    }
}

fn assert_one_yocto() {
    require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach exactly 1 yoctoNEAR");
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", serde_json::json!({ "standard": "nep245", "version": "1.0.0", "event": event, "data": data })));
}

// ---------------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(who: &str, deposit: u128) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("loot.testnet")).predecessor_account_id(acc(who)).attached_deposit(NearToken::from_yoctonear(deposit)).build());
    }
    fn setup() -> Loot {
        ctx("owner.testnet", 0);
        let mut c = Loot::new(acc("owner.testnet"), acc("referee.testnet"));
        for v in 1..=5 { c.add_item(format!("bar-{v}"), ItemMetadata { title: format!("Vault {v} gold bar"), description: "test".into(), media: None }); }
        c
    }
    fn bal(c: &Loot, who: &str, id: &str) -> u128 { c.mt_balance_of(acc(who), id.into()).0 }

    #[test]
    fn mint_balances_supply_and_event() {
        let mut c = setup();
        ctx("referee.testnet", 0);
        c.mt_mint(acc("alice.testnet"), vec!["bar-1".into(), "bar-3".into()], vec![U128(1), U128(2)], None);
        assert_eq!(bal(&c, "alice.testnet", "bar-1"), 1);
        assert_eq!(c.mt_batch_balance_of(acc("alice.testnet"), vec!["bar-1".into(), "bar-2".into(), "bar-3".into()]).iter().map(|x| x.0).collect::<Vec<_>>(), vec![1, 0, 2]);
        assert_eq!(c.mt_supply("bar-3".into()).unwrap().0, 2);
        assert!(c.mt_supply("nope".into()).is_none());
        let log: serde_json::Value = serde_json::from_str(get_logs()[0].strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(log["data"][0]["amounts"], serde_json::json!(["1", "2"]));
        assert_eq!(log["data"][0]["owner_id"], "alice.testnet");
        assert!(get_logs()[0].contains("\"standard\":\"nep245\"") && get_logs()[0].contains("\"event\":\"mt_mint\""));
        assert_eq!(c.items().len(), 5);
        assert_eq!(c.mt_token(vec!["bar-1".into(), "x".into()]).iter().map(|t| t.is_some()).collect::<Vec<_>>(), vec![true, false]);
    }

    #[test]
    #[should_panic(expected = "only the minter can mint")]
    fn only_minter_mints() {
        let mut c = setup();
        ctx("alice.testnet", 0);
        c.mt_mint(acc("alice.testnet"), vec!["bar-1".into()], vec![U128(1)], None);
    }

    #[test]
    fn transfer_and_batch_transfer() {
        let mut c = setup();
        ctx("referee.testnet", 0);
        c.mt_mint(acc("alice.testnet"), vec!["bar-1".into(), "bar-2".into()], vec![U128(3), U128(1)], None);
        ctx("alice.testnet", 1);
        c.mt_transfer(acc("bob.testnet"), "bar-1".into(), U128(2), None, Some("gift".into()));
        assert_eq!((bal(&c, "alice.testnet", "bar-1"), bal(&c, "bob.testnet", "bar-1")), (1, 2));
        c.mt_batch_transfer(acc("bob.testnet"), vec!["bar-1".into(), "bar-2".into()], vec![U128(1), U128(1)], None, None);
        assert_eq!((bal(&c, "alice.testnet", "bar-1"), bal(&c, "bob.testnet", "bar-1"), bal(&c, "bob.testnet", "bar-2")), (0, 3, 1));
        assert_eq!(c.mt_supply("bar-1".into()).unwrap().0, 3);
    }

    #[test]
    #[should_panic(expected = "not enough of this item")]
    fn cannot_send_what_you_do_not_have() {
        let mut c = setup();
        ctx("alice.testnet", 1);
        c.mt_transfer(acc("bob.testnet"), "bar-1".into(), U128(1), None, None);
    }

    #[test]
    #[should_panic(expected = "attach exactly 1 yoctoNEAR")]
    fn transfer_needs_one_yocto() {
        let mut c = setup();
        ctx("alice.testnet", 0);
        c.mt_transfer(acc("bob.testnet"), "bar-1".into(), U128(1), None, None);
    }

    fn resolve_with(result: PromiseResult) -> (u128, u128, Vec<U128>) {
        let mut c = setup();
        ctx("referee.testnet", 0);
        c.mt_mint(acc("alice.testnet"), vec!["bar-5".into()], vec![U128(4)], None);
        ctx("alice.testnet", 1);
        // the transfer part of mt_transfer_call
        c.internal_transfer(&acc("alice.testnet"), &acc("market.testnet"), &["bar-5".into()], &[U128(4)], None);
        testing_env!(
            VMContextBuilder::new().current_account_id(acc("loot.testnet")).predecessor_account_id(acc("loot.testnet")).build(),
            near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]
        );
        let used = c.mt_resolve_transfer(acc("alice.testnet"), acc("market.testnet"), vec!["bar-5".into()], vec![U128(4)]);
        (bal(&c, "alice.testnet", "bar-5"), bal(&c, "market.testnet", "bar-5"), used)
    }

    #[test]
    fn transfer_call_refunds_what_the_receiver_returns() {
        let (alice, market, used) = resolve_with(PromiseResult::Successful(serde_json::to_vec(&vec![U128(1)]).unwrap()));
        assert_eq!((alice, market, used[0].0), (1, 3, 3));
    }

    #[test]
    fn transfer_call_reverts_when_the_receiver_fails() {
        let (alice, market, used) = resolve_with(PromiseResult::Failed);
        assert_eq!((alice, market, used[0].0), (4, 0, 0));
    }
}
