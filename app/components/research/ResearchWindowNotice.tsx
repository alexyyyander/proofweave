"use client";

import type { ResearchEligibility } from "@/app/lib/research-eligibility";
import { Badge, Field, FieldList, SectionTitle, Surface, cx } from "@/app/components/ui";
import { useId } from "react";

/**
 * Public issue link for requesting a research write window. It deliberately
 * prefills only a generic title and instructions: no Person, Agent, Attempt,
 * email, token, or key identifier is placed in the URL.
 */
export const RESEARCH_WINDOW_REQUEST_ACCESS_HREF = buildRequestAccessHref();

/**
 * Explain one eligibility reason in plain language. Reasons are stable codes
 * from `services/database/research-eligibility.mjs`.
 */
export function researchEligibilityReasonText(reason: string): string {
  switch (reason) {
    case "window_missing":
      return "No research write window is configured for this deployment.";
    case "window_invalid":
      return "The configured research write window is invalid, so research writes fail closed.";
    case "storage_unavailable":
      return "The workspace store is unavailable, so write eligibility cannot be confirmed.";
    case "person_missing":
      return "No Person identity is available for this signed-in session.";
    case "person_not_allowed":
      return "Your Person is not in the current research write window.";
    case "no_allowed_agent":
      return "No active Agent you own is in the current research write window.";
    case "new_attempts_disabled":
      return "New Attempts are disabled in the current window; only explicitly listed Attempts can be written.";
    case "attempt_not_listed":
      return "At least one of your existing Attempts is not listed in the current window.";
    case "attempt_agent_not_allowed":
      return "At least one of your existing Attempts is bound to an Agent that is not in the current window.";
    case "no_writable_attempt":
      return "You have no existing Attempt covered by the current window.";
    default:
      return reason.replace(/_/g, " ");
  }
}

/** Short blocked-state copy shared by the Workbench launcher. */
export function researchWindowBlockedCopy(
  eligibility: ResearchEligibility,
): Readonly<{ title: string; detail: string }> {
  if (!eligibility.window.configured) {
    return {
      title: "Research writing is not open on this deployment yet.",
      detail: "No research write window is configured. A Proofweave operator must open a window for your Person and Agent before new research can start.",
    };
  }
  if (!eligibility.window.valid) {
    return {
      title: "Research writing is closed by configuration.",
      detail: "The configured research write window is invalid, so Proofweave fails closed. Ask an operator to correct the window before starting research.",
    };
  }
  if (eligibility.reasons.includes("storage_unavailable")) {
    return {
      title: "Research eligibility cannot be confirmed right now.",
      detail: "The workspace store is unavailable, so Proofweave will not offer a write action it cannot verify.",
    };
  }
  if (eligibility.reasons.includes("person_missing")) {
    return {
      title: "No Person identity is available for this session.",
      detail: "Sign in again so Proofweave can resolve the Person that the current research write window would check.",
    };
  }
  if (!eligibility.personAllowed) {
    return {
      title: "Your Person is not in the research write window.",
      detail: "Existing public records stay readable. Ask a Proofweave operator to add your Person and Agent to the current window before starting new research.",
    };
  }
  if (eligibility.reasons.includes("no_allowed_agent")) {
    return {
      title: "No active Agent of yours is in the research write window.",
      detail: "Connect an Agent, then ask an operator to include it in the current window. Existing Attempts remain readable in the meantime.",
    };
  }
  if (!eligibility.canWrite && eligibility.reasons.includes("attempt_agent_not_allowed")) {
    return {
      title: "An existing Attempt is bound to an Agent outside the window.",
      detail: "The Attempt remains readable, but its Agent is not in the current window. Ask an operator to add that Agent or to list an Attempt bound to an allowed Agent.",
    };
  }
  if (eligibility.reasons.includes("new_attempts_disabled")) {
    return eligibility.canWrite
      ? {
        title: "New research windows are closed right now.",
        detail: "Your existing Attempts remain writable under this window. Starting another Attempt needs an explicit creation window.",
      }
      : {
        title: "No existing Attempt of yours is writable in this window.",
        detail: "New Attempts are disabled and none of your existing Attempts is listed. Ask an operator to add an Attempt or enable new Attempts.",
      };
  }
  return {
    title: "Research writing is closed for this account.",
    detail: "Ask a Proofweave operator to add your Person, Agent, and Attempt to the current research write window.",
  };
}

