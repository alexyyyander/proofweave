import { Badge, CardTitle, Field, FieldList, Surface } from "@/app/components/ui";
import type { ClaimExplanation, ClaimExplanationLevel } from "./explanations";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import "./explanation.css";

const levelKeys: Record<ClaimExplanationLevel, TranslationKey> = {
  plain: "explanation.level.plain",
  undergraduate: "explanation.level.undergraduate",
  expert: "explanation.level.expert",
};

/**
 * Shows what one draft explanation says is assumed, concluded, and explicitly
 * not proven. Nothing here represents a platform verification or a review.
 */
export function ClaimCard({ explanation, t }: { explanation: ClaimExplanation; t: Translator }) {
  return <Surface as="article" tone="card" className="explanation-card explanation-claim-card">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">{t("explanation.claim.eyebrow")}</span>
      <div className="explanation-badges">
        <Badge>{t(levelKeys[explanation.level])}</Badge>
        <Badge tone="warning">{t("explanation.draft")}</Badge>
      </div>
    </header>
    <CardTitle>{explanation.title ?? t("explanation.claim.family", { number: explanation.familyNumber })}</CardTitle>
    <p className="explanation-card-subtitle">{t("explanation.claim.family", { number: explanation.familyNumber })}</p>

    <FieldList layout="stacked" className="explanation-fields">
      <Field label={t("explanation.claim.assumptions")}>
        {explanation.assumptions.length > 0
          ? <ul className="explanation-list">
              {explanation.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          : <p>{t("explanation.claim.noAssumptions")}</p>}
      </Field>
      <Field label={t("explanation.claim.conclusion")}>
        <p>{explanation.conclusion}</p>
      </Field>
      <Field label={t("explanation.claim.notProven")}>
        {explanation.notProven.length > 0
          ? <ul className="explanation-list explanation-not-proven">
              {explanation.notProven.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          : <p>{t("explanation.claim.noNonClaims")}</p>}
      </Field>
      <Field label={t("explanation.claim.scope")}>
        <p>{explanation.scopeNote}</p>
      </Field>
      <Field label={t("explanation.claim.evidenceStatus")}>
        <p>{t("explanation.claim.evidenceBody")}</p>
      </Field>
      {explanation.glossary.length > 0 && <Field label={t("explanation.claim.glossary")}>
        <FieldList className="explanation-glossary">
          {explanation.glossary.map((entry) => <Field key={entry.term} label={entry.term}>{entry.definition}</Field>)}
        </FieldList>
        <p className="explanation-caveat">{t("explanation.claim.glossaryCaveat")}</p>
      </Field>}
    </FieldList>

    <footer className="explanation-card-footer">
      <span>{t("explanation.claim.sources")}</span>
      <ul>
        {explanation.sources.map((source) => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
        </li>)}
      </ul>
    </footer>
  </Surface>;
}
