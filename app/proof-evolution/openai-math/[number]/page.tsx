import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionLink, Badge, Field, FieldList, PageIntro, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { openaiMathCollection, publicationFamily } from "@/app/lib/publications";
import type { LeanCoverageData, LeanCoverageFamily, PaperCoverageData, PaperStructure, ProofMapIndex, ProofMapIndexEntry } from "@/app/lib/proof-map";
import type { DeepProofMapData } from "@/app/lib/deep-proof-map";
import manifest from "@/data/proof-maps/manifest.json";
import leanCoverageData from "@/data/proof-maps/lean-coverage.json";
import paperCoverageData from "@/data/proof-maps/paper-coverage.json";
import deep032 from "@/data/proof-maps/deep/032.json";
import deep084 from "@/data/proof-maps/deep/084.json";
import deep159 from "@/data/proof-maps/deep/159.json";
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
import { DeepProofMapView } from "../../DeepProofMap";
import { LeanDerivedMap } from "../../LeanDerivedMap";
import { PaperDerivedMap } from "../../PaperDerivedMap";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import "katex/dist/katex.min.css";
import "../../proof-map.css";

export const dynamic = "force-dynamic";

const statusKeys: Record<ProofMapIndexEntry["status"], TranslationKey> = {
  deep: "proofMaps.index.statusDeep",
  draft: "proofMaps.index.statusDraft",
  paper: "proofMaps.index.statusPaper",
  lean: "proofMaps.index.statusLean",
  scaffold: "proofMaps.index.statusScaffold",
};

const leanStatusKeys: Record<LeanCoverageFamily["leanStructureStatus"], TranslationKey> = {
  extracted: "proofMaps.family.leanStatus.extracted",
  partial: "proofMaps.family.leanStatus.partial",
  missing: "proofMaps.family.leanStatus.missing",
};

const explanationArtifacts: Record<string, ClaimExplanation> = {
  "032": explanation032 as ClaimExplanation,
  "084": explanation084 as ClaimExplanation,
  "159": explanation159 as ClaimExplanation,
};

const deepProofMaps: Record<string, DeepProofMapData> = {
  "032": deep032 as unknown as DeepProofMapData,
  "084": deep084 as unknown as DeepProofMapData,
  "159": deep159 as unknown as DeepProofMapData,
};

type Params = { params: Promise<{ number: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t } = await getI18n();
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) return { title: t("proofMaps.family.metaTitleMissing") };
  const index = buildProofMapIndex(openaiMathCollection, manifest, leanCoverageData as LeanCoverageData, paperCoverageData as PaperCoverageData) as ProofMapIndex;
  const entry = index.entries.find((candidate) => candidate.familyNumber === number);
  return {
    title: entry
      ? t("proofMaps.family.metaTitle", { number, title: family.title.replace(/<[^>]*>/g, "") })
      : t("proofMaps.family.metaTitleGeneric"),
    description: entry
      ? t("proofMaps.family.metaDescription", { status: t(statusKeys[entry.status]), number, nextStep: entry.nextStep })
      : t("proofMaps.family.metaDescriptionGeneric"),
  };
}

