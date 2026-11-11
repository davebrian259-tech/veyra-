import { useState } from "react";
import { api, post } from "../api";
import { sendAndRecord, sha256Hex, uploadEvidence } from "../flows";
import { Btn, Field, Section, useRunner } from "../ui";

/** PROOF OF LIFE: challenges, bounties, verified contributions and rewards on-chain. */
export function PolPage() {
  const r = useRunner();
  const [c, setC] = useState({ kind: "bounty", title: "", rules: "", reviewers: "", reward: "1", max: "3", days: "14" });
  const [cid, setCid] = useState("0");
  const [contributor, setContributor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const tx = (label: string, path: string, body: unknown, action: string) =>
    r.run(label, async () => {
      const prep = await post(path, body);
      return sendAndRecord(prep.walletTransactions, (h) => post("/pol/tx", { action, txHash: h, challengeId: cid }));
    });

  return (
    <>
      <Section title="Explore">
        <Btn onClick={() => r.run("Loading", () => api("/pol/challenges"))}>Challenges</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/pol/leaderboard"))}>Leaderboard</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/pol/treasury"))}>Treasury</Btn>
        <Btn onClick={() => { const a = prompt("Account id"); if (a) void r.run("Loading", () => api(`/pol/contributors/${a}`)); }}>Contributor profile…</Btn>
      </Section>

      <Section title="Create a challenge" note="The reward pool is locked in the contract up front. Rules stay off-chain; their SHA-256 is anchored.">
        <select value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })}><option value="bounty">Bounty</option><option value="challenge">Challenge</option><option value="community_objective">Community objective</option></select>
        <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
        <Field label="Rules" value={c.rules} onChange={(v) => setC({ ...c, rules: v })} textarea />
        <Field label="Reviewers (comma separated)" value={c.reviewers} onChange={(v) => setC({ ...c, reviewers: v })} />
        <Field label="Reward per approval (NEAR)" value={c.reward} onChange={(v) => setC({ ...c, reward: v })} />
        <Field label="Max approvals" value={c.max} onChange={(v) => setC({ ...c, max: v })} />
        <Field label="Deadline (days)" value={c.days} onChange={(v) => setC({ ...c, days: v })} />
        <Btn onClick={async () => tx("Creating", "/pol/challenges", { kind: c.kind, title: c.title, rulesHash: `sha256:${await sha256Hex(c.rules)}`, reviewers: c.reviewers.split(",").map((s) => s.trim()).filter(Boolean), rewardNear: c.reward, maxApprovals: Number(c.max), deadlineDays: Number(c.days) }, "create")}>Create & fund (sign)</Btn>
      </Section>

      <Section title="Contribute / review">
        <Field label="Challenge id" value={cid} onChange={setCid} />
        <Btn onClick={() => r.run("Loading", () => api(`/pol/challenges/${cid}`))}>Details</Btn>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Btn disabled={!file} onClick={() => r.run("Submitting", async () => {
          const ev = await uploadEvidence(file!);
          const prep = await post(`/pol/challenges/${cid}/submit`, { evidenceHash: ev.evidenceHash, evidenceUri: ev.uri });
          return sendAndRecord(prep.walletTransactions, (h) => post("/pol/tx", { action: "submit", txHash: h, challengeId: cid }));
        })}>Submit evidence</Btn>
        <Field label="Contributor (to review)" value={contributor} onChange={setContributor} />
        <Btn onClick={() => tx("Approving", `/pol/challenges/${cid}/review`, { contributor, approve: true }, "review")}>Approve & pay</Btn>
        <Btn danger onClick={() => tx("Rejecting", `/pol/challenges/${cid}/review`, { contributor, approve: false }, "review")}>Reject</Btn>
        <Btn onClick={() => tx("Closing", `/pol/challenges/${cid}/close`, {}, "close")}>Close & reclaim pool</Btn>
      </Section>
      {r.view}
    </>
  );
}
