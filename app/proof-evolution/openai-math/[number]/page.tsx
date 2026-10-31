import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionLink, Badge, Field, FieldList, PageIntro, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { openaiMathCollection, publicationFamily } from "@/app/lib/publications";
import type { ProofMapIndex, ProofMapIndexEntry } from "@/app/lib/proof-map";
import manifest from "@/data/proof-maps/manifest.json";
import { buildProofMapIndex } from "@/packages/domain/proof-map-index.mjs";
import {
  ClaimCard,
  LeanCompanion,
  ProofMap,
  ScopeDiff,
  explanationForFamily,
  type ClaimExplanation,
} from "@/app/components/explanation";
import explanation032 from "@/data/publications/explanations/openai-math-032.json";
import explanation084 from "@/data/publications/explanations/openai-math-084.json";
import explanation159 from "@/data/publications/explanations/openai-math-159.json";
import { MathText } from "../../../publications/MathText";
import "katex/dist/katex.min.css";
import "../../proof-map.css";

export const dynamic = "force-dynamic";

const explanationArtifacts: Record<string, ClaimExplanation> = {
  "032": explanation032 as ClaimExplanation,
  "084": explanation084 as ClaimExplanation,
  "159": explanation159 as ClaimExplanation,
};

type Params = { params: Promise<{ number: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) return { title: "Proof map not found" };
  const index = buildProofMapIndex(openaiMathCollection, manifest) as ProofMapIndex;
  const entry = index.entries.find((candidate) => candidate.familyNumber === number);
  return {
    title: entry ? `Proof map ${number}: ${family.title.replace(/<[^>]*>/g, "")}` : "Proof map",
    description: entry
      ? `${entry.statusLabel} for OpenAI result family ${number}. ${entry.nextStep}`
      : "Source-linked proof map for an OpenAI mathematics result family.",
  };
}

export default async function ProofMapFamilyPage({ params }: Params) {
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) notFound();
  if (family.number === "003") redirect("/proof-evolution/landau-siegel");

  const index = buildProofMapIndex(openaiMathCollection, manifest) as ProofMapIndex;
  const entry = index.entries.find((candidate) => candidate.familyNumber === family.number);
  if (!entry) notFound();

  const explanation = entry.status === "draft" ? explanationForFamily(family.number, explanationArtifacts) : undefined;
  const isDraft = Boolean(explanation);

  return <SiteFrame
    active="publications"
    activeHref="/proof-evolution"
    className="site-shell app-shell primary-page proof-map-family-shell"
    mainClassName="page-main proof-map-family-main"
  >
    <PageIntro
      label={`Proof map · ${entry.statusLabel}`}
      title={<MathText text={family.title} />}
      description={isDraft
        ? "A draft explanation chain is recorded for this family. It is unreviewed, may be reading order rather than a verified dependency graph, and is not a Proofweave replay."
        : "This family is indexed with its source-pinned claim, manuscripts, citations, and any upstream Lean scope. No theorem-level proof chain has been curated yet; the structure below is a metadata scaffold, not a claim of proof dependencies."}
      meta={<>
        <span>Family {family.number}</span>
        <span>{family.subject}</span>
        <span>{family.manuscripts.length} {family.manuscripts.length === 1 ? "manuscript" : "manuscripts"}</span>
        <span>{family.scope ? "Lean scope documented" : "No Lean scope linked"}</span>
        <span>Proofweave replay not run</span>
      </>}
      actions={<>
        <ActionLink variant="primary" href={`/publications/openai-math/${family.number}`}>Publication record</ActionLink>
        <ActionLink variant="secondary" href="/proof-evolution">All proof maps</ActionLink>
        {isDraft && <ActionLink variant="secondary" href={`/publications/openai-math/${family.number}#explanations`}>Read the draft explanation</ActionLink>}
      </>}
    />

    <div className="proof-map-family-content">
      <StatusBanner entry={entry} isDraft={isDraft} />

      {explanation ? <DraftChain familyNumber={family.number} explanation={explanation} family={family} /> : <ScaffoldMap entry={entry} />}

      <div className="proof-map-family-grid">
        <ManuscriptSection family={family} />
        <ScopeSection family={family} entry={entry} />
      </div>

      <NextSteps entry={entry} isDraft={isDraft} />
    </div>
  </SiteFrame>;
}