export default async function ProofMapFamilyPage({ params }: Params) {
  const { t, locale } = await getI18n();
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) notFound();
  if (family.number === "003") redirect("/proof-evolution/landau-siegel");

  const leanCoverage = leanCoverageData as LeanCoverageData;
  const index = buildProofMapIndex(openaiMathCollection, manifest, leanCoverage, paperCoverageData as PaperCoverageData) as ProofMapIndex;
  const entry = index.entries.find((candidate) => candidate.familyNumber === family.number);
  if (!entry) notFound();
  const leanFamily = leanCoverage.families.find((candidate) => candidate.familyNumber === family.number);

  const deep = deepProofMaps[family.number];
  const explanation = entry.status === "draft" ? explanationForFamily(family.number, explanationArtifacts) : undefined;
  const isDraft = Boolean(explanation);
  const isDeep = Boolean(deep);
  const isLean = entry.status === "lean" && Boolean(leanFamily);
  const isPaper = entry.status === "paper";
  const paperStructure = isPaper
    ? (await import(`../../../../data/proof-maps/paper/${family.number}.json`)).default as PaperStructure
    : null;

  return <SiteFrame
    active="publications"
    activeHref="/proof-evolution"
    className="site-shell app-shell primary-page proof-map-family-shell"
    mainClassName="page-main proof-map-family-main"
  >
    <PageIntro
      label={t("proofMaps.family.label", { status: t(statusKeys[entry.status]) })}
      title={<MathText text={family.title} />}
      description={isDeep
        ? t("proofMaps.family.descriptionDeep")
        : isDraft
          ? t("proofMaps.family.descriptionDraft")
          : isPaper
            ? t("proofMaps.family.descriptionPaper")
            : isLean
              ? t("proofMaps.family.descriptionLean")
              : t("proofMaps.family.descriptionScaffold")}
      meta={<>
        <span>{t("proofMaps.family.metaFamily", { number: family.number })}</span>
        <span>{family.subject}</span>
        <span>{family.manuscripts.length === 1 ? t("proofMaps.browser.manuscriptOne", { count: family.manuscripts.length }) : t("proofMaps.browser.manuscriptOther", { count: family.manuscripts.length })}</span>
        <span>{family.scope ? t("proofMaps.browser.scopeDocumented") : t("proofMaps.browser.scopeMissing")}</span>
        {deep && <span>{deep.strategies.length === 1 ? t("proofMaps.family.metaDeepOne", { strategies: deep.strategies.length, nodes: deep.strategies.reduce((total, strategy) => total + strategy.nodes.length, 0) }) : t("proofMaps.family.metaDeepOther", { strategies: deep.strategies.length, nodes: deep.strategies.reduce((total, strategy) => total + strategy.nodes.length, 0) })}</span>}
        <span>{t("proofMaps.family.metaReplay")}</span>
      </>}
      actions={<>
        <ActionLink variant="primary" href={`/publications/openai-math/${family.number}`}>{t("proofMaps.browser.publicationRecord")}</ActionLink>
        {isDeep ? <ActionLink variant="secondary" href="#argument-map">{t("proofMaps.landau.actionArgumentMap")}</ActionLink> : null}
        {isPaper ? <ActionLink variant="secondary" href="#paper-derived-map">{t("proofMaps.family.actionPaperMap")}</ActionLink> : null}
        {isLean ? <ActionLink variant="secondary" href="#lean-derived-map">{t("proofMaps.family.actionLeanMap")}</ActionLink> : null}
        <ActionLink variant="secondary" href="/proof-evolution">{t("proofMaps.family.actionAllMaps")}</ActionLink>
        {isDraft && <ActionLink variant="secondary" href={`/publications/openai-math/${family.number}#explanations`}>{t("proofMaps.family.actionDraftExplanation")}</ActionLink>}
      </>}
    />

    <div className="proof-map-family-content">
      <StatusBanner entry={entry} isDraft={isDraft} isDeep={isDeep} isPaper={isPaper} isLean={isLean} t={t} />

      {deep ? <DeepProofMapView deep={deep} subject={family.subject} revision={openaiMathCollection.source.revision} /> : explanation ? <DraftChain familyNumber={family.number} explanation={explanation} family={family} t={t} locale={locale} /> : isPaper && paperStructure ? <PaperDerivedMap structure={paperStructure} entry={entry} t={t} /> : isLean && leanFamily ? <LeanDerivedMap family={leanFamily} entry={entry} t={t} /> : <ScaffoldMap entry={entry} t={t} />}

      <div className="proof-map-family-grid">
        <ManuscriptSection family={family} t={t} />
        <ScopeSection family={family} entry={entry} t={t} />
      </div>

      {leanFamily && <LeanStructureSection family={leanFamily} t={t} />}

      <NextSteps entry={entry} isDraft={isDraft} isDeep={isDeep} isPaper={isPaper} isLean={isLean} t={t} />
    </div>
  </SiteFrame>;
}

