import { Suspense } from "react";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { PageTitle, SectionTitle, Field, ActionLink, CodeBlock, FieldList, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageSectionNav, ProductStateBadge } from "@/app/ui";

import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { latestLiveBuildWeekClosure } from "@/db/repositories/live-demo";
import { getI18n } from "@/app/i18n/server";
import { DemoVerificationClient } from "./DemoVerificationClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("demoPage.metaTitle"), description: t("demoPage.metaDescription") };
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale } = await getI18n();
  const params = await searchParams;
  const verification = await verifyBuildWeekDemoFixture({
    mode: params?.tamper === "artifact" ? "tampered_copy" : "reference",
    stableRun: true,
    locale,
  });

  return (
    <SiteFrame className="site-shell demo-shell" active="demo">
        <section className="demo-hero" aria-labelledby="demo-page-title">
          <div className="demo-hero-copy">
            <p className="eyebrow">{t("demoPage.hero.eyebrow")}</p>
            <PageTitle id="demo-page-title">{t("demoPage.hero.titleLead")}<span>{t("demoPage.hero.titleAccent")}</span></PageTitle>
            <p className="hero-lede">{t("demoPage.hero.lede")}</p>
            <div className="button-row">
              <ActionLink className="button button-primary" href="#demo-walkthrough">{t("demoPage.hero.walkthrough")} <span aria-hidden="true">↓</span></ActionLink>
              <ActionLink className="button button-secondary" href="/start">{t("demoPage.hero.start")}</ActionLink>
            </div>
          </div>
          <ol className="demo-chain" aria-label={t("demoPage.chain.aria")}>
            <li><span>01</span><div><strong>{t("demoPage.chain.delegate.title")}</strong><p>{t("demoPage.chain.delegate.copy")}</p></div></li>
            <li><span>02</span><div><strong>{t("demoPage.chain.sign.title")}</strong><p>{t("demoPage.chain.sign.copy")}</p></div></li>
            <li><span>03</span><div><strong>{t("demoPage.chain.check.title")}</strong><p>{t("demoPage.chain.check.copy")}</p></div></li>
            <li><span>04</span><div><strong>{t("demoPage.chain.review.title")}</strong><p>{t("demoPage.chain.review.copy")}</p></div></li>
            <li><span>05</span><div><strong>{t("demoPage.chain.credit.title")}</strong><p>{t("demoPage.chain.credit.copy")}</p></div></li>
          </ol>
        </section>

        <section className="demo-boundary" aria-label={t("demoPage.boundary.aria")}>
          <strong>{t("demoPage.boundary.title")}</strong>
          <p>{verification.disclosure}</p>
          <ProductStateBadge tone="verified">{t("demoPage.boundary.badge")}</ProductStateBadge>
        </section>

        <Suspense fallback={<ContentLoading label={t("demoPage.loading")} />}><LiveProtocolRecord /></Suspense>

        <PageSectionNav
          tone="dark"
          label={t("demoPage.nav.label")}
          links={[
            { href: "#demo-walkthrough", label: t("demoPage.nav.walkthrough") },
            { href: "#live-network-record", label: t("demoPage.nav.liveRecord") },
            { href: "#verification-console", label: t("demoPage.nav.liveVerification") },
            { href: "#mathematical-payload", label: t("demoPage.nav.leanSource") },
            { href: "#demo-boundaries", label: t("demoPage.nav.claimBoundary") },
          ]}
        />

        <DemoVerificationClient initial={verification} />

        <section className="demo-proof-section" id="mathematical-payload">
          <div className="demo-proof-copy">
            <p className="eyebrow">{t("demoPage.payload.eyebrow")}</p>
            <SectionTitle>{t("demoPage.payload.title")}</SectionTitle>
            <p>{t("demoPage.payload.body")}</p>
            <FieldList>
              <Field label={t("demoPage.payload.agent")}>{verification.record.agent}</Field>
              <Field label={t("demoPage.payload.repository")}>{verification.record.repository}</Field>
              <Field label={t("demoPage.payload.policy")}>{t("demoPage.payload.policyValue")}</Field>
            </FieldList>
          </div>
          <Surface as="div" className="demo-source-panel">
            <div><span>ProofweaveFixture.lean</span><span>{t("demoPage.payload.kernelAccepted")}</span></div>
            <CodeBlock><code>{verification.record.source}</code></CodeBlock>
          </Surface>
        </section>

        <section className="demo-honesty-grid" id="demo-boundaries">
          <Surface as="article"><span className="micro-label">{t("demoPage.honesty.provesLabel")}</span><SectionTitle>{t("demoPage.honesty.provesTitle")}</SectionTitle><p>{t("demoPage.honesty.provesBody")}</p></Surface>
          <Surface as="article"><span className="micro-label">{t("demoPage.honesty.notLabel")}</span><SectionTitle>{t("demoPage.honesty.notTitle")}</SectionTitle><p>{t("demoPage.honesty.notBody")}</p></Surface>
        </section>

        <section className="demo-reproduce" id="reproduce" aria-labelledby="demo-reproduce-title">
          <div>
            <p className="eyebrow">{t("demoPage.reproduce.eyebrow")}</p>
            <SectionTitle id="demo-reproduce-title">{t("demoPage.reproduce.title")}</SectionTitle>
            <p>{t("demoPage.reproduce.body")}</p>
          </div>
          <div className="demo-reproduce-command">
            <span>{t("demoPage.reproduce.after")}</span>
            <code>npm run demo:e2e:check</code>
            <small>{t("demoPage.reproduce.note")}</small>
          </div>
        </section>

        <section className="closing-section demo-closing">
          <p className="eyebrow">{t("demoPage.closing.eyebrow")}</p>
          <SectionTitle>{t("demoPage.closing.title")}</SectionTitle>
          <div className="button-row"><ActionLink className="button button-primary" href="/start">{t("demoPage.closing.start")} <span aria-hidden="true">→</span></ActionLink><ActionLink className="button button-secondary" href="/explore">{t("demoPage.closing.explore")}</ActionLink></div>
        </section>
      </SiteFrame>
  );
}

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return normalized.length > 22 ? `${normalized.slice(0, 10)}…${normalized.slice(-8)}` : value;
}

