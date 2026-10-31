import { CardTitle, SectionTitle, ActionLink, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { type PublicCreditMarket } from "@/db/repositories/credit-market";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

const poolStateKeys: Record<NonNullable<PublicCreditMarket["pool"]>["state"], TranslationKey> = {
  draft: "explore.market.pool.draft",
  active: "explore.market.pool.active",
  locked: "explore.market.pool.locked",
  settled: "explore.market.pool.settled",
  cancelled: "explore.market.pool.cancelled",
};

export async function CreditMarketPanel({
  market,
}: {
  market: PublicCreditMarket | null;
}) {
  const { t, locale } = await getI18n();
  if (!market) {
    return <section className="credit-market-section" aria-labelledby="credit-market-title">
      <MarketHeading t={t} />
      <div className="credit-market-unavailable">
        <strong>{t("explore.market.inactive.title")}</strong>
        <p>{t("explore.market.inactive.body")}</p>
      </div>
    </section>;
  }

  const poolState = market.pool ? t(poolStateKeys[market.pool.state]) : t("explore.market.noPool");
  return <section className="credit-market-section" aria-labelledby="credit-market-title">
    <MarketHeading t={t} />
    <div className="credit-market-board">
      <Surface as="article" className="credit-market-summary">
        <div className="credit-market-summary-top">
          <span className={`credit-market-state ${market.pool ? `state-${market.pool.state}` : "state-inactive"}`}>{poolState}</span>
          <code>{market.policy.version}</code>
        </div>
        <p className="micro-label">{t("explore.market.budgetLabel")}</p>
        <CardTitle>{market.pool ? t("explore.market.poolCredits", { credits: formatCredits(market.pool.totalCredits, locale) }) : t("explore.market.policyFirst")}</CardTitle>
        <p>{market.pool
          ? t("explore.market.poolBody", { sponsor: market.pool.sponsorLabel })
          : t("explore.market.noPoolBody")}</p>
        <div className="credit-market-actions">
          <ActionLink className="button button-primary" href="#research-graph">{t("explore.market.inspectGraph")} <span aria-hidden="true">↓</span></ActionLink>
          <Link className="text-link" href="/reviews">{t("explore.market.openQueue")} <span>→</span></Link>
        </div>
      </Surface>

      <div className="credit-market-buckets" aria-label={t("explore.market.allocationAria")}>
        {market.policy.buckets.map((bucket, index) => <Surface as="article" key={bucket.key}>
          <div><span>{String(index + 1).padStart(2, "0")}</span><strong>{bucket.percentage}%</strong></div>
          <h4>{bucket.label}</h4>
          <p>{bucket.description}</p>
          <small>{bucket.credits === null ? t("explore.market.shareFixed") : t("explore.market.creditsReserved", { credits: formatCredits(bucket.credits, locale) })}</small>
        </Surface>)}
      </div>
    </div>

    <div className="credit-market-evidence">
      <div className="credit-market-activity">
        <p className="micro-label">{t("explore.market.evidenceLabel")}</p>
        <FieldList layout="stacked">
          <MarketMetric label={t("explore.market.metric.shared")} value={market.activity.sharedCheckpoints} />
          <MarketMetric label={t("explore.market.metric.bundle")} value={market.activity.bundleBackedCheckpoints} />
          <MarketMetric label={t("explore.market.metric.kernel")} value={market.activity.kernelAcceptedCheckpoints} />
          <MarketMetric label={t("explore.market.metric.reviewed")} value={market.activity.independentlyReviewedCheckpoints} />
          <MarketMetric label={t("explore.market.metric.eligible")} value={market.activity.settlementEligibleCheckpoints} />
        </FieldList>
        <p>{market.activity.openReviewAssignments > 0
          ? t(market.activity.openReviewAssignments === 1 ? "explore.market.openReviews.one" : "explore.market.openReviews.other", { count: market.activity.openReviewAssignments })
          : t("explore.market.noReviews")}</p>
      </div>
      <div className="credit-eligibility-rail">
        <p className="micro-label">{t("explore.market.eligibilityLabel")}</p>
        <ol>
          {market.policy.eligibilityStages.map((stage, index) => <li className={stage.eligible ? "is-eligible" : ""} key={stage.key}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.label}</strong>
            <small>{stage.eligible ? t("explore.market.eligible") : t("explore.market.gate")}</small>
          </li>)}
        </ol>
      </div>
    </div>

    <div className="credit-market-boundary">
      <strong>{t("explore.market.boundaryTitle")}</strong>
      <p>{t("explore.market.boundaryBody")}</p>
    </div>
  </section>;
}

function MarketHeading({ t }: { t: Translator }) {
  return <SectionHeading as="div" className="credit-market-heading">
    <div>
      <p className="eyebrow">{t("explore.market.eyebrow")}</p>
      <SectionTitle id="credit-market-title">{t("explore.market.title")}</SectionTitle>
      <p>{t("explore.market.body")}</p>
    </div>
    <span>{t("explore.market.nonFinancial")}</span>
  </SectionHeading>;
}

function MarketMetric({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatCredits(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale).format(value);
}
