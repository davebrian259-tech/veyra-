import { Link } from "react-router";
import { ArrowUpRight01Icon, Github01Icon } from "@hugeicons/core-free-icons";
import { Icon, Mark } from "../brand";
import { NearMark } from "../game/art";
import "./footer.css";

const REPO = "https://github.com/davebrian259-tech/veyra-";
const NB = "https://testnet.nearblocks.io/address/";

type L = { label: string; to?: string; href?: string };
const COLUMNS: { title: string; links: L[] }[] = [
  { title: "Play", links: [{ label: "Vaults", to: "/play" }, { label: "Leaderboard", to: "/play/leaderboard" }, { label: "Loot", to: "/play/loot" }, { label: "Back a vault", to: "/play/underwrite" }, { label: "Fast-forward a week", to: "/play/fast-forward" }] },
  { title: "Learn", links: [{ label: "How to play", to: "/play/learn" }, { label: "Stats", to: "/play/stats" }, { label: "For judges", href: `${REPO}/blob/main/docs/HACKATHON.md` }, { label: "README", href: `${REPO}#readme` }] },
  { title: "The agent", links: [{ label: "Veyra console", to: "/app" }, { label: "Watchtower", to: "/app/watchtower" }, { label: "Evidence", to: "/app/evidence" }, { label: "Agent card", href: "/api/.well-known/agent-card.json" }] },
  { title: "On-chain", links: [{ label: "Pot contract", href: `${NB}veyra-heist-mwdwy8zz.testnet` }, { label: "Loot contract", href: `${NB}veyra-loot-mweerm0q.testnet` }, { label: "Receipt ledger", href: `${NB}veyra-mwcxvovz.testnet` }, { label: "Source code", href: REPO }] },
];

function FootLink({ l }: { l: L }) {
  if (l.to) return <Link to={l.to}>{l.label}</Link>;
  const external = l.href!.startsWith("http");
  return <a href={l.href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}{external && <Icon icon={ArrowUpRight01Icon} size={11} />}</a>;
}

/** The site footer: navigation, the contracts, the fine print, and a quiet NEAR credit at the very end. */
export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`site-foot ${compact ? "compact" : ""}`}>
      <div className="sf-top">
        <div className="sf-brand">
          <Link to="/" className="sf-mark" aria-label="Veyra home"><Mark size={30} /><span>Veyra</span></Link>
          <p>A heist game against an AI agent that pays other agents for work. Five vaults, real pots, every heist on the record.</p>
          <a className="sf-social" href={REPO} target="_blank" rel="noreferrer" aria-label="Veyra on GitHub"><Icon icon={Github01Icon} size={18} /><span>GitHub</span></a>
        </div>
        <nav className="sf-cols" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2>{c.title}</h2>
              <ul>{c.links.map((l) => <li key={l.label}><FootLink l={l} /></li>)}</ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="sf-legal">
        <p>© 2026 Veyra. Open source under the <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>.</p>
        <p>Runs on NEAR testnet. Testnet NEAR has no cash value; ranked entries, pots and loot are real testnet transactions.</p>
        <p>No sign-up and no tracking. Your practice progress stays in this browser.</p>
      </div>
      <div className="sf-near">
        <a href="https://near.org" target="_blank" rel="noreferrer"><NearMark size={11} /> Built on NEAR</a>
      </div>
    </footer>
  );
}
