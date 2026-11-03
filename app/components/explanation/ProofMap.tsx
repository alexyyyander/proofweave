import { Badge, CardTitle, Surface } from "@/app/components/ui";
import type { ClaimExplanation } from "./explanations";
import type { Translator } from "@/app/i18n/translate";
import "./explanation.css";

/**
 * Lists the proof outline recorded in the artifact. Edges are rendered only
 * from explicit dependsOn entries; list order is reading order, never an
 * invented dependency graph.
 */
export function ProofMap({ explanation, t }: { explanation: ClaimExplanation; t: Translator }) {
  const steps = explanation.proofSteps;
  const hasDependencies = steps.some((step) => (step.dependsOn?.length ?? 0) > 0);

  return <Surface as="article" tone="card" className="explanation-card explanation-proof-map">
    <header className="explanation-card-header">
      <span className="explanation-eyebrow">{t("explanation.proof.eyebrow")}</span>
      <div className="explanation-badges">
        <Badge tone="warning">{t("explanation.draft")}</Badge>
      </div>
    </header>
    <CardTitle>{t("explanation.proof.title")}</CardTitle>

    {steps.length === 0
      ? <p className="explanation-empty-note">{t("explanation.proof.empty")}</p>
      : <ol className="explanation-steps">
          {steps.map((step, index) => <li className="explanation-step" key={step.id}>
            <div className="explanation-step-heading">
              <span className="explanation-step-index" aria-hidden="true">{index + 1}</span>
              <strong>{step.label}</strong>
              {step.needsReview && <Badge tone="warning">{t("explanation.scope.needsReview")}</Badge>}
            </div>
            <p>{step.detail}</p>
            {step.basis && <p className="explanation-step-basis">{t("explanation.proof.basis", { basis: step.basis })}</p>}
            {step.dependsOn && step.dependsOn.length > 0 && <p className="explanation-step-dependencies">
              {t("explanation.proof.follows")} {step.dependsOn.map((dependency) => <code key={dependency}>{dependency}</code>)}
            </p>}
          </li>)}
        </ol>}

    <p className="explanation-caveat">
      {hasDependencies ? t("explanation.proof.caveatWith") : t("explanation.proof.caveatWithout")}
    </p>
  </Surface>;
}
