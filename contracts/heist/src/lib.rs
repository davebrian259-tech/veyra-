//! Veyra Heist: five vaults, each with a pot in NEAR.
//!
//! * A player enters a vault by paying its fee and committing to the hash of their rogue agent's
//!   spec (`enter`). The fee is held against the entry until the referee settles it.
//! * The referee (Veyra's server) runs the attempt in a sealed simulation and calls `resolve`.
//!   A crack pays the whole pot to the player. A failed attempt splits the fee:
//!   70% to the pot, 20% to the vault's underwriters (or the pot when there are none) and 10% to
//!   the house. Every resolution records the hash of the outcome so anyone can replay it.
//! * If the referee never settles an entry, the player reclaims the fee after `reclaim_after_ns`.
//! * Underwriters stake into a vault's pot, earn their share of failed attempts' fees, and lose
//!   the stake when the vault is cracked.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const ACC_SCALE: u128 = 1_000_000_000_000; // fixed-point scale for earnings per staked yocto
const POT_BPS: u128 = 7_000;
const UNDERWRITER_BPS: u128 = 2_000;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Vault {
    pub fee: U128,
    pub pot: U128,
    pub staked: U128,
    pub attempts: u32,
    pub cracks: u32,
    pub epoch: u32,
    pub last_cracked_by: Option<AccountId>,
    /// Earnings per staked yocto, scaled by ACC_SCALE.
    pub acc_per_stake: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum EntryStatus {
    Pending,
    Cracked,
    Held,
    Reclaimed,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Entry {
    pub id: U64,
    pub vault: u8,
    pub player: AccountId,
    pub spec_hash: String,
    pub fee: U128,
    pub status: EntryStatus,
    pub entered_at_ns: U64,
    pub outcome_hash: Option<String>,
    pub loot: Option<U128>,
    pub payout: Option<U128>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Stake {
    pub epoch: u32,
    pub amount: U128,
    /// acc_per_stake at the last settlement, for the standard reward-debt accounting.
    pub debt: U128,
    pub earned: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Heist {
    owner: AccountId,
    referee: AccountId,
    vaults: Vec<Vault>,
    entries: LookupMap<u64, Entry>,
    next_entry: u64,
    stakes: LookupMap<String, Stake>,
    house: u128,
    reclaim_after_ns: u64,
}

fn hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[near]
impl Heist {
    /// `fees` are the entry fees of vaults 1..=N in yoctoNEAR.
    #[init]
    pub fn new(owner: AccountId, referee: AccountId, fees: Vec<U128>, reclaim_after_ns: Option<U64>) -> Self {
        require!(!fees.is_empty() && fees.len() <= 10, "between 1 and 10 vaults");
        Self {
            owner,
            referee,
            vaults: fees
                .into_iter()
                .map(|fee| Vault { fee, pot: U128(0), staked: U128(0), attempts: 0, cracks: 0, epoch: 0, last_cracked_by: None, acc_per_stake: U128(0) })
                .collect(),
            entries: LookupMap::new(b"e"),
            next_entry: 0,
            stakes: LookupMap::new(b"s"),
            house: 0,
            reclaim_after_ns: reclaim_after_ns.map(|x| x.0).unwrap_or(86_400_000_000_000),
        }
    }

    // ------------------------------------------------------------------ players

    /// Pays the vault's fee and commits to the rogue agent's spec. Returns the entry id.
    #[payable]
    pub fn enter(&mut self, vault: u8, spec_hash: String) -> U64 {
        let v = self.vault_index(vault);
        require!(hex64(&spec_hash), "spec_hash must be 64 hex characters");
        let fee = self.vaults[v].fee.0;
        require!(env::attached_deposit().as_yoctonear() == fee, "attach exactly the vault's entry fee");
        let id = self.next_entry;
        self.next_entry += 1;
        self.vaults[v].attempts += 1;
        let entry = Entry {
            id: U64(id),
            vault,
            player: env::predecessor_account_id(),
            spec_hash,
            fee: U128(fee),
            status: EntryStatus::Pending,
            entered_at_ns: U64(env::block_timestamp()),
            outcome_hash: None,
            loot: None,
            payout: None,
        };
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"veyra-heist\",\"version\":\"1.0.0\",\"event\":\"entered\",\"data\":[{{\"id\":\"{}\",\"vault\":{},\"player\":\"{}\",\"spec_hash\":\"{}\"}}]}}",
            id, vault, entry.player, entry.spec_hash
        ));
        self.entries.insert(id, entry);
        U64(id)
    }

    /// The referee never settled this entry: the player takes the fee back.
    pub fn reclaim(&mut self, entry_id: U64) -> Promise {
        let mut e = self.entries.get(&entry_id.0).cloned().unwrap_or_else(|| env::panic_str("no such entry"));
        require!(e.player == env::predecessor_account_id(), "only the player can reclaim");
        require!(e.status == EntryStatus::Pending, "entry is already settled");
        require!(env::block_timestamp() >= e.entered_at_ns.0 + self.reclaim_after_ns, "too early to reclaim");
        e.status = EntryStatus::Reclaimed;
        let fee = e.fee.0;
        let player = e.player.clone();
        self.entries.insert(entry_id.0, e);
        Promise::new(player).transfer(NearToken::from_yoctonear(fee))
    }

    // ------------------------------------------------------------------ referee

    /// Settles an attempt. `cracked` pays the whole pot (stakes included) to the player.
    pub fn resolve(&mut self, entry_id: U64, cracked: bool, loot: U128, outcome_hash: String) -> Option<Promise> {
        require!(env::predecessor_account_id() == self.referee, "only the referee can resolve");
        require!(hex64(&outcome_hash), "outcome_hash must be 64 hex characters");
        let mut e = self.entries.get(&entry_id.0).cloned().unwrap_or_else(|| env::panic_str("no such entry"));
        require!(e.status == EntryStatus::Pending, "entry is already settled");
        let v = self.vault_index(e.vault);
        let fee = e.fee.0;
        e.outcome_hash = Some(outcome_hash);
        e.loot = Some(loot);
        let mut promise = None;
        if cracked {
            let vault = &mut self.vaults[v];
            let payout = vault.pot.0 + fee;
            vault.pot = U128(0);
            vault.staked = U128(0);
            vault.acc_per_stake = U128(0);
            vault.epoch += 1; // every stake of the old epoch is lost to the crack
            vault.cracks += 1;
            vault.last_cracked_by = Some(e.player.clone());
            e.status = EntryStatus::Cracked;
            e.payout = Some(U128(payout));
            promise = Some(Promise::new(e.player.clone()).transfer(NearToken::from_yoctonear(payout)));
        } else {
            let to_pot = fee * POT_BPS / 10_000;
            let to_underwriters = fee * UNDERWRITER_BPS / 10_000;
            let to_house = fee - to_pot - to_underwriters;
            let vault = &mut self.vaults[v];
            if vault.staked.0 > 0 {
                vault.acc_per_stake = U128(vault.acc_per_stake.0 + to_underwriters * ACC_SCALE / vault.staked.0);
                vault.pot = U128(vault.pot.0 + to_pot);
            } else {
                vault.pot = U128(vault.pot.0 + to_pot + to_underwriters);
            }
            self.house += to_house;
            e.status = EntryStatus::Held;
            e.payout = Some(U128(0));
        }
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"veyra-heist\",\"version\":\"1.0.0\",\"event\":\"resolved\",\"data\":[{{\"id\":\"{}\",\"vault\":{},\"player\":\"{}\",\"cracked\":{}}}]}}",
            entry_id.0, e.vault, e.player, cracked
        ));
        self.entries.insert(entry_id.0, e);
        promise
    }

    // ------------------------------------------------------------------ underwriters

    /// Backs a vault: the deposit joins its pot, earns 20% of failed attempts' fees pro rata,
    /// and is lost if the vault is cracked.
    #[payable]
    pub fn underwrite(&mut self, vault: u8) {
        let v = self.vault_index(vault);
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a deposit");
        let key = Self::stake_key(vault, &env::predecessor_account_id());
        let mut s = self.settled_stake(v, &key);
        s.amount = U128(s.amount.0 + amount);
        s.debt = self.vaults[v].acc_per_stake;
        self.stakes.insert(key, s);
        let vault = &mut self.vaults[v];
        vault.staked = U128(vault.staked.0 + amount);
        vault.pot = U128(vault.pot.0 + amount);
    }

    /// Withdraws the stake (if the vault was not cracked since) and all earnings.
    pub fn withdraw(&mut self, vault: u8) -> Promise {
        let v = self.vault_index(vault);
        let key = Self::stake_key(vault, &env::predecessor_account_id());
        let s = self.settled_stake(v, &key);
        let total = s.amount.0 + s.earned.0;
        require!(total > 0, "nothing to withdraw");
        let vault_ref = &mut self.vaults[v];
        vault_ref.staked = U128(vault_ref.staked.0 - s.amount.0);
        vault_ref.pot = U128(vault_ref.pot.0 - s.amount.0);
        self.stakes.remove(&key);
        Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(total))
    }

    // ------------------------------------------------------------------ owner

    /// House money for a vault's pot (no stake, no earnings).
    #[payable]
    pub fn seed(&mut self, vault: u8) {
        let v = self.vault_index(vault);
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a deposit");
        self.vaults[v].pot = U128(self.vaults[v].pot.0 + amount);
    }

    pub fn set_referee(&mut self, referee: AccountId) {
        self.assert_owner();
        self.referee = referee;
    }

    pub fn withdraw_house(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        require!(amount.0 <= self.house, "more than the house holds");
        self.house -= amount.0;
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ------------------------------------------------------------------ views

    pub fn get_vaults(&self) -> Vec<Vault> {
        self.vaults.clone()
    }

    pub fn get_entry(&self, entry_id: U64) -> Option<Entry> {
        self.entries.get(&entry_id.0).cloned()
    }

    pub fn entry_count(&self) -> U64 {
        U64(self.next_entry)
    }

    pub fn get_stake(&self, vault: u8, account_id: AccountId) -> Option<Stake> {
        let v = self.vault_index(vault);
        let key = Self::stake_key(vault, &account_id);
        self.stakes.get(&key).map(|_| self.settled_stake(v, &key))
    }

    pub fn get_config(&self) -> (AccountId, AccountId, U128, U64) {
        (self.owner.clone(), self.referee.clone(), U128(self.house), U64(self.reclaim_after_ns))
    }

    // ------------------------------------------------------------------ internal

    fn vault_index(&self, vault: u8) -> usize {
        require!(vault >= 1 && (vault as usize) <= self.vaults.len(), "no such vault");
        (vault - 1) as usize
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn stake_key(vault: u8, account: &AccountId) -> String {
        format!("{vault}:{account}")
    }

    /// The stake with earnings brought up to date; a stake from an earlier epoch is worth nothing.
    fn settled_stake(&self, v: usize, key: &String) -> Stake {
        let vault = &self.vaults[v];
        match self.stakes.get(key) {
            None => Stake { epoch: vault.epoch, amount: U128(0), debt: vault.acc_per_stake, earned: U128(0) },
            Some(s) if s.epoch != vault.epoch => Stake { epoch: vault.epoch, amount: U128(0), debt: vault.acc_per_stake, earned: s.earned },
            Some(s) => {
                let pending = s.amount.0 * (vault.acc_per_stake.0 - s.debt.0) / ACC_SCALE;
                Stake { epoch: s.epoch, amount: s.amount, debt: vault.acc_per_stake, earned: U128(s.earned.0 + pending) }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, deposit: u128, ts: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts)
            .build());
    }
    const H: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    fn setup() -> Heist {
        ctx("owner.testnet", 0, 0);
        Heist::new(acc("owner.testnet"), acc("referee.testnet"), vec![U128(NEAR / 10), U128(2 * NEAR)], None)
    }

    #[test]
    fn a_failed_attempt_grows_the_pot_and_pays_the_house() {
        let mut h = setup();
        ctx("owner.testnet", NEAR, 0);
        h.seed(1);
        ctx("mallory.testnet", NEAR / 10, 1);
        let id = h.enter(1, H.into());
        assert_eq!(h.get_vaults()[0].attempts, 1);
        ctx("referee.testnet", 0, 2);
        assert!(h.resolve(id, false, U128(0), H.into()).is_none());
        let v = &h.get_vaults()[0];
        // no underwriters: 90% of the fee joins the pot, 10% to the house
        assert_eq!(v.pot.0, NEAR + NEAR / 10 * 9 / 10);
        assert_eq!(h.get_config().2 .0, NEAR / 10 / 10);
        assert_eq!(h.get_entry(id).unwrap().status, EntryStatus::Held);
    }

    #[test]
    fn a_crack_pays_the_pot_and_wipes_the_stakes() {
        let mut h = setup();
        ctx("uw.testnet", 3 * NEAR, 0);
        h.underwrite(2);
        ctx("mallory.testnet", 2 * NEAR, 1);
        let id = h.enter(2, H.into());
        ctx("referee.testnet", 0, 2);
        assert!(h.resolve(id, true, U128(1_100_000), H.into()).is_some());
        let v = &h.get_vaults()[1];
        assert_eq!(v.pot.0, 0);
        assert_eq!(v.cracks, 1);
        assert_eq!(v.last_cracked_by, Some(acc("mallory.testnet")));
        let e = h.get_entry(id).unwrap();
        assert_eq!(e.payout.unwrap().0, 5 * NEAR);
        assert_eq!(e.status, EntryStatus::Cracked);
        assert_eq!(h.get_stake(2, acc("uw.testnet")).unwrap().amount.0, 0);
    }

    #[test]
    fn underwriters_earn_from_failures_pro_rata() {
        let mut h = setup();
        ctx("a.testnet", 3 * NEAR, 0);
        h.underwrite(2);
        ctx("b.testnet", NEAR, 0);
        h.underwrite(2);
        for i in 0..2 {
            ctx("mallory.testnet", 2 * NEAR, i + 1);
            let id = h.enter(2, H.into());
            ctx("referee.testnet", 0, i + 2);
            h.resolve(id, false, U128(0), H.into());
        }
        // 2 failures × 2 NEAR × 20% = 0.8 NEAR to underwriters, split 3:1
        assert_eq!(h.get_stake(2, acc("a.testnet")).unwrap().earned.0, 6 * NEAR / 10);
        assert_eq!(h.get_stake(2, acc("b.testnet")).unwrap().earned.0, 2 * NEAR / 10);
        let pot_before = h.get_vaults()[1].pot.0;
        ctx("b.testnet", 0, 10);
        h.withdraw(2);
        assert_eq!(h.get_vaults()[1].pot.0, pot_before - NEAR);
        assert!(h.get_stake(2, acc("b.testnet")).is_none());
    }

    #[test]
    #[should_panic(expected = "only the referee can resolve")]
    fn only_the_referee_resolves() {
        let mut h = setup();
        ctx("mallory.testnet", NEAR / 10, 1);
        let id = h.enter(1, H.into());
        h.resolve(id, true, U128(1), H.into());
    }

    #[test]
    #[should_panic(expected = "attach exactly the vault's entry fee")]
    fn the_fee_is_exact() {
        let mut h = setup();
        ctx("mallory.testnet", NEAR, 1);
        h.enter(1, H.into());
    }

    #[test]
    #[should_panic(expected = "entry is already settled")]
    fn an_entry_settles_once() {
        let mut h = setup();
        ctx("mallory.testnet", NEAR / 10, 1);
        let id = h.enter(1, H.into());
        ctx("referee.testnet", 0, 2);
        h.resolve(id, false, U128(0), H.into());
        h.resolve(id, true, U128(1), H.into());
    }

    #[test]
    fn an_unsettled_entry_can_be_reclaimed_after_the_window() {
        let mut h = setup();
        ctx("mallory.testnet", NEAR / 10, 1);
        let id = h.enter(1, H.into());
        ctx("mallory.testnet", 0, 1 + 86_400_000_000_000);
        h.reclaim(id);
        assert_eq!(h.get_entry(id).unwrap().status, EntryStatus::Reclaimed);
    }

    #[test]
    #[should_panic(expected = "too early to reclaim")]
    fn reclaim_waits_for_the_referee() {
        let mut h = setup();
        ctx("mallory.testnet", NEAR / 10, 1);
        let id = h.enter(1, H.into());
        h.reclaim(id);
    }
}