function StatusBanner({ entry, isDraft, isDeep, isPaper, isLean, t }: { entry: ProofMapIndexEntry; isDraft: boolean; isDeep: boolean; isPaper: boolean; isLean: boolean; t: Translator }) {
  return <div className="proof-map-family-status">
    <Badge tone={isDeep ? "positive" : isDraft ? "warning" : "neutral"}>{t(statusKeys[entry.status])}</Badge>
    <p>{isDeep
      ? t("proofMaps.family.statusDeep")
      : isDraft
        ? t("proofMaps.family.statusDraft")
        : isPaper
          ? t("proofMaps.family.statusPaper")
          : isLean
            ? t("proofMaps.family.statusLean")
            : t("proofMaps.family.statusScaffold")}</p>
    <small>{entry.nextStep}</small>
  </div>;
}

function ScaffoldMap({ entry, t }: { entry: ProofMapIndexEntry; t: Translator }) {
  return <section className="proof-map-scaffold" aria-labelledby="scaffold-map-title">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">{t("proofMaps.family.scaffoldEyebrow")}</p><h2 id="scaffold-map-title">{t("proofMaps.family.scaffoldTitle")}</h2></div>
      <span>{t("proofMaps.family.scaffoldMeta")}</span>
    </div>
    <div className="proof-map-skeleton" aria-label={t("proofMaps.family.scaffoldAria")}>
      <SkeletonNode index="01" label={t("proofMaps.family.skeletonClaim")} value={t("proofMaps.family.skeletonSourcePinned")} detail={entry.claimSnippet} />
      <i aria-hidden="true">→</i>
      <SkeletonNode index="02" label={t("proofMaps.family.skeletonManuscripts")} value={`${entry.manuscriptCount}`} detail={t("proofMaps.family.skeletonManuscriptsDetail")} />
      <i aria-hidden="true">→</i>
      <SkeletonNode index="03" label={t("proofMaps.family.skeletonLean")} value={entry.scopeDocument ? t("proofMaps.family.skeletonScopeDocumented") : t("proofMaps.family.skeletonNotLinked")} detail={entry.scopeDocument ? t("proofMaps.family.skeletonLeanDetail", { comparators: entry.comparatorCount, manuscripts: entry.formalizedManuscripts }) : t("proofMaps.family.skeletonLeanMissing")} />
      <i aria-hidden="true">→</i>
      <SkeletonNode index="04" label={t("proofMaps.family.skeletonEvidence")} value={t("proofMaps.browser.replayNotRun")} detail={t("proofMaps.family.skeletonEvidenceDetail")} />
    </div>
    <p className="proof-map-skeleton-note">{t("proofMaps.family.skeletonNote")}</p>
  </section>;
}

function SkeletonNode({ index, label, value, detail }: { index: string; label: string; value: string; detail: string }) {
  return <article className="proof-map-skeleton-node">
    <span>{index} · {label}</span>
    <strong>{value}</strong>
    <p>{detail}</p>
  </article>;
}

function DraftChain({ familyNumber, explanation, family, t, locale }: { familyNumber: string; explanation: ClaimExplanation; family: NonNullable<ReturnType<typeof publicationFamily>>; t: Translator; locale: Locale }) {
  return <section className="proof-map-draft" aria-labelledby="draft-chain-title">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">{t("proofMaps.family.draftEyebrow")}</p><h2 id="draft-chain-title">{t("proofMaps.family.draftTitle")}</h2></div>
      <span><Badge tone="warning">{t("proofMaps.family.draftBadge")}</Badge></span>
    </div>
    <div className="explanation-grid">
      <ClaimCard explanation={explanation} t={t} />
      <ScopeDiff explanation={explanation} family={family} t={t} locale={locale} renderText={(text) => <MathText text={text} />} />
      <ProofMap explanation={explanation} t={t} />
      <LeanCompanion explanation={explanation} t={t} />
    </div>
    <p className="proof-map-draft-note">{t("proofMaps.family.draftNote", { number: familyNumber })}</p>
  </section>;
}

