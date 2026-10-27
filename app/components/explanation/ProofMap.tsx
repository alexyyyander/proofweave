import { Badge, CardTitle, Surface } from "@/app/components/ui";
import type { ClaimExplanation } from "./explanations";
import "./explanation.css";

/**
 * Lists the proof outline recorded in the artifact. Edges are rendered only
 * from explicit dependsOn entries; list order is reading order, never an
 * invented dependency graph.
 */
export function ProofMap({ explanation }: { explanation: ClaimExplanation }) {
  const steps = explanation.proofSteps;
  const hasDependencies = steps.some((step) => (step.dependsOn?.length ?? 0) > 0);

  return <Surface as="article" tone="card" className="explanation-card explanation-proof-map">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">Proof map</span>
      <div className="explanation-badges">
        <Badge tone="warning">Draft · unreviewed</Badge>
      </div>
    </header>
    <CardTitle>Outline recorded in this draft</CardTitle>

    {steps.length === 0
      ? <p className="explanation-empty-note">This draft records no proof steps. That absence is not evidence that the proof is trivial or complete.</p>
      : <ol className="explanation-steps">
          {steps.map((step, index) => <li className="explanation-step" key={step.id}>
            <div className="explanation-step-heading">
              <span className="explanation-step-index" aria-hidden="true">{index + 1}</span>
              <strong>{step.label}</strong>
              {step.needsReview && <Badge tone="warning">Needs review</Badge>}
            </div>
            <p>{step.detail}</p>
            {step.basis && <p className="explanation-step-basis">Basis: {step.basis}</p>}
            {step.dependsOn && step.dependsOn.length > 0 && <p className="explanation-step-dependencies">
              Follows from: {step.dependsOn.map((dependency) => <code key={dependency}>{dependency}</code>)}
            </p>}
          </li>)}
        </ol>}

    <p className="explanation-caveat">
      {hasDependencies
        ? "Dependency edges appear only where this draft records them; the remaining list order is reading order, not a proof DAG."
        : "This draft records no dependency edges between steps. The numbered order is reading order, not a proof DAG."}
    </p>
  </Surface>;
}
