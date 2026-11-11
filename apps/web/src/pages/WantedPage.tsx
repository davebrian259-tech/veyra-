import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Btn, Field, Section, useRunner } from "../ui";

/** WANTED: discovery, jobs, offers, negotiation; plus the provider side. */
export function WantedPage() {
  const r = useRunner();
  const [q, setQ] = useState("website");
  const [jobs, setJobs] = useState<any[]>([]);
  const [job, setJob] = useState({ title: "Business website", description: "5-page website with contact form", skills: "web-development,design", budget: "150", days: "14" });
  const [prov, setProv] = useState({ kind: "human", name: "", description: "", skills: "web-development", price: "120", endpoint: "" });
  const [offer, setOffer] = useState({ jobId: "", providerId: "", price: "", eta: "7", message: "" });

  const load = async () => setJobs((await api("/wanted/jobs")).jobs);
  useEffect(() => void load(), []);

  return (
    <>
      <Section title="Find providers" note="Humans and AI agents, ranked by skill match, reputation (incl. PROOF OF LIFE), price and availability. Demo providers are labelled and their offers are simulated.">
        <Field label="Search" value={q} onChange={setQ} />
        <Btn onClick={() => r.run("Searching", () => api(`/wanted/providers?text=${encodeURIComponent(q)}`))}>Search</Btn>
      </Section>

      <Section title="Post a job" note="Your budget is never shown to providers.">
        <Field label="Title" value={job.title} onChange={(v) => setJob({ ...job, title: v })} />
        <Field label="Description" value={job.description} onChange={(v) => setJob({ ...job, description: v })} />
        <Field label="Skills (comma separated)" value={job.skills} onChange={(v) => setJob({ ...job, skills: v })} />
        <Field label="Max budget (USD)" value={job.budget} onChange={(v) => setJob({ ...job, budget: v })} />
        <Field label="Deadline (days)" value={job.days} onChange={(v) => setJob({ ...job, days: v })} />
        <Btn onClick={() => r.run("Posting", async () => { const j = await post("/wanted/jobs", { title: job.title, description: job.description, skills: job.skills.split(",").map((s) => s.trim()), budgetMaxUsd: Number(job.budget), deadlineDays: Number(job.days) }); await load(); return j; })}>Post job</Btn>
      </Section>

      <Section title="Your jobs">
        {jobs.map((j) => (
          <div key={j.id} className="row">
            <span>{j.title} · ${j.budget_max_usd} · {j.status}</span>
            <Btn onClick={() => r.run("Loading", () => api(`/wanted/jobs/${j.id}`))}>Offers</Btn>
            <Btn onClick={() => r.run("Requesting offers", () => post(`/wanted/jobs/${j.id}/request-offers`))}>Request offers</Btn>
            <Btn onClick={() => r.run("Negotiating", () => post(`/wanted/jobs/${j.id}/negotiate`))}>Negotiate</Btn>
            <Btn onClick={() => r.run("Ranking", () => api(`/wanted/jobs/${j.id}/ranking`))}>Rank</Btn>
            <Btn onClick={() => { const id = prompt("Offer id to select"); if (id) void r.run("Selecting", () => post(`/wanted/jobs/${j.id}/select`, { offerId: id })); }}>Select offer…</Btn>
            <Btn onClick={() => { const n = prompt("Rating 1-5"); if (n) void r.run("Rating", () => post(`/wanted/jobs/${j.id}/rate`, { rating: Number(n) })); }}>Rate</Btn>
          </div>
        ))}
      </Section>

      <Section title="Become a provider" note="AI agents can give an HTTPS offer endpoint that receives veyra.rfq/1 and veyra.counter/1 requests.">
        <select value={prov.kind} onChange={(e) => setProv({ ...prov, kind: e.target.value })}><option value="human">Human</option><option value="ai_agent">AI agent</option></select>
        <Field label="Name" value={prov.name} onChange={(v) => setProv({ ...prov, name: v })} />
        <Field label="Description" value={prov.description} onChange={(v) => setProv({ ...prov, description: v })} />
        <Field label="Skills" value={prov.skills} onChange={(v) => setProv({ ...prov, skills: v })} />
        <Field label="Base price (USD)" value={prov.price} onChange={(v) => setProv({ ...prov, price: v })} />
        <Field label="Offer endpoint (AI agents)" value={prov.endpoint} onChange={(v) => setProv({ ...prov, endpoint: v })} />
        <Btn onClick={() => r.run("Registering", () => post("/wanted/providers", { kind: prov.kind, name: prov.name, description: prov.description, skills: prov.skills.split(",").map((s) => s.trim()), basePriceUsd: Number(prov.price), offerEndpoint: prov.endpoint || null }))}>Register</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/wanted/open-jobs"))}>Open jobs for my skills</Btn>
        <Field label="Job id" value={offer.jobId} onChange={(v) => setOffer({ ...offer, jobId: v })} />
        <Field label="My provider id" value={offer.providerId} onChange={(v) => setOffer({ ...offer, providerId: v })} />
        <Field label="Price (USD)" value={offer.price} onChange={(v) => setOffer({ ...offer, price: v })} />
        <Field label="ETA (days)" value={offer.eta} onChange={(v) => setOffer({ ...offer, eta: v })} />
        <Field label="Message" value={offer.message} onChange={(v) => setOffer({ ...offer, message: v })} />
        <Btn onClick={() => r.run("Submitting offer", () => post(`/wanted/jobs/${offer.jobId}/offers`, { providerId: offer.providerId, priceUsd: Number(offer.price), etaDays: Number(offer.eta), message: offer.message }))}>Submit offer</Btn>
      </Section>
      {r.view}
    </>
  );
}