function ManuscriptSection({ family, t }: { family: NonNullable<ReturnType<typeof publicationFamily>>; t: Translator }) {
  return <Surface tone="card" className="proof-map-source-section">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">{t("proofMaps.family.manuscriptsEyebrow")}</p><h2>{t("proofMaps.family.manuscriptsTitle")}</h2></div>
      <span>{family.manuscripts.length === 1 ? t("proofMaps.browser.manuscriptOne", { count: family.manuscripts.length }) : t("proofMaps.browser.manuscriptOther", { count: family.manuscripts.length })}</span>
    </div>
    <div className="proof-map-manuscript-list">
      {family.manuscripts.map((manuscript) => <article key={manuscript.id}>
        <div className="proof-map-manuscript-top"><span>{manuscript.date}</span><span>{manuscript.authors.join(", ")}</span></div>
        <h3><MathText text={manuscript.title} /></h3>
        <p className="proof-map-manuscript-abstract"><MathText text={manuscript.abstract} /></p>
        <div className="proof-map-manuscript-links">
          <a href={manuscript.pdfUrl} target="_blank" rel="noreferrer">{t("proofMaps.deep.openPdf")}</a>
          <a href={manuscript.readmeUrl} target="_blank" rel="noreferrer">{t("proofMaps.deep.sourceNotes")}</a>
          <span>{manuscript.citedByScopeDocument ? t("proofMaps.family.namedInScope") : manuscript.listedInFormalizationIndex ? t("proofMaps.family.listedInIndex") : t("proofMaps.family.noFormalizationLink")}</span>
        </div>
      </article>)}
    </div>
  </Surface>;
}

function ScopeSection({ family, entry, t }: { family: NonNullable<ReturnType<typeof publicationFamily>>; entry: ProofMapIndexEntry; t: Translator }) {
  return <Surface tone="card" className="proof-map-source-section">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">{t("proofMaps.family.scopeEyebrow")}</p><h2>{t("proofMaps.family.scopeTitle")}</h2></div>
      <span>{family.scope ? t("proofMaps.family.comparatorLinks", { count: entry.comparatorCount }) : t("proofMaps.family.notLinked")}</span>
    </div>
    {family.scope ? <>
      <div className="proof-map-scope-text">
        {family.scope.text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}><MathText text={paragraph} /></p>)}
      </div>
      <div className="proof-map-scope-links">
        <a href={family.scope.url} target="_blank" rel="noreferrer">{t("proofMaps.family.openScope")}</a>
        {family.scope.paperLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`paper-${link.url}`}>{link.label} ↗</a>)}
        {family.scope.comparatorLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`comparator-${link.url}`}>{link.label} ↗</a>)}
      </div>
    </> : <div className="proof-map-scope-empty">
      <strong>{t("proofMaps.family.scopeEmptyTitle")}</strong>
      <p>{t("proofMaps.family.scopeEmptyBody")}</p>
      <a href={openaiMathCollection.environment.instructionsUrl} target="_blank" rel="noreferrer">{t("proofMaps.family.upstreamInstructions")}</a>
    </div>}
    <FieldList layout="stacked" className="proof-map-evidence-fields">
      <Field label={t("proofMaps.family.fieldReplay")}>{entry.proofweaveReplay === "not_run" ? t("proofMaps.family.replayNotRun") : entry.proofweaveReplay}</Field>
      <Field label={t("proofMaps.family.fieldStatementReview")}>{t("proofMaps.family.statementReviewNotStarted")}</Field>
      <Field label={t("proofMaps.family.fieldIndependentReview")}>{t("proofMaps.family.independentReviewNotRecorded")}</Field>
      <Field label={t("proofMaps.family.fieldReceipt")}>{t("proofMaps.family.none")}</Field>
      <Field label={t("proofMaps.family.fieldUpstreamLinked")}>{entry.formalizedManuscripts === 1 ? t("proofMaps.family.upstreamLinkedOne", { count: entry.formalizedManuscripts }) : t("proofMaps.family.upstreamLinkedOther", { count: entry.formalizedManuscripts })}</Field>
    </FieldList>
    {family.scope && <p className="proof-map-evidence-note">{t("proofMaps.family.evidenceNote")}</p>}
  </Surface>;
}

