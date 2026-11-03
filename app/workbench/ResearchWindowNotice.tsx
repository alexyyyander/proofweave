"use client";

import type { ResearchEligibility } from "@/app/lib/research-eligibility";
import { Badge, Field, FieldList, SectionTitle, Surface, cx } from "@/app/components/ui";
import { useId } from "react";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

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
const reasonKeys: Record<string, TranslationKey> = {
  window_missing: "window.reason.window_missing",
  window_invalid: "window.reason.window_invalid",
  storage_unavailable: "window.reason.storage_unavailable",
  person_missing: "window.reason.person_missing",
  person_not_allowed: "window.reason.person_not_allowed",
  no_allowed_agent: "window.reason.no_allowed_agent",
  new_attempts_disabled: "window.reason.new_attempts_disabled",
  attempt_not_listed: "window.reason.attempt_not_listed",
  attempt_agent_not_allowed: "window.reason.attempt_agent_not_allowed",
  no_writable_attempt: "window.reason.no_writable_attempt",
};

export function researchEligibilityReasonText(reason: string, t: Translator): string {
  const key = reasonKeys[reason];
  return key ? t(key) : reason.replace(/_/g, " ");
}

/** Short blocked-state copy shared by the Workbench launcher. */
export function researchWindowBlockedCopy(
  eligibility: ResearchEligibility,
  t: Translator,
): Readonly<{ title: string; detail: string }> {
  if (!eligibility.window.configured) return { title: t("window.blocked.notConfigured.title"), detail: t("window.blocked.notConfigured.detail") };
  if (!eligibility.window.valid) return { title: t("window.blocked.invalid.title"), detail: t("window.blocked.invalid.detail") };
  if (eligibility.reasons.includes("storage_unavailable")) return { title: t("window.blocked.storage.title"), detail: t("window.blocked.storage.detail") };
  if (eligibility.reasons.includes("person_missing")) return { title: t("window.blocked.noPerson.title"), detail: t("window.blocked.noPerson.detail") };
  if (!eligibility.personAllowed) return { title: t("window.blocked.person.title"), detail: t("window.blocked.person.detail") };
  if (eligibility.reasons.includes("no_allowed_agent")) return { title: t("window.blocked.noAgent.title"), detail: t("window.blocked.noAgent.detail") };
  if (!eligibility.canWrite && eligibility.reasons.includes("attempt_agent_not_allowed")) return { title: t("window.blocked.attemptAgent.title"), detail: t("window.blocked.attemptAgent.detail") };
  if (eligibility.reasons.includes("new_attempts_disabled")) {
    return eligibility.canWrite
      ? { title: t("window.blocked.newDisabledWritable.title"), detail: t("window.blocked.newDisabledWritable.detail") }
      : { title: t("window.blocked.newDisabledBlocked.title"), detail: t("window.blocked.newDisabledBlocked.detail") };
  }
  return { title: t("window.blocked.closed.title"), detail: t("window.blocked.closed.detail") };
}

