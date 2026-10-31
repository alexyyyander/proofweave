import type { ReactNode } from "react";
import { Badge, CardTitle, Surface } from "@/app/components/ui";
import type { ClaimExplanation, ExplanationFamily } from "./explanations";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";
import "./explanation.css";

/**
 * Compares the paper-level statement, the upstream Lean coverage, and the
 * platform's evidence state side by side. Missing Lean coverage stays unknown
 * rather than being inferred from the paper's claim. The route supplies
 * `renderText` so source formatting stays outside the shared component layer.
 */
export function ScopeDiff({ explanation, family, t, locale, renderText = (text) => text }: {
  explanation: ClaimExplanation;
  family?: ExplanationFamily;
  t: Translator;
  locale: Locale;
  renderText?: (text: string) => ReactNode;
}) {
  const paperStatement = explanation.scopeDiff?.paperStatement ?? family?.claim ?? "";
  const leanStatement = explanation.scopeDiff
    ? explanation.scopeDiff.leanStatement
    : family?.scope?.text ?? null;
  const leanStatus = explanation.scopeDiff?.leanStatementStatus ?? (leanStatement ? "recorded" : "unknown");
  const needsReview = explanation.scopeDiff?.needsReview ?? !leanStatement;
  const gapNote = explanation.scopeDiff?.gapNote;
  // The artifact's platform-status sentence is English source prose. Other
  // locales derive an equivalent sentence from structured manuscript state.
  const platformStatus = explanation.scopeDiff?.platformStatus && locale === "en"
    ? explanation.scopeDiff.platformStatus
    : derivedPlatformStatus(family, t);
  const scopeUrl = family?.scope?.url;

  return <Surface as="article" tone="card" className="explanation-card explanation-scope-diff">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">{t("explanation.scope.eyebrow")}</span>
      <div className="explanation-badges">
        <Badge tone="warning">{t("explanation.draft")}</Badge>
        <Badge tone={leanStatement ? "neutral" : "warning"}>
          {leanStatement ? t("explanation.scope.leanRecorded") : t("explanation.scope.leanUnknown")}
        </Badge>
        {needsReview && <Badge tone="warning">{t("explanation.scope.needsReview")}</Badge>}
      </div>
    </header>
    <CardTitle>{t("explanation.scope.title")}</CardTitle>

    <div className="scope-diff-grid">
      <section className="scope-diff-column" aria-label={t("explanation.scope.paperAria")}>
        <span className="scope-diff-label">{t("explanation.scope.paperLabel")}</span>
        {paperStatement
          ? <div className="scope-diff-quote">{renderText(paperStatement)}</div>
          : <p className="scope-diff-unknown">{t("explanation.scope.noPaper")}</p>}
        <small>{t("explanation.scope.paperNote")}</small>
      </section>
      <section className="scope-diff-column" aria-label={t("explanation.scope.leanAria")}>
        <span className="scope-diff-label">{t("explanation.scope.leanLabel")}</span>
        {leanStatement
          ? <div className="scope-diff-quote">{leanStatement.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{renderText(paragraph)}</p>)}</div>
          : <p className="scope-diff-unknown">{t("explanation.scope.noLean")}</p>}
        <small>
          {t("explanation.scope.leanNote")}
          {scopeUrl && <> <a href={scopeUrl} target="_blank" rel="noreferrer">{t("explanation.scope.openScope")} ↗</a></>}
        </small>
      </section>
      <section className="scope-diff-column" aria-label={t("explanation.scope.platformAria")}>
        <span className="scope-diff-label">{t("explanation.scope.platformLabel")}</span>
        <p className="scope-diff-platform">{platformStatus}</p>
        <small>{t("explanation.scope.platformNote")}</small>
      </section>
    </div>

    {gapNote && <p className="scope-diff-gap"><strong>{t("explanation.scope.gap")}</strong> {gapNote}</p>}
    {leanStatus !== "recorded" && <p className="scope-diff-footnote">
      {t("explanation.scope.leanStatus", { status: leanStatus })}
    </p>}
  </Surface>;
}

function derivedPlatformStatus(family: ExplanationFamily | undefined, t: Translator) {
  if (!family) return t("explanation.scope.statusUnavailable");
  if (family.manuscripts.some((manuscript) => manuscript.receipt !== null && manuscript.receipt !== undefined)) {
    return t("explanation.scope.statusReceipt");
  }
  const replays = [...new Set(family.manuscripts.map((manuscript) => manuscript.proofweaveReplay))];
  const reviews = [...new Set(family.manuscripts.map((manuscript) => manuscript.statementReview))];
  if (replays.every((value) => value === "not_run") && reviews.every((value) => value === "not_started")) {
    return t("explanation.scope.statusNotVerified");
  }
  return t("explanation.scope.statusManuscripts", { replays: replays.join(", "), reviews: reviews.join(", ") });
}