function LeanStructureSection({ family, t }: { family: LeanCoverageFamily; t: Translator }) {
  return <section id="lean-structure" className="proof-map-lean-section" aria-labelledby="lean-structure-title">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">{t("proofMaps.family.leanEyebrow")}</p><h2 id="lean-structure-title">{t("proofMaps.family.leanTitle")}</h2></div>
      <span><Badge tone={family.leanStructureStatus === "extracted" ? "positive" : family.leanStructureStatus === "partial" ? "warning" : "neutral"}>{t(leanStatusKeys[family.leanStructureStatus])}</Badge></span>
    </div>
    <div className="proof-map-lean-stats">
      <div><span>{t("proofMaps.family.statComparators")}</span><strong>{family.comparatorCount}</strong><small>{t("proofMaps.family.statComparatorsDetail", { count: family.solutionFetched })}</small></div>
      <div><span>{t("proofMaps.family.statTheoremNames")}</span><strong>{family.theoremNames.length}</strong><small>{t("proofMaps.family.statTheoremNamesDetail")}</small></div>
      <div><span>{t("proofMaps.family.statSorry")}</span><strong>{family.textualSorry}</strong><small>{t("proofMaps.family.statScanDetail")}</small></div>
      <div><span>{t("proofMaps.family.statAxioms")}</span><strong>{family.textualAxioms}</strong><small>{t("proofMaps.family.statScanDetail")}</small></div>
    </div>
    <div className="proof-map-lean-list">
      {family.comparators.map((comparator) => <details className="proof-map-lean-entry" key={comparator.label}>
        <summary>
          <div>
            <strong>{comparator.label}</strong>
            <span>{comparator.solutionModule ?? t("proofMaps.family.noSolutionModule")} · {comparator.theoremNames.length === 1 ? t("proofMaps.family.theoremCountOne", { count: comparator.theoremNames.length }) : t("proofMaps.family.theoremCountOther", { count: comparator.theoremNames.length })} · {t("proofMaps.family.linesCount", { count: comparator.solutionLines })}</span>
          </div>
          <Badge tone={comparator.solutionStatus === 200 ? "positive" : "warning"}>{comparator.solutionStatus === 200 ? t("proofMaps.family.solutionFetched") : t("proofMaps.family.solutionStatus", { code: comparator.solutionStatus })}</Badge>
        </summary>
        <div className="proof-map-lean-body">
          <div className="proof-map-lean-links">
            <a href={comparator.challengeUrl} target="_blank" rel="noreferrer">{t("proofMaps.family.challengeLink")}</a>
            <a href={comparator.jsonUrl} target="_blank" rel="noreferrer">{t("proofMaps.family.comparatorJson")}</a>
            {comparator.solutionUrl && <a href={comparator.solutionUrl} target="_blank" rel="noreferrer">{t("proofMaps.family.solutionLink")}</a>}
          </div>
          <div className="proof-map-lean-row">
            <span>{t("proofMaps.family.rowTheoremNames")}</span>
            {comparator.theoremNames.length > 0 ? <ul>{comparator.theoremNames.map((name) => <li key={name}><code>{name}</code></li>)}</ul> : <small>{t("proofMaps.family.noTheoremNames")}</small>}
          </div>
          <div className="proof-map-lean-row">
            <span>{t("proofMaps.family.permittedAxioms")}</span>
            <div>{comparator.permittedAxioms.map((axiom) => <Badge key={axiom}>{axiom}</Badge>)}</div>
          </div>
          <div className="proof-map-lean-row">
            <span>{t("proofMaps.family.rowSolutionModule")}</span>
            <code>{comparator.solutionModule ?? t("proofMaps.family.unavailable")}</code>
            <small>{t("proofMaps.family.solutionMeta", { lines: comparator.solutionLines, imports: comparator.solutionImports.length, solutionSorry: comparator.solutionSorry, solutionAxioms: comparator.solutionAxioms, challengeSorry: comparator.challengeSorry })}</small>
          </div>
          <div className="proof-map-lean-row">
            <span>{t("proofMaps.family.directImports")}</span>
            {comparator.solutionImports.length > 0 ? <ul>{comparator.solutionImports.map((module) => <li key={module}><code>{module}</code></li>)}</ul> : <small>{t("proofMaps.family.noDirectImports")}</small>}
          </div>
          <p className="proof-map-lean-note">{t("proofMaps.family.leanNoteA")}<code>sorry</code>{t("proofMaps.family.leanNoteB")}<code>#print axioms</code>{t("proofMaps.family.leanNoteC")}</p>
        </div>
      </details>)}
    </div>
    <p className="proof-map-lean-caveat">{t("proofMaps.family.leanCaveat")}</p>
  </section>;
}

