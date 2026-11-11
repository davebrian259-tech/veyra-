//! veyra-ledger — an append-only log of Merkle roots over Veyra's signed receipts.
//!
//! Veyra issues a signed receipt for every purchase, verification, delivery and payout, then
//! commits each batch here as one root. Anyone can take a receipt, its Merkle path and an anchor
//! index, and check the receipt against the chain without trusting Veyra's database.
//!
//! Rules enforced on-chain:
//!   * only allow-listed writers can anchor;
//!   * batches must be contiguous: each starts right after the previous one ends;
//!   * anchors are immutable — there is no update or delete.
//! Events use NEP-297 (`standard: "veyra_ledger"`).

use near_sdk::json_types::U64;
use near_sdk::store::{LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Anchor {
    pub index: U64,
    /// Hex sha256 Merkle root (64 chars).
    pub root: String,
    pub from_seq: U64,
    pub to_seq: U64,
    pub count: u32,
    pub writer: AccountId,
    pub block_height: U64,
    pub timestamp_ns: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    writers: LookupSet<AccountId>,
    anchors: Vector<Anchor>,
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, writers: Vec<AccountId>) -> Self {
        let mut w = LookupSet::new(b"w");
        for a in writers {
            w.insert(a);
        }
        Self { owner, writers: w, anchors: Vector::new(b"a") }
    }

    pub fn anchor(&mut self, root: String, from_seq: U64, to_seq: U64, count: u32) -> U64 {
        let writer = env::predecessor_account_id();
        require!(self.writers.contains(&writer), "not an authorised writer");
        require!(is_hex64(&root), "root must be 64 lowercase hex chars");
        require!(to_seq.0 >= from_seq.0, "to_seq must be >= from_seq");
        require!(count > 0, "count must be positive");
        if let Some(prev) = self.anchors.get(self.anchors.len().saturating_sub(1)) {
            if !self.anchors.is_empty() {
                require!(from_seq.0 == prev.to_seq.0 + 1, "batches must be contiguous");
            }
        }
        let index = self.anchors.len() as u64;
        let a = Anchor {
            index: U64(index),
            root: root.clone(),
            from_seq,
            to_seq,
            count,
            writer: writer.clone(),
            block_height: U64(env::block_height()),
            timestamp_ns: U64(env::block_timestamp()),
        };
        self.anchors.push(a);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "veyra_ledger", "version": "1.0.0", "event": "anchored",
                "data": [{ "index": U64(index), "root": root, "from_seq": from_seq, "to_seq": to_seq, "count": count, "writer": writer }]
            })
        ));
        U64(index)
    }

    pub fn add_writer(&mut self, account_id: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        self.writers.insert(account_id);
    }

    pub fn remove_writer(&mut self, account_id: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        self.writers.remove(&account_id);
    }

    pub fn get_anchor(&self, index: U64) -> Option<Anchor> {
        self.anchors.get(index.0 as u32).cloned()
    }

    pub fn get_anchors(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Anchor> {
        let from = from_index.map(|v| v.0 as u32).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.anchors.len()).take(limit as usize).filter_map(|i| self.anchors.get(i).cloned()).collect()
    }

    pub fn latest(&self) -> Option<Anchor> {
        if self.anchors.is_empty() {
            return None;
        }
        self.anchors.get(self.anchors.len() - 1).cloned()
    }

    pub fn count(&self) -> u32 {
        self.anchors.len()
    }

    pub fn is_writer(&self, account_id: AccountId) -> bool {
        self.writers.contains(&account_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ROOT: &str = "4f8a1a8c0b6e2d3c5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e";

    fn ctx(p: &str) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(p.parse().unwrap()).block_height(10);
        testing_env!(b.build());
    }
    fn setup() -> Contract {
        ctx("owner.near");
        Contract::new("owner.near".parse().unwrap(), vec!["veyra.near".parse().unwrap()])
    }

    #[test]
    fn writer_anchors_contiguous_batches() {
        let mut c = setup();
        ctx("veyra.near");
        assert_eq!(c.anchor(ROOT.into(), U64(1), U64(5), 5), U64(0));
        assert_eq!(c.anchor(ROOT.into(), U64(6), U64(6), 1), U64(1));
        assert_eq!(c.count(), 2);
        assert_eq!(c.latest().unwrap().to_seq, U64(6));
        assert_eq!(c.get_anchors(None, None).len(), 2);
    }

    #[test]
    #[should_panic(expected = "not an authorised writer")]
    fn stranger_cannot_anchor() {
        let mut c = setup();
        ctx("mallory.near");
        c.anchor(ROOT.into(), U64(1), U64(1), 1);
    }

    #[test]
    #[should_panic(expected = "contiguous")]
    fn gaps_are_rejected() {
        let mut c = setup();
        ctx("veyra.near");
        c.anchor(ROOT.into(), U64(1), U64(5), 5);
        c.anchor(ROOT.into(), U64(9), U64(9), 1);
    }

    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn malformed_root_rejected() {
        let mut c = setup();
        ctx("veyra.near");
        c.anchor("not-a-root".into(), U64(1), U64(1), 1);
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn writer_cannot_add_writers() {
        let mut c = setup();
        ctx("veyra.near");
        c.add_writer("mallory.near".parse().unwrap());
    }

    #[test]
    fn owner_manages_writers() {
        let mut c = setup();
        ctx("owner.near");
        c.add_writer("backup.near".parse().unwrap());
        assert!(c.is_writer("backup.near".parse().unwrap()));
        c.remove_writer("veyra.near".parse().unwrap());
        assert!(!c.is_writer("veyra.near".parse().unwrap()));
    }
}
