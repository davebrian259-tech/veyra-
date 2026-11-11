use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const DAY: u64 = 86_400_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("escrow.veyra.testnet"))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts);
    testing_env!(b.build());
}

fn two_milestones() -> Vec<MilestoneInput> {
    vec![
        MilestoneInput { title: "Design".into(), amount: U128(2 * NEAR) },
        MilestoneInput { title: "Build".into(), amount: U128(3 * NEAR) },
    ]
}

/// Creates a funded native escrow: payer agent.near, approver alice.near, provider bob.near.
fn setup(review_period: u64) -> (Contract, U64) {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("agent.near", 1 * NEAR + 5 * NEAR, 10);
    let id = c.create_escrow(
        acc("bob.near"),
        Asset::Native,
        two_milestones(),
        U64(10 + 7 * DAY),
        "sha256:terms".into(),
        Some(U64(review_period)),
        Some(acc("alice.near")),
        None,
        Some(acc("arbiter.near")),
        None,
    );
    (c, id)
}

#[test]
fn create_and_fund_in_one_call() {
    let (c, id) = setup(0);
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.status, EscrowStatus::Active);
    assert_eq!(e.funded, U128(5 * NEAR));
    assert_eq!(e.total, U128(5 * NEAR));
    assert_eq!(e.approver, acc("alice.near"));
    assert!(get_logs().iter().any(|l| l.contains("escrow_funded")));
    assert_eq!(c.get_escrows_for(acc("bob.near")).len(), 1);
    assert_eq!(c.get_escrows_for(acc("alice.near")).len(), 1);
}

#[test]
#[should_panic(expected = "storage")]
fn create_requires_storage() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("agent.near", 0, 10);
    c.create_escrow(acc("bob.near"), Asset::Native, two_milestones(), U64(DAY), "h".into(), None, None, None, None, None);
}

#[test]
fn staged_funding_activates_when_full() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("alice.near", NEAR, 10);
    let id = c.create_escrow(acc("bob.near"), Asset::Native, two_milestones(), U64(DAY), "h".into(), None, None, None, None, None);
    assert_eq!(c.get_escrow(id).unwrap().status, EscrowStatus::AwaitingFunding);
    ctx("alice.near", 2 * NEAR, 11);
    c.deposit(id);
    assert_eq!(c.get_escrow(id).unwrap().status, EscrowStatus::AwaitingFunding);
    ctx("alice.near", 4 * NEAR, 12);
    c.deposit(id); // 1 NEAR excess is returned
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.status, EscrowStatus::Active);
    assert_eq!(e.funded, U128(5 * NEAR));
}

#[test]
#[should_panic(expected = "only the payer")]
fn stranger_cannot_fund() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("alice.near", NEAR, 10);
    let id = c.create_escrow(acc("bob.near"), Asset::Native, two_milestones(), U64(DAY), "h".into(), None, None, None, None, None);
    ctx("mallory.near", 5 * NEAR, 11);
    c.deposit(id);
}

#[test]
fn happy_path_release_by_approver() {
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), Some("ipfs://x".into()));
    ctx("alice.near", 0, 30);
    c.accept_milestone(id, 0);
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.milestones[0].status, MilestoneStatus::Released);
    assert_eq!(e.released, U128(2 * NEAR));
    assert_eq!(e.status, EscrowStatus::Active);
    ctx("bob.near", NEAR / 100, 40);
    c.submit_evidence(id, 1, "sha256:def".into(), None);
    ctx("alice.near", 0, 50);
    c.accept_milestone(id, 1);
    assert_eq!(c.get_escrow(id).unwrap().status, EscrowStatus::Completed);
}

#[test]
#[should_panic(expected = "only the approver or reviewer")]
fn agent_payer_cannot_release_funds() {
    // The AI agent's account funds the escrow but can never accept work.
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
    ctx("agent.near", 0, 30);
    c.accept_milestone(id, 0);
}

#[test]
#[should_panic(expected = "only the approver or reviewer")]
fn provider_cannot_release_own_work() {
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
    c.accept_milestone(id, 0);
}

#[test]
#[should_panic(expected = "milestone was not submitted")]
fn cannot_release_without_evidence() {
    let (mut c, id) = setup(0);
    ctx("alice.near", 0, 30);
    c.accept_milestone(id, 0);
}

#[test]
#[should_panic(expected = "only the provider")]
fn only_provider_submits() {
    let (mut c, id) = setup(0);
    ctx("mallory.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
}

#[test]
fn reject_then_resubmit() {
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:v1".into(), None);
    ctx("alice.near", 0, 30);
    c.reject_milestone(id, 0, "missing pages".into());
    assert_eq!(c.get_escrow(id).unwrap().milestones[0].status, MilestoneStatus::Rejected);
    ctx("bob.near", NEAR / 100, 40);
    c.submit_evidence(id, 0, "sha256:v2".into(), None);
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.milestones[0].status, MilestoneStatus::Submitted);
    assert_eq!(e.milestones[0].evidence.len(), 2);
}

#[test]
#[should_panic(expected = "escrow is not active")]
fn dispute_freezes_release() {
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
    ctx("alice.near", 0, 30);
    c.open_dispute(id, Some(0), "work is plagiarised".into());
    c.accept_milestone(id, 0);
}

