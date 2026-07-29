import type {
  AgentInstallation,
  DelegationProfile,
  StoredDelegation,
} from "@/db/repositories/delegation";
import type { McpAttempt } from "@/packages/domain/mcp";
import type { ControlPlaneWriteAvailability } from "./control-plane-write-capability";

export type LocalAgentJourneyStage =
  | "sign_in"
  | "storage_unavailable"
  | "maintenance"
  | "connect_agent"
  | "renew_connection"
  | "choose_target"
  | "open_attempt"
  | "work_locally";

export type LocalAgentJourney = Readonly<{
  stage: LocalAgentJourneyStage;
  title: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
  activeDelegation: StoredDelegation | null;
  activeInstallation: AgentInstallation | null;
}>;

type JourneyLinks = Readonly<{
  signIn: string;
  connect: string;
  chooseTarget: string;
  openAttempt: string;
  work: string;
}>;

export function activeWorkDelegation(
  profile: DelegationProfile | null,
  now = Date.now(),
): StoredDelegation | null {
  return profile?.delegations.find((delegation) => isActiveWorkDelegation(profile, delegation, now)) ?? null;
}

export function activeAttemptDelegation(
  profile: DelegationProfile | null,
  attempt: McpAttempt | null,
  now = Date.now(),
): StoredDelegation | null {
  if (!profile || !attempt?.delegationScope || !attempt.agentId) return null;
  return profile.delegations.find((delegation) =>
    delegation.agentId === attempt.agentId &&
    delegation.scopes.includes(attempt.delegationScope!) &&
    isActiveWorkDelegation(profile, delegation, now),
  ) ?? null;
}

export function reusableAgentDelegation(
  profile: DelegationProfile,
  input: Readonly<{
    agentId: string;
    agentPublicKey: string;
    requiredScopes: readonly string[];
  }>,
  now = Date.now(),
): StoredDelegation | null {
  return profile.delegations
    .filter((delegation) =>
      delegation.agentId === input.agentId &&
      delegation.agentPublicKey === input.agentPublicKey &&
      input.requiredScopes.every((scope) => delegation.scopes.includes(scope)) &&
      delegation.revokedAt === null &&
      delegation.signerKeyRevokedAt === null &&
      Date.parse(delegation.validFrom) <= now &&
      now < Date.parse(delegation.validUntil),
    )
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0] ?? null;
}

function isActiveWorkDelegation(
  profile: DelegationProfile,
  delegation: StoredDelegation,
  now: number,
): boolean {
  return (
    delegation.revokedAt === null &&
    delegation.signerKeyRevokedAt === null &&
    delegation.scopes.some((scope) => scope === "formalize" || scope === "prove") &&
    Date.parse(delegation.validFrom) <= now &&
    now < Date.parse(delegation.validUntil) &&
    profile.agents.some((agent) =>
      agent.id === delegation.agentId &&
      agent.status === "active" &&
      agent.revokedAt === null,
    )
  );
}

export function activeLocalCodexInstallation(
  profile: DelegationProfile | null,
  delegation = activeWorkDelegation(profile),
): AgentInstallation | null {
  if (!profile || !delegation) return null;
  return profile.agentInstallations.find((installation) =>
    installation.status === "active" &&
    installation.agentId === delegation.agentId &&
    installation.delegationCertificateId === delegation.id,
  ) ?? null;
}

export function activeLocalAgentAttempt(
  profile: DelegationProfile | null,
  attempts: readonly McpAttempt[],
  installation = activeLocalCodexInstallation(profile),
): McpAttempt | null {
  if (!installation) return null;
  return attempts.find((attempt) =>
    (attempt.status === "active" || attempt.status === "paused") &&
    attempt.agentId === installation.agentId &&
    profile?.delegations.some((delegation) =>
      delegation.id === installation.delegationCertificateId &&
      delegation.agentId === attempt.agentId &&
      Boolean(attempt.delegationScope && delegation.scopes.includes(attempt.delegationScope)),
    ),
  ) ?? null;
}

export function localAgentJourney(input: Readonly<{
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  storageAvailable: boolean;
  hasAttempt: boolean;
  hasSelectedTarget: boolean;
  writeAvailability: ControlPlaneWriteAvailability;
  links: JourneyLinks;
}>): LocalAgentJourney {
  const delegation = activeWorkDelegation(input.profile);
  const installation = activeLocalCodexInstallation(input.profile, delegation);

  if (!input.isAuthenticated) return state("sign_in", "Sign in to begin an attributable research record.", "Proofweave creates a Person record only after sign-in. You can still inspect the public frontier without an account.", "Sign in to begin", input.links.signIn, null, null);
  if (!input.storageAvailable) return state("storage_unavailable", "Your account control plane is temporarily unavailable.", "Proofweave will not create a local fallback for Agent authority or contribution records while durable storage is unavailable.", "Browse public research", input.links.chooseTarget, null, null);
  if (input.writeAvailability !== "available") return state(
    "maintenance",
    input.writeAvailability === "checking"
      ? "Checking whether research updates are available."
      : "Research updates are paused for maintenance.",
    input.writeAvailability === "read_only"
      ? "Your questions, activity, and evidence remain readable. Actions that create or change research will return after maintenance."
      : "Existing records remain readable. Write actions stay closed until Proofweave can confirm the service is ready.",
    "Browse public research",
    input.links.chooseTarget,
    null,
    null,
  );
  if (!installation) {
    const hasOldConnection = input.profile?.agentInstallations.some((candidate) => candidate.status === "active") ?? false;
    return hasOldConnection
      ? state("renew_connection", "Reconnect your Agent before continuing.", "Proofweave keeps your existing research tasks and reconnects compatible authority without asking you to recreate them.", "Reconnect Agent", input.links.connect, delegation, null)
      : state("connect_agent", "Connect your Agent once.", "A browser approval links your local Codex to your account. You never need to paste an API key, public key, or workspace.", "Connect Agent", input.links.connect, delegation, null);
  }
  if (input.hasAttempt) return state("work_locally", "Continue research in Codex.", "Your project and private exploration remain on your computer. You choose which concise progress or evidence may be recorded.", "Continue in Codex", input.links.work, delegation, installation);
  if (input.hasSelectedTarget) return state("open_attempt", "Start research on this question.", "Proofweave saves the exact public question and assigns it to your connected Agent. This does not claim progress or run Lean.", "Start research", input.links.openAttempt, delegation, installation);
  return state("choose_target", "Choose a mathematical question.", "Each task starts from a precise public source so your Agent can build on shared work instead of repeating it.", "Choose a question", input.links.chooseTarget, delegation, installation);
}

function state(
  stage: LocalAgentJourneyStage,
  title: string,
  detail: string,
  actionLabel: string,
  actionHref: string,
  activeDelegation: StoredDelegation | null,
  activeInstallation: AgentInstallation | null,
): LocalAgentJourney {
  return { stage, title, detail, actionLabel, actionHref, activeDelegation, activeInstallation };
}