function NextSteps({ entry, isDraft, isDeep, isPaper, isLean, t }: { entry: ProofMapIndexEntry; isDraft: boolean; isDeep: boolean; isPaper: boolean; isLean: boolean; t: Translator }) {
  return <Surface tone="card" className="proof-map-next-steps">
    <div className="proof-map-family-section-heading">
      <div><p className="eyebrow">{t("proofMaps.family.nextEyebrow")}</p><h2>{isDeep ? t("proofMaps.family.nextTitleVerify") : t("proofMaps.family.nextTitleFill")}</h2></div>
      <span>{t("proofMaps.family.nextStatus", { status: t(statusKeys[entry.status]) })}</span>
    </div>
    {isDeep ? <ol>
      <li><strong>{t("proofMaps.family.verifyStep1Title")}</strong> {t("proofMaps.family.verifyStep1Body")}</li>
      <li><strong>{t("proofMaps.family.verifyStep2Title")}</strong> {t("proofMaps.family.verifyStep2Body")}</li>
      <li><strong>{t("proofMaps.family.verifyStep3Title")}</strong> {t("proofMaps.family.verifyStep3Body")}</li>
      <li><strong>{t("proofMaps.family.verifyStep4Title")}</strong> {t("proofMaps.family.verifyStep4Body")}</li>
    </ol> : isPaper ? <ol>
      <li><strong>{t("proofMaps.family.paperStep1Title")}</strong> {t("proofMaps.family.paperStep1Body")}</li>
      <li><strong>{t("proofMaps.family.paperStep2Title")}</strong> {t("proofMaps.family.paperStep2Body")}</li>
      <li><strong>{t("proofMaps.family.paperStep3Title")}</strong> {t("proofMaps.family.paperStep3Body")}</li>
    </ol> : isLean ? <ol>
      <li><strong>{t("proofMaps.family.leanStep1Title")}</strong> {t("proofMaps.family.leanStep1Body")}</li>
      <li><strong>{t("proofMaps.family.leanStep2Title")}</strong> {t("proofMaps.family.leanStep2Body")}</li>
      <li><strong>{t("proofMaps.family.leanStep3Title")}</strong> {t("proofMaps.family.leanStep3Body")}</li>
    </ol> : <ol>
      <li><strong>{t("proofMaps.family.fillStep1Title")}</strong> {t("proofMaps.family.fillStep1Body")}</li>
      <li><strong>{t("proofMaps.family.fillStep2Title")}</strong> {t("proofMaps.family.fillStep2Body")}</li>
      <li><strong>{t("proofMaps.family.fillStep3Title")}</strong> {t("proofMaps.family.fillStep3Body")}</li>
      <li><strong>{t("proofMaps.family.fillStep4Title")}</strong> {t("proofMaps.family.fillStep4Body")}</li>
      <li><strong>{t("proofMaps.family.fillStep5Title")}</strong> {t("proofMaps.family.fillStep5Body")}</li>
    </ol>}
    <p className="proof-map-next-step">{isDeep ? t("proofMaps.family.nextNoteDeep") : isDraft ? t("proofMaps.family.nextNoteDraft") : entry.nextStep}</p>
    <div className="proof-map-next-actions">
      <Link href="/proof-evolution">{t("proofMaps.family.actionAllMapsBack")}</Link>
      <Link href={`/publications/openai-math/${entry.familyNumber}`}>{t("proofMaps.family.actionPublicationRecord")}</Link>
      <Link href="/support">{t("proofMaps.family.actionContribute")}</Link>
    </div>
  </Surface>;
}
