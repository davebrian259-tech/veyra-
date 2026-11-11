import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Btn, Section, useRunner } from "../ui";

/** Operations (submitted → confirmed → settled), notifications, audit trail and AI runs. */
export function ActivityPage() {
  const r = useRunner();
  const [live, setLive] = useState<string[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/events", { withCredentials: true });
    const push = (e: MessageEvent) => setLive((l) => [`${new Date().toLocaleTimeString()} ${e.type}: ${JSON.parse(e.data).title ?? ""} ${JSON.stringify(JSON.parse(e.data).data ?? {})}`, ...l].slice(0, 50));
    for (const t of ["operation.status", "operation.settled", "operation.failed", "bodyguard.blocked", "approval.requested", "agent.frozen", "agent.created", "agent.grant", "escrow.status", "swap.settled", "tx.failed", "wanted.offer"]) es.addEventListener(t, push);
    return () => es.close();
  }, []);

  return (
    <>
      <Section title="Activity">
        <Btn onClick={() => r.run("Loading", () => api("/operations"))}>Operations</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/notifications"))}>Notifications</Btn>
        <Btn onClick={() => r.run("Marking", () => post("/notifications/read", { ids: "all" }))}>Mark all read</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/audit"))}>Audit trail</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/ai/runs"))}>AI runs</Btn>
        <Btn onClick={() => r.run("Attesting (may take ~20s)", () => api("/ai/attestation"))}>NEAR AI Cloud attestation</Btn>
      </Section>
      <Section title="Live events">
        <pre className="json">{live.join("\n") || "Waiting for events…"}</pre>
      </Section>
      {r.view}
    </>
  );
}
