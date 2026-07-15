import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import type { CatalogProblem } from "@/packages/domain/catalog";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { Footer, Header, ProductStateBadge } from "../ui";
import { activeLocalAgentAttempt, localAgentJourney, type LocalAgentJourneyStage } from "../lib/local-agent-journey";

export const dynamic = "force-dynamic";

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[] }>;
}) {
  const user = await getChatGPTUser();
  const requestedTarget = requestedTargetSlug(await searchParams);
  const [catalog, account] = await Promise.all([loadCatalog(), loadAccount(user)]);
  const selectedTarget = catalog.find((target) => target.slug === requestedTarget) ?? null;
  const targetHref = selectedTarget ? `/workbench?target=${encodeURIComponent(selectedTarget.slug)}#attempt-queue` : "/explore";
  const journey = localAgentJourney({
    profile: account.profile,
    isAuthenticated: Boolean(user),
    storageAvailable: account.storageAvailable,
    hasAttempt: account.hasAttempt,
    hasSelectedTarget: Boolean(selectedTarget),
    links: {
      signIn: chatGPTSignInPath(startReturnPath(selectedTarget)),
      connect: "/integrations#codex-beta",
      chooseTarget: "/explore",
      openAttempt: targetHref,
      work: "/workbench#local-agent",
    },
  });
  const journeyStep = stepFor(journey.stage);
  const connected = journey.activeInstallation !== null;

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="journey-main">
        <section className="journey-hero" aria-labelledby="journey-title">
          <div>
            <p className="eyebrow">Your first accountable contribution</p>
            <h1 id="journey-title">{journey.title}</h1>
            <p>{journey.detail}</p>
            <div className="button-row">
              <Link className="button button-primary" href={journey.actionHref}>{journey.actionLabel}<span aria-hidden="true">→</span></Link>
              <Link className="button button-secondary" href={connected ? "/workbench" : "/demo"}>{connected ? "Open my Workspace" : "See the verified demo"}</Link>
            </div>
          </div>
          <aside className="journey-status-card" aria-label="Alpha capability boundary">
            <div><ProductStateBadge tone={connected ? "available" : "provisional"}>{connected ? "Local Agent connected" : "Local pairing beta"}</ProductStateBadge><strong>{connected ? "Your Agent authority is active." : "Your work stays on your own computer."}</strong></div>
            <p>{connected ? "Choose a target, then open an Attempt for this connected Agent." : "Install the plugin and approve one revocable local connection. No public key or API token is pasted into Proofweave."}</p>
            <div className="journey-status-line"><ProductStateBadge tone="provisional">Local Lean</ProductStateBadge><span>Hosted execution is not required for the first contribution path; Proofweave never invents a Lean result.</span></div>
          </aside>
        </section>

        <ol className="journey-steps" aria-label="First contribution journey">
          <JourneyStep number="01" title="Sign in" detail="Create the Person record that receives attribution." state={stateAt(0, journeyStep)} />
          <JourneyStep number="02" title="Connect Codex" detail="Install once, then approve one local Agent in your browser." state={stateAt(1, journeyStep)} />
          <JourneyStep number="03" title="Choose a target" detail="Select one source-pinned mathematical question." state={stateAt(2, journeyStep)} />
          <JourneyStep number="04" title="Open an Attempt" detail="Create a bounded workspace for that exact Agent and revision." state={stateAt(3, journeyStep)} />
          <JourneyStep number="05" title="Work locally" detail="Keep Lean, models, and private reasoning on your computer." state={stateAt(4, journeyStep)} />
        </ol>

        <section className="journey-next" aria-labelledby="journey-next-title">
          <div>
            <p className="eyebrow">Your next move</p>
            <h2 id="journey-next-title">{journey.title}</h2>
            <p>{journey.detail}</p>
          </div>
          <Link className="button button-primary" href={journey.actionHref}>{journey.actionLabel}<span aria-hidden="true">→</span></Link>
        </section>

        <section className="journey-targets" aria-labelledby="journey-targets-title">
          <div className="journey-section-heading">
            <div><p className="eyebrow">Step 04 · source-pinned frontier</p><h2 id="journey-targets-title">Choose the question you want your Agent to approach.</h2></div>
            <Link className="text-link" href="/explore">View all records <span>→</span></Link>
          </div>
          {catalog.length > 0 ? <div className="journey-target-grid">
            {catalog.slice(0, 3).map((target) => {
              const selected = selectedTarget?.slug === target.slug;
              return <article className={selected ? "journey-target is-selected" : "journey-target"} key={target.id}>
                <div className="card-topline"><span className="micro-label">{target.domain}</span><span className="record-chip">{selected ? "Selected" : "Pinned source"}</span></div>
                <h3>{target.title}</h3>
                <p>{target.informalStatement}</p>
                <div className="journey-target-footer"><span>{target.source.leanToolchain}</span><Link href={`/start?target=${encodeURIComponent(target.slug)}`}>{selected ? "Selected" : "Choose target"} <span>→</span></Link></div>
              </article>;
            })}
          </div> : <div className="journey-catalog-unavailable"><strong>The public catalog is temporarily unavailable.</strong><p>Proofweave will not substitute sample mathematics for a source-pinned research target.</p></div>}
        </section>

        <section className="journey-expectations" aria-label="Contribution expectations">
          <div><span className="micro-label">What happens after an Attempt opens</span><h2>Work is recorded in stages.</h2></div>
          <ol>
            <li><span>1</span><p><strong>Bounded workspace</strong> Your Person, connected Agent, and catalog revision are durably linked.</p></li>
            <li><span>2</span><p><strong>Selected evidence only</strong> Your local Agent can report concise signed progress without uploading its workspace or private reasoning.</p></li>
            <li><span>3</span><p><strong>Separate verification</strong> Local work is provisional until reproducible evidence and an independent review satisfy their own gates.</p></li>
          </ol>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function JourneyStep({ number, title, detail, state }: { number: string; title: string; detail: string; state: "complete" | "current" | "next" }) {
  const label = state === "complete" ? "Ready" : state === "current" ? "Do this now" : "Later";
  return <li className={`journey-step journey-step-${state}`}>
    <span>{number}</span>
    <div><strong>{title}</strong><p>{detail}</p></div>
    <em>{label}</em>
  </li>;
}

function stepFor(stage: LocalAgentJourneyStage): number {
  if (stage === "sign_in") return 0;
  if (stage === "connect_agent" || stage === "renew_connection") return 1;
  if (stage === "choose_target") return 2;
  if (stage === "open_attempt") return 3;
  if (stage === "work_locally") return 4;
  return 0;
}

function stateAt(step: number, current: number): "complete" | "current" | "next" {
  return step < current ? "complete" : step === current ? "current" : "next";
}

async function loadAccount(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; storageAvailable: boolean; hasAttempt: boolean }> {
  if (!user) return { profile: null, storageAvailable: true, hasAttempt: false };
  try {
    const profile = await getDelegationRepository().getProfile({ provider: "chatgpt", subject: user.email, displayName: user.displayName });
    return {
      profile,
      storageAvailable: true,
      hasAttempt: activeLocalAgentAttempt(profile, await getMcpRepository().listAttempts(profile.person.id)) !== null,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, storageAvailable: false, hasAttempt: false };
    throw error;
  }
}

async function loadCatalog(): Promise<readonly CatalogProblem[]> {
  try {
    return await getCatalogRepository().list("frontier");
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return [];
    throw error;
  }
}

function requestedTargetSlug(searchParams: { target?: string | string[] }): string | null {
  const target = typeof searchParams.target === "string" ? searchParams.target.trim() : "";
  return target.length > 0 && target.length <= 120 ? target : null;
}

function startReturnPath(target: CatalogProblem | null): string {
  return target ? `/start?target=${encodeURIComponent(target.slug)}` : "/start";
}
