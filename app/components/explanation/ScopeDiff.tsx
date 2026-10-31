import type { ReactNode } from "react";
import { Badge, CardTitle, Surface } from "@/app/components/ui";
import type { ClaimExplanation, ExplanationFamily } from "./explanations";
import "./explanation.css";

/**
 * Compares the paper-level statement, the upstream Lean coverage, and the
 * platform's evidence state side by side. Missing Lean coverage stays unknown
 * rather than being inferred from the paper's claim. The route supplies
 * `renderText` so source formatting stays outside the shared component layer.
 */
export function ScopeDiff({ explanation, family, renderText = (text) => text }: {
  explanation: ClaimExplanation;
  family?: ExplanationFamily;
  renderText?: (text: string) => ReactNode;
}) {
  const paperStatement = explanation.scopeDiff?.paperStatement ?? family?.claim ?? "";
  const leanStatement = explanation.scopeDiff
    ? explanation.scopeDiff.leanStatement
    : family?.scope?.text ?? null;
  const leanStatus = explanation.scopeDiff?.leanStatementStatus ?? (leanStatement ? "recorded" : "unknown");
  const needsReview = explanation.scopeDiff?.needsReview ?? !leanStatement;
  const gapNote = explanation.scopeDiff?.gapNote;
  const platformStatus = explanation.scopeDiff?.platformStatus ?? derivedPlatformStatus(family);
  const scopeUrl = family?.scope?.url;

  return <Surface as="article" tone="card" className="explanation-card explanation-scope-diff">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">Scope difference</span>
      <div className="explanation-badges">
        <Badge tone="warning">Draft · unreviewed</Badge>
        <Badge tone={leanStatement ? "neutral" : "warning"}>
          {leanStatement ? "Lean statement recorded" : "Lean coverage unknown"}
        </Badge>
        {needsReview && <Badge tone="warning">Needs review</Badge>}
      </div>
    </header>
    <CardTitle>Paper statement vs Lean coverage</CardTitle>

    <div className="scope-diff-grid">
      <section className="scope-diff-column" aria-label="Paper statement">
        <span className="scope-diff-label">Paper’s statement</span>
        {paperStatement
          ? <div className="scope-diff-quote">{renderText(paperStatement)}</div>
          : <p className="scope-diff-unknown">No paper statement is available in this snapshot.</p>}
        <small>Source wording from the pinned OpenAI snapshot, not a Proofweave paraphrase.</small>
      </section>
      <section className="scope-diff-column" aria-label="Lean coverage">
        <span className="scope-diff-label">Lean coverage</span>
        {leanStatement
          ? <div className="scope-diff-quote">{leanStatement.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{renderText(paragraph)}</p>)}</div>
          : <p className="scope-diff-unknown">The pinned snapshot links no Lean statement for this family. Formal coverage is unknown (needs review).</p>}
        <small>
          Upstream scope text, not a platform replay.
          {scopeUrl && <> <a href={scopeUrl} target="_blank" rel="noreferrer">Open scope document ↗</a></>}
        </small>
      </section>
      <section className="scope-diff-column" aria-label="Platform status">
        <span className="scope-diff-label">Platform status</span>
        <p className="scope-diff-platform">{platformStatus}</p>
        <small>Proofweave has not verified this family. A draft explanation does not change evidence status.</small>
      </section>
    </div>

    {gapNote && <p className="scope-diff-gap"><strong>Gap:</strong> {gapNote}</p>}
    {leanStatus !== "recorded" && <p className="scope-diff-footnote">
      Lean coverage status: <code>{leanStatus}</code>. This draft records the absence explicitly instead of assuming coverage.
    </p>}
  </Surface>;
}

function derivedPlatformStatus(family?: ExplanationFamily) {
  if (!family) return "Platform status is unavailable in this view.";
  if (family.manuscripts.some((manuscript) => manuscript.receipt !== null && manuscript.receipt !== undefined)) {
    return "A receipt exists for at least one manuscript; this draft does not treat it as verification of the whole family.";
  }
  const replays = [...new Set(family.manuscripts.map((manuscript) => manuscript.proofweaveReplay))];
  const reviews = [...new Set(family.manuscripts.map((manuscript) => manuscript.statementReview))];
  if (replays.every((value) => value === "not_run") && reviews.every((value) => value === "not_started")) {
    return "Not verified: no Proofweave replay, no statement review, and no receipt for this family.";
  }
  return `Manuscript records: replay ${replays.join(", ")}; statement review ${reviews.join(", ")}.`;
}