export function ResearchWindowNotice({
  eligibility,
  className,
}: {
  eligibility: ResearchEligibility;
  className?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const { window: windowState, reasons } = eligibility;
  const hasAttemptRestriction = reasons.includes("attempt_not_listed")
    || reasons.includes("attempt_agent_not_allowed");
  const fullyOpen = eligibility.canWrite && eligibility.canCreateAttempt && !hasAttemptRestriction;
  const partiallyOpen = eligibility.canWrite && eligibility.canCreateAttempt && hasAttemptRestriction;
  const blocked = researchWindowBlockedCopy(eligibility, t);

  const badge = !windowState.configured
    ? { tone: "negative" as const, label: t("window.badge.notConfigured") }
    : !windowState.valid
      ? { tone: "negative" as const, label: t("window.badge.invalid") }
      : fullyOpen
        ? { tone: "positive" as const, label: t("window.badge.open") }
        : partiallyOpen
          ? { tone: "warning" as const, label: t("window.badge.someBlocked") }
          : eligibility.canWrite
            ? { tone: "warning" as const, label: t("window.badge.existingOnly") }
            : { tone: "warning" as const, label: t("window.badge.accountClosed") };

  const title = fullyOpen ? t("window.title.open") : partiallyOpen ? t("window.title.partial") : blocked.title;
  const summary = fullyOpen ? t("window.summary.open") : partiallyOpen ? t("window.summary.partial") : blocked.detail;

  const storageUnavailable = reasons.includes("storage_unavailable");
  const evaluationBlocked = !windowState.valid
    ? t("window.evaluation.notUsable")
    : storageUnavailable
      ? t("window.evaluation.storeUnavailable")
      : reasons.includes("person_missing")
        ? t("window.evaluation.noPerson")
        : !eligibility.personAllowed
          ? t("window.evaluation.personOutside")
          : null;

  const personStatus = evaluationBlocked
    ?? (reasons.includes("person_missing")
      ? t("window.person.none")
      : eligibility.personAllowed
        ? t("window.person.inside")
        : t("window.person.outside"));

  const agentStatus = evaluationBlocked
    ?? (eligibility.agentsAllowed.total === 0
      ? t("window.agent.none")
      : t("window.agent.allowed", { allowed: eligibility.agentsAllowed.allowed, total: eligibility.agentsAllowed.total, active: eligibility.agentsAllowed.active, listed: eligibility.agentsAllowed.listed }));

  const attemptStatus = evaluationBlocked
    ?? (eligibility.attemptsAllowed.total === 0
      ? t("window.attempt.none")
      : t("window.attempt.covered", { covered: eligibility.attemptsAllowed.covered, total: eligibility.attemptsAllowed.total }));

  const windowStatus = !windowState.configured
    ? t("window.status.notConfigured")
    : !windowState.valid
      ? t("window.status.invalid", { code: windowState.failureCode ?? t("window.status.invalidFallback") })
      : t("window.status.valid", { persons: windowState.personCount, agents: windowState.agentCount, attempts: windowState.attemptCount });

  return <Surface as="section" tone="card" className={cx("research-window-notice", className)} aria-labelledby={titleId}>
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
      <p className="eyebrow" style={{ margin: 0 }}>{t("window.eyebrow")}</p>
      <Badge tone={badge.tone}>{badge.label}</Badge>
    </div>
    <SectionTitle id={titleId} style={{ marginTop: 10 }}>{title}</SectionTitle>
    <p style={{ color: "var(--ink-soft)", lineHeight: 1.6, margin: "10px 0 0" }}>{summary}</p>
    <FieldList>
      <Field label={t("window.field.window")}>{windowStatus}</Field>
      <Field label={t("window.field.person")}>{personStatus}</Field>
      <Field label={t("window.field.agents")}>{agentStatus}</Field>
      <Field label={t("window.field.attempts")}>{attemptStatus}</Field>
      <Field label={t("window.field.newAttempts")}>{!windowState.valid ? t("window.evaluation.notUsable") : windowState.allowNewAttempts ? t("window.new.enabled") : t("window.new.disabled")}</Field>
    </FieldList>
    {reasons.length > 0 && <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
      <strong style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 8 }}>{t("window.why")}</strong>
      <ul style={{ color: "var(--ink-soft)", fontSize: "var(--text-sm)", lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
        {reasons.map((reason) => <li key={reason}>{researchEligibilityReasonText(reason, t)}</li>)}
      </ul>
    </div>}
    {!fullyOpen && (!storageUnavailable || reasons.some((reason) => reason !== "storage_unavailable")) && <div className="button-row" style={{ marginTop: 18 }}>
      <a className="button button-secondary" href={RESEARCH_WINDOW_REQUEST_ACCESS_HREF} target="_blank" rel="noreferrer">
        {t("window.request")} <span aria-hidden="true">↗</span>
      </a>
    </div>}
    <p style={{ color: "var(--ink-faint)", fontSize: "var(--text-2xs)", lineHeight: 1.5, margin: "16px 0 0" }}>
      {t("window.note")}
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
