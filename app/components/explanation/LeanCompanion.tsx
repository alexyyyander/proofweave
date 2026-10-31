import { Badge, CardTitle, CodeBlock, Surface } from "@/app/components/ui";
import type { ClaimExplanation } from "./explanations";
import "./explanation.css";

/**
 * Shows upstream Lean excerpts and draft annotations. A missing excerpt is
 * stated as missing; the component never fabricates Lean source or implies a
 * kernel check that Proofweave has not run.
 */
export function LeanCompanion({ explanation }: { explanation: ClaimExplanation }) {
  return <Surface as="article" tone="card" className="explanation-card explanation-lean-companion">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">Lean companion</span>
      <div className="explanation-badges">
        <Badge tone="warning">Draft · unreviewed</Badge>
      </div>
    </header>
    <CardTitle>Lean excerpt and annotations</CardTitle>

    {explanation.leanAnnotations.length === 0
      ? <p className="explanation-empty-note">This draft records no Lean annotations. That absence does not imply that no Lean source exists.</p>
      : <div className="explanation-lean-entries">
          {explanation.leanAnnotations.map((annotation) => <article className="explanation-lean-entry" key={annotation.id}>
            <header className="explanation-lean-heading">
              <span className="explanation-lean-file">
                <code>{annotation.file ?? "Lean file not linked in the snapshot"}</code>
                {annotation.url && <a href={annotation.url} target="_blank" rel="noreferrer">Open source ↗</a>}
              </span>
              {annotation.needsReview && <Badge tone="warning">Needs review</Badge>}
            </header>
            {annotation.excerpt
              ? <CodeBlock className="explanation-lean-excerpt" tabIndex={0}>{annotation.excerpt}</CodeBlock>
              : <p className="explanation-missing-excerpt">No Lean excerpt is included in the pinned snapshot. The annotation below is limited to what the snapshot records.</p>}
            <p>{annotation.annotation}</p>
          </article>)}
        </div>}

    <p className="explanation-caveat">Lean excerpts, when present, are quoted from upstream sources. They are not a Proofweave kernel check, replay, or receipt.</p>
  </Surface>;
}
