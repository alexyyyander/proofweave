import { Badge, CardTitle, Field, FieldList, Surface } from "@/app/components/ui";
import type { ClaimExplanation, ClaimExplanationLevel } from "./explanations";
import "./explanation.css";

const levelLabels: Record<ClaimExplanationLevel, string> = {
  plain: "Plain language",
  undergraduate: "Undergraduate",
  expert: "Expert",
};

/**
 * Shows what one draft explanation says is assumed, concluded, and explicitly
 * not proven. Nothing here represents a platform verification or a review.
 */
export function ClaimCard({ explanation }: { explanation: ClaimExplanation }) {
  return <Surface as="article" tone="card" className="explanation-card explanation-claim-card">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">Conclusion card</span>
      <div className="explanation-badges">
        <Badge>{levelLabels[explanation.level]}</Badge>
        <Badge tone="warning">Draft · unreviewed</Badge>
      </div>
    </header>
    <CardTitle>{explanation.title ?? `OpenAI result family ${explanation.familyNumber}`}</CardTitle>
    <p className="explanation-card-subtitle">OpenAI result family {explanation.familyNumber}</p>

    <FieldList layout="stacked" className="explanation-fields">
      <Field label="Assumptions">
        {explanation.assumptions.length > 0
          ? <ul className="explanation-list">
              {explanation.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          : <p>No assumptions are recorded in this draft.</p>}
      </Field>
      <Field label="Conclusion">
        <p>{explanation.conclusion}</p>
      </Field>
      <Field label="Explicitly not proven">
        {explanation.notProven.length > 0
          ? <ul className="explanation-list explanation-not-proven">
              {explanation.notProven.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          : <p>This draft records no explicit non-claims. That absence is itself unreviewed.</p>}
      </Field>
      <Field label="Scope of this draft">
        <p>{explanation.scopeNote}</p>
      </Field>
      <Field label="Evidence status">
        <p><strong>Draft, not reviewed.</strong> This artifact is a model-drafted explanation of the pinned source snapshot. It is not a Proofweave replay, a statement review, an independent review, or a receipt.</p>
      </Field>
      {explanation.glossary.length > 0 && <Field label="Glossary">
        <FieldList className="explanation-glossary">
          {explanation.glossary.map((entry) => <Field key={entry.term} label={entry.term}>{entry.definition}</Field>)}
        </FieldList>
        <p className="explanation-caveat">Glossary definitions are draft paraphrases and have not been reviewed.</p>
      </Field>}
    </FieldList>

    <footer className="explanation-card-footer">
      <span>Sources used by this draft</span>
      <ul>
        {explanation.sources.map((source) => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
        </li>)}
      </ul>
    </footer>
  </Surface>;
}
