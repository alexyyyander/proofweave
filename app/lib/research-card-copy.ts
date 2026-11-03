import type { ResearchCardCopy } from "@/app/components/research/ResearchCard";
import type { Translator } from "@/app/i18n/translate";

export function researchCardCopy(t: Translator): ResearchCardCopy {
  return {
    pinnedSource: t("researchCard.pinnedSource"),
    verificationStates: t("researchCard.verificationStates"),
    statuses: {
      "Formalized statement": t("researchCard.status.formalized"),
      "Open proof branch": t("researchCard.status.open"),
      "Kernel accepted": t("researchCard.status.kernel"),
      "Statement fidelity reviewed": t("researchCard.status.reviewed"),
      "Independent review": t("researchCard.status.review"),
      "No Proofweave attestation": t("researchCard.status.none"),
    },
    viewOpportunity: t("researchCard.viewOpportunity"),
    nextAction: t("researchCard.nextAction"),
    scope: t("researchCard.scope"),
    source: t("researchCard.source"),
    publicRecord: t("researchCard.publicRecord"),
    startInWorkspace: t("researchCard.startInWorkspace"),
    openRecord: t("researchCard.openRecord"),
    inspectProof: t("researchCard.inspectProof"),
    needs: {
      proved: t("researchCard.needs.proved"),
      solved: t("researchCard.needs.solved"),
      open: t("researchCard.needs.open"),
    },
    scopes: {
      bounded: t("researchCard.scope.bounded"),
      longHorizon: t("researchCard.scope.longHorizon"),
      program: t("researchCard.scope.program"),
    },
    works: {
      proved: t("researchCard.work.proved"),
      solved: t("researchCard.work.solved"),
      open: t("researchCard.work.open"),
    },
  };
}