function StatusBanner({ entry, isDraft }: { entry: ProofMapIndexEntry; isDraft: boolean }) {
  return <div className="proof-map-family-status">
    <Badge tone={isDraft ? "warning" : "neutral"}>{entry.statusLabel}</Badge>
    <p>{isDraft
      ? "Draft proof chain: unreviewed, no platform replay, no independent review. The numbered steps are not automatically a proof DAG."
      : "Metadata scaffold: the source record exists, but theorem statements, proof edges, Lean declaration alignment, and cross-solution relations still need curation."}</p>
    <small>{entry.nextStep}</small>
  </div>;
}

function ScaffoldMap({ entry }: { entry: ProofMapIndexEntry }) {
  return <section className="proof-map-scaffold" aria-labelledby="scaffold-map-title">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">Structure skeleton</p><h2 id="scaffold-map-title">What exists, before a proof chain exists.</h2></div>
      <span>Metadata only · no theorem edges invented</span>
    </div>
    <div className="proof-map-skeleton" aria-label="Metadata scaffold stages">
      <SkeletonNode index="01" label="Claim" value="Source-pinned" detail={entry.claimSnippet} />
      <i aria-hidden="true">→</i>
      <SkeletonNode index="02" label="Manuscripts" value={`${entry.manuscriptCount}`} detail="PDF, abstract, citation, and version notes" />
      <i aria-hidden="true">→</i>
      <SkeletonNode index="03" label="Upstream Lean" value={entry.scopeDocument ? "Scope documented" : "Not linked"} detail={entry.scopeDocument ? `${entry.comparatorCount} comparator links · ${entry.formalizedManuscripts} formalized manuscripts` : "No scope document or comparator proven in the pinned snapshot"} />
      <i aria-hidden="true">→</i>
      <SkeletonNode index="04" label="Proofweave evidence" value="Replay not run" detail="No statement review, independent review, or receipt" />
    </div>
    <p className="proof-map-skeleton-note">The arrows above describe the source record and evidence gates. They are not theorem-to-theorem dependencies. A theorem-level map is added only after the paper&apos;s statements are extracted and reviewed.</p>
  </section>;
}

function SkeletonNode({ index, label, value, detail }: { index: string; label: string; value: string; detail: string }) {
  return <article className="proof-map-skeleton-node">
    <span>{index} · {label}</span>
    <strong>{value}</strong>
    <p>{detail}</p>
  </article>;
}

function DraftChain({ familyNumber, explanation, family }: { familyNumber: string; explanation: ClaimExplanation; family: NonNullable<ReturnType<typeof publicationFamily>> }) {
  return <section className="proof-map-draft" aria-labelledby="draft-chain-title">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">Draft explanation</p><h2 id="draft-chain-title">Recorded proof steps, with an explicit draft boundary.</h2></div>
      <span><Badge tone="warning">Draft · unreviewed</Badge></span>
    </div>
    <div className="explanation-grid">
      <ClaimCard explanation={explanation} />
      <ScopeDiff explanation={explanation} family={family} renderText={(text) => <MathText text={text} />} />
      <ProofMap explanation={explanation} />
      <LeanCompanion explanation={explanation} />
    </div>
    <p className="proof-map-draft-note">This chain is an explanation artifact, not the theorem-level argument map. Dependency edges appear only where the draft records them; the remaining order is reading order. The publication record for family {familyNumber} carries the full source context.</p>
  </section>;
}

