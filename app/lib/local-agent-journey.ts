import type {
  AgentInstallation,
  DelegationProfile,
  StoredDelegation,
} from "@/db/repositories/delegation";
import type { McpAttempt } from "@/packages/domain/mcp";
import {
  controlPlaneMaintenanceCopy,
  type ControlPlaneWriteAvailability,
} from "./control-plane-write-capability";
import type { Translator } from "@/app/i18n/translate";

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
  t: Translator;
}>): LocalAgentJourney {
  const delegation = activeWorkDelegation(input.profile);
  const installation = activeLocalCodexInstallation(input.profile, delegation);

  if (!input.isAuthenticated) return state("sign_in", input.t("journey.signIn.title"), input.t("journey.signIn.detail"), input.t("journey.signIn.action"), input.links.signIn, null, null);
  if (!input.storageAvailable) return state("storage_unavailable", input.t("journey.storage.title"), input.t("journey.storage.detail"), input.t("journey.storage.action"), input.links.chooseTarget, null, null);
  if (input.writeAvailability !== "available") return state(
    "maintenance",
    controlPlaneMaintenanceCopy(input.writeAvailability, input.t).title,
    controlPlaneMaintenanceCopy(input.writeAvailability, input.t).detail,
    input.t("journey.storage.action"),
    input.links.chooseTarget,
    null,
    null,
  );
  if (!installation) {
    const hasOldConnection = input.profile?.agentInstallations.some((candidate) => candidate.status === "active") ?? false;
    return hasOldConnection
      ? state("renew_connection", input.t("journey.renew.title"), input.t("journey.renew.detail"), input.t("journey.renew.action"), input.links.connect, delegation, null)
      : state("connect_agent", input.t("journey.connect.title"), input.t("journey.connect.detail"), input.t("journey.connect.action"), input.links.connect, delegation, null);
  }
  if (input.hasAttempt) return state("work_locally", input.t("journey.work.title"), input.t("journey.work.detail"), input.t("journey.work.action"), input.links.work, delegation, installation);
  if (input.hasSelectedTarget) return state("open_attempt", input.t("journey.open.title"), input.t("journey.open.detail"), input.t("journey.open.action"), input.links.openAttempt, delegation, installation);
  return state("choose_target", input.t("journey.choose.title"), input.t("journey.choose.detail"), input.t("journey.choose.action"), input.links.chooseTarget, delegation, installation);
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