export function ResearchWindowNotice({
  eligibility,
  className,
}: {
  eligibility: ResearchEligibility;
  className?: string;
}) {
  const titleId = useId();
  const { window: windowState, reasons } = eligibility;
  const hasAttemptRestriction = reasons.includes("attempt_not_listed")
    || reasons.includes("attempt_agent_not_allowed");
  const fullyOpen = eligibility.canWrite && eligibility.canCreateAttempt && !hasAttemptRestriction;
  const partiallyOpen = eligibility.canWrite && eligibility.canCreateAttempt && hasAttemptRestriction;
  const blocked = researchWindowBlockedCopy(eligibility);

  const badge = !windowState.configured
    ? { tone: "negative" as const, label: "Window not configured" }
    : !windowState.valid
      ? { tone: "negative" as const, label: "Window invalid" }
      : fullyOpen
        ? { tone: "positive" as const, label: "Window open" }
        : partiallyOpen
          ? { tone: "warning" as const, label: "Some Attempts blocked" }
          : eligibility.canWrite
            ? { tone: "warning" as const, label: "Existing Attempts only" }
            : { tone: "warning" as const, label: "Window closed for this account" };

  const title = fullyOpen
    ? "Research writing is open for your Person and Agent."
    : partiallyOpen
      ? "New research is open, but some existing Attempts are outside the window."
      : blocked.title;
  const summary = fullyOpen
    ? "Your Person and an active Agent you own are inside the current window. You can create a new Attempt, and every Attempt you own is covered while the creation window is open."
    : partiallyOpen
      ? "You can create a new Attempt with an active Agent inside the window. Existing Attempts bound to an Agent outside the window remain readable but are not writable."
      : blocked.detail;

  const storageUnavailable = reasons.includes("storage_unavailable");
  const evaluationBlocked = !windowState.valid
    ? "Not evaluated because the window is not usable."
    : storageUnavailable
      ? "Not evaluated because the workspace store is unavailable."
      : reasons.includes("person_missing")
        ? "Not evaluated because no Person identity is available."
        : !eligibility.personAllowed
          ? "Not evaluated because your Person is outside the window."
          : null;

  const personStatus = evaluationBlocked
    ?? (reasons.includes("person_missing")
      ? "No Person identity resolved for this session."
      : eligibility.personAllowed
        ? "Inside the window."
        : "Not in the window.");

  const agentStatus = evaluationBlocked
    ?? (eligibility.agentsAllowed.total === 0
      ? "No Agent is registered to your Person."
      : `${eligibility.agentsAllowed.allowed} of ${eligibility.agentsAllowed.total} allowed · ${eligibility.agentsAllowed.active} active · ${eligibility.agentsAllowed.listed} listed in the window.`);

  const attemptStatus = evaluationBlocked
    ?? (eligibility.attemptsAllowed.total === 0
      ? "No existing Attempt."
      : `${eligibility.attemptsAllowed.covered} of ${eligibility.attemptsAllowed.total} covered by this window.`);

  const windowStatus = !windowState.configured
    ? "Not configured (fail closed)."
    : !windowState.valid
      ? `Invalid (${windowState.failureCode ?? "invalid"}).`
      : `Valid · ${windowState.personCount} Person(s) · ${windowState.agentCount} Agent(s) · ${windowState.attemptCount} Attempt(s).`;

  return <Surface as="section" tone="card" className={cx("research-window-notice", className)} aria-labelledby={titleId}>
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
      <p className="eyebrow" style={{ margin: 0 }}>Research write window</p>
      <Badge tone={badge.tone}>{badge.label}</Badge>
    </div>
    <SectionTitle id={titleId} style={{ marginTop: 10 }}>{title}</SectionTitle>
    <p style={{ color: "var(--ink-soft)", lineHeight: 1.6, margin: "10px 0 0" }}>{summary}</p>
    <FieldList>
      <Field label="Window">{windowStatus}</Field>
      <Field label="Your Person">{personStatus}</Field>
      <Field label="Your Agents">{agentStatus}</Field>
      <Field label="Existing Attempts">{attemptStatus}</Field>
      <Field label="New Attempts">{!windowState.valid ? "Not evaluated because the window is not usable." : windowState.allowNewAttempts ? "Enabled in this window." : "Disabled in this window."}</Field>
    </FieldList>
    {reasons.length > 0 && <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
      <strong style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 8 }}>Why writing is limited</strong>
      <ul style={{ color: "var(--ink-soft)", fontSize: "var(--text-sm)", lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
        {reasons.map((reason) => <li key={reason}>{researchEligibilityReasonText(reason)}</li>)}
      </ul>
    </div>}
    {!fullyOpen && (!storageUnavailable || reasons.some((reason) => reason !== "storage_unavailable")) && <div className="button-row" style={{ marginTop: 18 }}>
      <a className="button button-secondary" href={RESEARCH_WINDOW_REQUEST_ACCESS_HREF} target="_blank" rel="noreferrer">
        Request access <span aria-hidden="true">↗</span>
      </a>
    </div>}
    <p style={{ color: "var(--ink-faint)", fontSize: "var(--text-2xs)", lineHeight: 1.5, margin: "16px 0 0" }}>
      This notice describes only the current research write window. It is not a verification, review, or receipt status, and it does not imply that any submitted work is correct or accepted.
    </p>
  </Surface>;
}

function buildRequestAccessHref(): string {
  const title = "Research write window access request";
  const body = [
    "I would like to request access to the Proofweave research write window.",
    "",
    "Research target I want to work on:",
    "",
    "What I plan to submit:",
    "",
    "Please do not include private keys, tokens, email addresses, or Person/Agent/Attempt identifiers in this issue.",
  ].join("\n");
  const parameters = new URLSearchParams({ title, body });
  return `https://github.com/alexyyyander/proofweave/issues/new?${parameters.toString()}`;
}