function ManuscriptSection({ family }: { family: NonNullable<ReturnType<typeof publicationFamily>> }) {
  return <Surface tone="card" className="proof-map-source-section">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">Source record</p><h2>Manuscripts</h2></div>
      <span>{family.manuscripts.length} {family.manuscripts.length === 1 ? "manuscript" : "manuscripts"}</span>
    </div>
    <div className="proof-map-manuscript-list">
      {family.manuscripts.map((manuscript) => <article key={manuscript.id}>
        <div className="proof-map-manuscript-top"><span>{manuscript.date}</span><span>{manuscript.authors.join(", ")}</span></div>
        <h3><MathText text={manuscript.title} /></h3>
        <p className="proof-map-manuscript-abstract"><MathText text={manuscript.abstract} /></p>
        <div className="proof-map-manuscript-links">
          <a href={manuscript.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>
          <a href={manuscript.readmeUrl} target="_blank" rel="noreferrer">Source & version notes ↗</a>
          <span>{manuscript.citedByScopeDocument ? "Named in Lean scope" : manuscript.listedInFormalizationIndex ? "Listed in formalization index" : "No formalization link"}</span>
        </div>
      </article>)}
    </div>
  </Surface>;
}

function ScopeSection({ family, entry }: { family: NonNullable<ReturnType<typeof publicationFamily>>; entry: ProofMapIndexEntry }) {
  return <Surface tone="card" className="proof-map-source-section">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">Upstream Lean</p><h2>Scope & evidence</h2></div>
      <span>{family.scope ? `${entry.comparatorCount} comparator links` : "Not linked"}</span>
    </div>
    {family.scope ? <>
      <div className="proof-map-scope-text">
        {family.scope.text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}><MathText text={paragraph} /></p>)}
      </div>
      <div className="proof-map-scope-links">
        <a href={family.scope.url} target="_blank" rel="noreferrer">Open scope document ↗</a>
        {family.scope.paperLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`paper-${link.url}`}>{link.label} ↗</a>)}
        {family.scope.comparatorLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`comparator-${link.url}`}>{link.label} ↗</a>)}
      </div>
    </> : <div className="proof-map-scope-empty">
      <strong>No Lean scope document is linked for this family.</strong>
      <p>That absence is not evidence that no Lean code exists. It means this pinned snapshot does not connect a scope statement or comparator to the result.</p>
      <a href={openaiMathCollection.environment.instructionsUrl} target="_blank" rel="noreferrer">Upstream verification instructions ↗</a>
    </div>}
    <FieldList layout="stacked" className="proof-map-evidence-fields">
      <Field label="Proofweave replay">{entry.proofweaveReplay === "not_run" ? "Not run" : entry.proofweaveReplay}</Field>
      <Field label="Statement review">Not started for this family</Field>
      <Field label="Independent review">Not recorded</Field>
      <Field label="Receipt">None</Field>
      <Field label="Upstream linked">{entry.formalizedManuscripts} {entry.formalizedManuscripts === 1 ? "manuscript" : "manuscripts"} named in the Lean scope or formalization index</Field>
    </FieldList>
    {family.scope && <p className="proof-map-evidence-note">Scope text describes upstream coverage. It is not a Proofweave replay, review, or receipt.</p>}
  </Surface>;
}

function NextSteps({ entry, isDraft }: { entry: ProofMapIndexEntry; isDraft: boolean }) {
  return <Surface tone="card" className="proof-map-next-steps">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">Continuous curation</p><h2>What to fill next</h2></div>
      <span>Status: {entry.statusLabel}</span>
    </div>
    <ol>
      <li><strong>Extract theorem/lemma statements.</strong> Pin each statement to a paper, section, and page; do not paraphrase a dependency that the paper does not state.</li>
      <li><strong>Build the argument map.</strong> Add a node for each theorem/lemma/construction, then add directed `depends` edges only where the proof uses it.</li>
      <li><strong>Align Lean.</strong> Map each node to declarations, comparator statements, or mark it `unmapped`; record toolchain, Mathlib revision, and axioms when a kernel check exists.</li>
      <li><strong>Add cross-solution relations.</strong> Use `same-role`, `replaces`, and `bypasses` only after review; never treat a shared role as logical equivalence.</li>
      <li><strong>Review and record evidence.</strong> Independent review, replay, and receipt are separate gates; a scaffold or draft does not satisfy them.</li>
    </ol>
    <p className="proof-map-next-step">{isDraft ? "Promote this draft chain to a theorem-level map, then review it." : entry.nextStep}</p>
    <div className="proof-map-next-actions">
      <Link href="/proof-evolution">Back to all proof maps</Link>
      <Link href={`/publications/openai-math/${entry.familyNumber}`}>Open the publication record</Link>
      <Link href="/support">Contribute or request a review</Link>
    </div>
  </Surface>;
}