#[test]
fn arbiter_resolves_dispute_split() {
    let (mut c, id) = setup(0);
    ctx("bob.near", 0, 20);
    c.open_dispute(id, None, "payer unresponsive".into());
    ctx("arbiter.near", 0, 30);
    c.resolve_dispute(id, U128(NEAR), "partial work delivered".into());
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.status, EscrowStatus::Completed);
    assert_eq!(e.released, U128(NEAR));
    assert_eq!(e.refunded, U128(4 * NEAR));
    assert!(e.milestones.iter().all(|m| m.status == MilestoneStatus::Resolved));
}

#[test]
#[should_panic(expected = "only the arbiter")]
fn approver_cannot_resolve_own_dispute() {
    let (mut c, id) = setup(0);
    ctx("alice.near", 0, 20);
    c.open_dispute(id, None, "x".into());
    c.resolve_dispute(id, U128(0), "self-serving".into());
}

#[test]
fn refund_after_deadline_keeps_submitted_work() {
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
    ctx("anyone.near", 0, 10 + 8 * DAY);
    c.refund_expired(id);
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.milestones[0].status, MilestoneStatus::Submitted);
    assert_eq!(e.milestones[1].status, MilestoneStatus::Refunded);
    assert_eq!(e.refunded, U128(3 * NEAR));
    assert_eq!(e.status, EscrowStatus::Active);
}

#[test]
#[should_panic(expected = "deadline has not passed")]
fn no_early_refund() {
    let (mut c, id) = setup(0);
    ctx("alice.near", 0, 20);
    c.refund_expired(id);
}

#[test]
#[should_panic(expected = "deadline has passed")]
fn no_submission_after_deadline() {
    let (mut c, id) = setup(0);
    ctx("bob.near", NEAR / 100, 10 + 8 * DAY);
    c.submit_evidence(id, 0, "sha256:late".into(), None);
}

#[test]
fn provider_claims_after_review_period() {
    let (mut c, id) = setup(DAY);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
    ctx("bob.near", 0, 20 + DAY);
    c.claim_after_review_period(id, 0);
    assert_eq!(c.get_escrow(id).unwrap().milestones[0].status, MilestoneStatus::Released);
}

#[test]
#[should_panic(expected = "review period has not elapsed")]
fn provider_cannot_claim_early() {
    let (mut c, id) = setup(DAY);
    ctx("bob.near", NEAR / 100, 20);
    c.submit_evidence(id, 0, "sha256:abc".into(), None);
    ctx("bob.near", 0, 21);
    c.claim_after_review_period(id, 0);
}

#[test]
fn provider_withdraw_refunds_everything_open() {
    let (mut c, id) = setup(0);
    ctx("bob.near", 0, 20);
    c.provider_withdraw(id);
    let e = c.get_escrow(id).unwrap();
    assert_eq!(e.status, EscrowStatus::Refunded);
    assert_eq!(e.refunded, U128(5 * NEAR));
}

#[test]
fn cancel_before_funding() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("alice.near", NEAR, 10);
    let id = c.create_escrow(acc("bob.near"), Asset::Native, two_milestones(), U64(DAY), "h".into(), None, None, None, None, None);
    c.cancel_escrow(id);
    assert_eq!(c.get_escrow(id).unwrap().status, EscrowStatus::Cancelled);
}

#[test]
fn ft_funding_via_transfer_call() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    let usdc = acc("usdc.fakes.testnet");
    ctx("alice.near", NEAR, 10);
    let id = c.create_escrow(
        acc("bob.near"),
        Asset::Ft { contract_id: usdc.clone() },
        vec![MilestoneInput { title: "Site".into(), amount: U128(150_000_000) }],
        U64(DAY),
        "h".into(), None, None, None, None, None,
    );
    ctx("usdc.fakes.testnet", 0, 11);
    let res = c.ft_on_transfer(acc("alice.near"), U128(200_000_000), format!("{{\"escrow_id\":\"{}\"}}", id.0));
    match res {
        PromiseOrValue::Value(unused) => assert_eq!(unused, U128(50_000_000)),
        _ => panic!("expected value"),
    }
    assert_eq!(c.get_escrow(id).unwrap().status, EscrowStatus::Active);
}

#[test]
#[should_panic(expected = "token does not match")]
fn wrong_token_rejected() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("alice.near", NEAR, 10);
    let id = c.create_escrow(
        acc("bob.near"),
        Asset::Ft { contract_id: acc("usdc.fakes.testnet") },
        vec![MilestoneInput { title: "Site".into(), amount: U128(150) }],
        U64(DAY), "h".into(), None, None, None, None, None,
    );
    ctx("evil-token.testnet", 0, 11);
    c.ft_on_transfer(acc("alice.near"), U128(150), format!("{{\"escrow_id\":\"{}\"}}", id.0));
}

#[test]
#[should_panic(expected = "provider cannot approve")]
fn provider_cannot_be_approver() {
    ctx("owner.near", 0, 1);
    let mut c = Contract::new(acc("owner.near"));
    ctx("alice.near", NEAR, 10);
    c.create_escrow(acc("bob.near"), Asset::Native, two_milestones(), U64(DAY), "h".into(), None, Some(acc("bob.near")), None, None, None);
}
