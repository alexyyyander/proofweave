import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { getDelegationRepository, type DelegationProfile, type StoredDelegation } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { Footer, Header, ProductStateBadge } from "../ui";

export const dynamic = "force-dynamic";

type StartStage = "preview" | "identity" | "delegation" | "target" | "unavailable";

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[] }>;
}) {
  const user = await getChatGPTUser();
  const requestedTarget = requestedTargetSlug(await searchParams);
  const [catalog, account] = await Promise.all([loadCatalog(), loadAccount(user)]);
  const selectedTarget = catalog.find((target) => target.slug === requestedTarget) ?? catalog[0] ?? null;
  const stage = startStage({ user, profile: account.profile, storageAvailable: account.storageAvailable });
  const action = primaryAction({ stage, selectedTarget, signInPath: chatGPTSignInPath(startReturnPath(selectedTarget)) });

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="journey-main">
        <section className="journey-hero" aria-labelledby="journey-title">
          <div>
            <p className="eyebrow">Your first accountable contribution</p>
            <h1 id="journey-title">{headlineFor(stage)}</h1>
            <p>{descriptionFor(stage, user, selectedTarget)}</p>
            <div className="button-row">
              <Link className="button button-primary" href={action.href}>{action.label}<span aria-hidden="true">→</span></Link>
              <Link className="button button-secondary" href={stage === "preview" ? "/demo" : "/explore"}>{stage === "preview" ? "See the verified demo" : "Browse open mathematics"}</Link>
            </div>
          </div>
          <aside className="journey-status-card" aria-label="Alpha capability boundary">
            <div><ProductStateBadge tone="provisional">Closed alpha</ProductStateBadge><strong>Personal delegation is available.</strong></div>
            <p>Create your Person record, issue a revocable certificate, and open a source-pinned Attempt today.</p>
            <div className="journey-status-line"><ProductStateBadge tone="not-deployed">Remote execution in preparation</ProductStateBadge><span>Proofweave will not simulate Agent work or Lean results.</span></div>
          </aside>
        </section>

        <ol className="journey-steps" aria-label="First contribution journey">
          <JourneyStep number="01" title="Understand the evidence" detail="Inspect a complete, verified reference proof before you connect anything." state={stage === "preview" ? "current" : "complete"} />
          <JourneyStep number="02" title="Create your identity" detail="Sign in to create the Person record that will receive attribution." state={stage === "identity" ? "current" : stage === "preview" ? "next" : "complete"} />
          <JourneyStep number="03" title="Delegate an Agent" detail="Create a device key, register the Agent public key, and sign only the scopes you intend." state={stage === "delegation" ? "current" : stage === "preview" || stage === "identity" ? "next" : "complete"} />
          <JourneyStep number="04" title="Choose a target" detail="Select one pinned public mathematical record, rather than an unbounded chat." state={stage === "target" ? "current" : stage === "unavailable" ? "next" : "next"} />
          <JourneyStep number="05" title="Open an Attempt" detail="Start a durable workspace. Agent progress and verification must arrive separately." state="next" />
        </ol>

        <section className="journey-next" aria-labelledby="journey-next-title">
          <div>
            <p className="eyebrow">Your next move</p>
            <h2 id="journey-next-title">{action.title}</h2>
            <p>{action.detail}</p>
          </div>
          <Link className="button button-primary" href={action.href}>{action.label}<span aria-hidden="true">→</span></Link>
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
            <li><span>1</span><p><strong>Bounded workspace</strong> Your Person, Agent authority, and catalog revision are durably linked.</p></li>
            <li><span>2</span><p><strong>Signed Agent event</strong> A real Agent may report work only through its authorized path.</p></li>
            <li><span>3</span><p><strong>Lean and independent verification</strong> Evidence must satisfy separate technical and social gates before credit counts.</p></li>
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

function startStage({ user, profile, storageAvailable }: { user: ChatGPTUser | null; profile: DelegationProfile | null; storageAvailable: boolean }): StartStage {
  if (!user) return "preview";
  if (!storageAvailable || !profile) return "unavailable";
  return activeWorkDelegation(profile) ? "target" : "delegation";
}

function primaryAction({ stage, selectedTarget, signInPath }: { stage: StartStage; selectedTarget: CatalogProblem | null; signInPath: string }) {
  if (stage === "preview") return {
    title: "Start with your personal Proofweave identity.",
    detail: "Sign in first. Proofweave then creates an attributable Person record instead of a disposable workspace.",
    label: "Sign in to begin",
    href: signInPath,
  };
  if (stage === "unavailable") return {
    title: "Your delegation profile is temporarily unavailable.",
    detail: "No key, certificate, or Attempt will be created without durable storage. You can continue to inspect public research while this recovers.",
    label: "Browse public research",
    href: "/explore",
  };
  if (stage === "delegation") return {
    title: "Create scoped authority before you open research work.",
    detail: "The workspace will guide you through a Person signing key, an Agent public key, and a revocable formalize or prove delegation.",
    label: "Set up my Agent",
    href: "/workbench#delegation-setup",
  };
  if (!selectedTarget) return {
    title: "Choose a public target once the catalog is available.",
    detail: "A bounded Attempt always starts from an immutable source record.",
    label: "Browse open mathematics",
    href: "/explore",
  };
  return {
    title: `Open an Attempt for ${selectedTarget.title}.`,
    detail: "This creates the accountable workspace. It does not claim Agent progress, a Lean result, or a contribution receipt.",
    label: "Open a bounded Attempt",
    href: `/workbench?target=${encodeURIComponent(selectedTarget.slug)}#attempt-queue`,
  };
}

function headlineFor(stage: StartStage): string {
  if (stage === "preview") return "Start a real research record, one bounded step at a time.";
  if (stage === "delegation") return "Connect the authority behind your research Agent.";
  if (stage === "target") return "Choose the first mathematical question your Agent will approach.";
  return "Your accountable research path is waiting for its storage layer.";
}

function descriptionFor(stage: StartStage, user: ChatGPTUser | null, target: CatalogProblem | null): string {
  if (stage === "preview") return "You do not need to write Lean to begin. First establish who receives credit, then delegate only the research work you want an Agent to do.";
  if (stage === "delegation") return `${user?.displayName ?? "Your account"} is connected. The next step is a scoped, revocable certificate—not a permanent grant of authority.`;
  if (stage === "target") return `${target ? `${target.title} is selected` : "A public target is ready"}. Open one bounded Attempt when you are ready to create a durable workspace.`;
  return "Public catalog records remain available, but Proofweave will not fall back to local or simulated attribution while account storage is unavailable.";
}

function activeWorkDelegation(profile: DelegationProfile): StoredDelegation | null {
  const now = Date.now();
  return profile.delegations.find((delegation) =>
    delegation.revokedAt === null &&
    delegation.signerKeyRevokedAt === null &&
    delegation.scopes.some((scope) => scope === "formalize" || scope === "prove") &&
    profile.agents.some((agent) => agent.id === delegation.agentId && agent.status === "active" && agent.revokedAt === null) &&
    Date.parse(delegation.validFrom) <= now && now < Date.parse(delegation.validUntil),
  ) ?? null;
}

async function loadAccount(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; storageAvailable: boolean }> {
  if (!user) return { profile: null, storageAvailable: true };
  try {
    return {
      profile: await getDelegationRepository().getProfile({ provider: "chatgpt", subject: user.email, displayName: user.displayName }),
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, storageAvailable: false };
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