async function LiveProtocolRecord() {
  const { t } = await getI18n();
  const liveClosure = await latestLiveBuildWeekClosure().catch(() => null);
  return (<section className={`demo-live-record ${liveClosure ? "is-issued" : "is-pending"}`} id="live-network-record" aria-labelledby="demo-live-record-title">
          <div>
            <p className="eyebrow">{t("demoPage.live.eyebrow")}</p>
            <SectionTitle id="demo-live-record-title">{liveClosure ? t("demoPage.live.recordedTitle") : t("demoPage.live.pendingTitle")}</SectionTitle>
            <p>{liveClosure
              ? t("demoPage.live.recordedBody", { target: liveClosure.target, reviewers: liveClosure.reviewerCount, attestations: liveClosure.attestationCount })
              : t("demoPage.live.pendingBody")}</p>
          </div>
          {liveClosure ? <div className="demo-live-record-proof">
            <FieldList>
              <Field label={t("demoPage.live.replay")}><code>{shortHash(liveClosure.replayRunId)}</code></Field>
              <Field label={t("demoPage.live.evidence")}><code>{shortHash(liveClosure.replayEvidenceHash)}</code></Field>
              <Field label={t("demoPage.live.mockOwners")}>{t("demoPage.live.mockOwnersValue", { count: liveClosure.reviewerCount })}</Field>
              <Field label={t("demoPage.live.receipt")}><code>{shortHash(liveClosure.receiptHash)}</code></Field>
            </FieldList>
            <a className="button button-primary" href="#verification-console">{t("demoPage.live.inspect")} <span aria-hidden="true">↓</span></a>
          </div> : <ProductStateBadge tone="provisional">{t("demoPage.live.referenceOnly")}</ProductStateBadge>}
        </section>);
}
