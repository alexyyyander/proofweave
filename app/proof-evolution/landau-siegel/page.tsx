import type { Metadata } from "next";
import { PageIntro, Badge, Field, FieldList, ActionLink } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import type { ArgumentMapData, LeanStructureData, ProofEvolutionData } from "@/app/lib/proof-evolution";
import proofEvolution from "@/data/proof-evolution/landau-siegel.json";
import leanStructure from "@/data/proof-evolution/lean-structure.json";
import argumentMap from "@/data/proof-evolution/argument-map.json";
import { getI18n } from "@/app/i18n/server";
import { ProofEvolutionClient } from "./ProofEvolutionClient";
import "./proof-evolution.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("proofMaps.landau.metaTitle"),
    description: t("proofMaps.landau.metaDescription"),
  };
}

export default async function LandauSiegelProofEvolutionPage() {
  const { t } = await getI18n();
  const data = proofEvolution as ProofEvolutionData;
  return (
    <SiteFrame
      active="publications"
      className="site-shell app-shell primary-page proof-evolution-shell"
      mainClassName="page-main proof-evolution-main"
    >
      <PageIntro
        label={t("proofMaps.landau.label")}
        title={t("proofMaps.landau.title")}
        description={t("proofMaps.landau.description")}
        meta={<>
          <span>{t("proofMaps.landau.metaCurated")}</span>
          <span>{t("proofMaps.landau.metaDraft")}</span>
          <span>{t("proofMaps.landau.metaVersions", { versions: data.versions.length, tracks: data.tracks.length })}</span>
        </>}
        actions={<>
          <ActionLink variant="primary" href="#argument-map">{t("proofMaps.landau.actionArgumentMap")}</ActionLink>
          <ActionLink variant="secondary" href="#lean-structure">{t("proofMaps.landau.actionLeanStructure")}</ActionLink>
          <ActionLink variant="secondary" href="#lean">{t("proofMaps.landau.actionLeanCoverage")}</ActionLink>
          <ActionLink variant="secondary" href="/publications">{t("proofMaps.landau.actionPublications")}</ActionLink>
        </>}
        aside={<>
          <strong>{t("proofMaps.landau.asideTitle")}</strong>
          <FieldList layout="stacked">
            <Field label={t("proofMaps.landau.fieldShortest")}>{t("proofMaps.landau.fieldShortestValue")}</Field>
            <Field label={t("proofMaps.landau.fieldFormalized")}>{t("proofMaps.landau.fieldFormalizedValue")}</Field>
            <Field label={t("proofMaps.landau.fieldLineage")}>{t("proofMaps.landau.fieldLineageValue")}</Field>
            <Field label={t("proofMaps.landau.fieldStatus")}>{t("proofMaps.landau.fieldStatusValue")}</Field>
          </FieldList>
          <Badge tone="warning">{t("proofMaps.landau.badgeDraft")}</Badge>
        </>}
      />
      <ProofEvolutionClient data={data} leanStructure={leanStructure as LeanStructureData} argumentMap={argumentMap as ArgumentMapData} />
    </SiteFrame>
  );
}
