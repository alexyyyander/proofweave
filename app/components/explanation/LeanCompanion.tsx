import { Badge, CardTitle, CodeBlock, Surface } from "@/app/components/ui";
import type { ClaimExplanation } from "./explanations";
import type { Translator } from "@/app/i18n/translate";
import "./explanation.css";

/**
 * Shows upstream Lean excerpts and draft annotations. A missing excerpt is
 * stated as missing; the component never fabricates Lean source or implies a
 * kernel check that Proofweave has not run.
 */
export function LeanCompanion({ explanation, t }: { explanation: ClaimExplanation; t: Translator }) {
  return <Surface as="article" tone="card" className="explanation-card explanation-lean-companion">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">{t("explanation.lean.eyebrow")}</span>
      <div className="explanation-badges">
        <Badge tone="warning">{t("explanation.draft")}</Badge>
      </div>
    </header>
    <CardTitle>{t("explanation.lean.title")}</CardTitle>

    {explanation.leanAnnotations.length === 0
      ? <p className="explanation-empty-note">{t("explanation.lean.empty")}</p>
      : <div className="explanation-lean-entries">
          {explanation.leanAnnotations.map((annotation) => <article className="explanation-lean-entry" key={annotation.id}>
            <header className="explanation-lean-heading">
              <span className="explanation-lean-file">
                <code>{annotation.file ?? t("explanation.lean.noFile")}</code>
                {annotation.url && <a href={annotation.url} target="_blank" rel="noreferrer">{t("explanation.lean.openSource")} ↗</a>}
              </span>
              {annotation.needsReview && <Badge tone="warning">{t("explanation.scope.needsReview")}</Badge>}
            </header>
            {annotation.excerpt
              ? <CodeBlock className="explanation-lean-excerpt" tabIndex={0}>{annotation.excerpt}</CodeBlock>
              : <p className="explanation-missing-excerpt">{t("explanation.lean.noExcerpt")}</p>}
            <p>{annotation.annotation}</p>
          </article>)}
        </div>}

    <p className="explanation-caveat">{t("explanation.lean.caveat")}</p>
  </Surface>;
}
