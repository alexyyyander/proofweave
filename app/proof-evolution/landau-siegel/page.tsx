import type { Metadata } from "next";
import { PageIntro, Badge, Field, FieldList, ActionLink } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import type { LeanStructureData, ProofEvolutionData } from "@/app/lib/proof-evolution";
import proofEvolution from "@/data/proof-evolution/landau-siegel.json";
import leanStructure from "@/data/proof-evolution/lean-structure.json";
import { ProofEvolutionClient } from "./ProofEvolutionClient";
import "./proof-evolution.css";

export const metadata: Metadata = {
  title: "Landau–Siegel proof evolution",
  description: "A versioned map of the Landau–Siegel real-zero proof, from OpenAI's 9-page argument to Barreto's 3-page Wronskian proof, with Lean coverage.",
};

export default function LandauSiegelProofEvolutionPage() {
  const data = proofEvolution as ProofEvolutionData;
  return (
    <SiteFrame
      active="publications"
      className="site-shell app-shell primary-page proof-evolution-shell"
      mainClassName="page-main proof-evolution-main"
    >
      <PageIntro
        label="Proof evolution · Prototype"
        title="How a nine-page proof became a three-page proof"
        description="A versioned map of the Landau–Siegel real-zero proof: OpenAI's interpolation determinant, Banks's explicit-constant exposition, Kerr's and Green's simplifications, Barreto's Wronskian proof, and the Lean formalization that currently follows the longer route."
        meta={<>
          <span>Curated 2026-10-30</span>
          <span>Draft · not a Proofweave verification</span>
          <span>{data.versions.length} versions · {data.tracks.length} theorem tracks</span>
        </>}
        actions={<>
          <ActionLink variant="primary" href="#lean-structure">Inspect the Lean structure</ActionLink>
          <ActionLink variant="secondary" href="#lean">Jump to Lean coverage</ActionLink>
          <ActionLink variant="secondary" href="/publications">Back to publications</ActionLink>
        </>}
        aside={<>
          <strong>At a glance</strong>
          <FieldList layout="stacked">
            <Field label="Shortest human proof">3 pages · Barreto</Field>
            <Field label="Formalized upstream">9-page OpenAI route</Field>
            <Field label="Same-theorem lineage">OpenAI → Kerr / Green → Barreto</Field>
            <Field label="Status">Curated, unreviewed, no kernel replay</Field>
          </FieldList>
          <Badge tone="warning">Draft · unreviewed</Badge>
        </>}
      />
      <ProofEvolutionClient data={data} leanStructure={leanStructure as LeanStructureData} />
    </SiteFrame>
  );
}
