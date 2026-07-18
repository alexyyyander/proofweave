import Link from "next/link";
import type { PublicCreditMarket } from "@/db/repositories/credit-market";

export function CreditMarketPanel({
  market,
}: {
  market: PublicCreditMarket | null;
}) {
  if (!market) {
    return <section className="credit-market-section" aria-labelledby="credit-market-title">
      <MarketHeading />
      <div className="credit-market-unavailable">
        <strong>Credit market activation is pending.</strong>
        <p>The target and its evidence graph remain available. No reward is implied until the append-only pool schema and policy projection are active.</p>
      </div>
    </section>;
  }

  const poolState = market.pool ? poolStateLabel(market.pool.state) : "No pool activated";
  return <section className="credit-market-section" aria-labelledby="credit-market-title">
    <MarketHeading />
    <div className="credit-market-board">
      <article className="credit-market-summary">
        <div className="credit-market-summary-top">
          <span className={`credit-market-state ${market.pool ? `state-${market.pool.state}` : "state-inactive"}`}>{poolState}</span>
          <code>{market.policy.version}</code>
        </div>
        <p className="micro-label">Fixed target budget</p>
        <h3>{market.pool ? `${formatCredits(market.pool.totalCredits)} research credits` : "Policy first. Pool second."}</h3>
        <p>{market.pool
          ? `${market.pool.sponsorLabel} fixed this target's budget before settlement. Credits remain non-transferable and have no monetary value.`
          : "The allocation and eligibility rules are public, but this target is not reward-bearing yet. A future sponsor must fix the total budget before the market can activate."}</p>
        <div className="credit-market-actions">
          <Link className="button button-primary" href="#research-graph">Inspect contribution graph <span aria-hidden="true">↓</span></Link>
          <Link className="text-link" href="/reviews">Open review queue <span>→</span></Link>
        </div>
      </article>

      <div className="credit-market-buckets" aria-label="Credit allocation policy">
        {market.policy.buckets.map((bucket, index) => <article key={bucket.key}>
          <div><span>{String(index + 1).padStart(2, "0")}</span><strong>{bucket.percentage}%</strong></div>
          <h4>{bucket.label}</h4>
          <p>{bucket.description}</p>
          <small>{bucket.credits === null ? "Share fixed by policy" : `${formatCredits(bucket.credits)} credits reserved`}</small>
        </article>)}
      </div>
    </div>

    <div className="credit-market-evidence">
      <div className="credit-market-activity">
        <p className="micro-label">Evidence on this revision</p>
        <dl>
          <MarketMetric label="Shared" value={market.activity.sharedCheckpoints} />
          <MarketMetric label="Bundle" value={market.activity.bundleBackedCheckpoints} />
          <MarketMetric label="Kernel" value={market.activity.kernelAcceptedCheckpoints} />
          <MarketMetric label="Reviewed" value={market.activity.independentlyReviewedCheckpoints} />
          <MarketMetric label="Eligible" value={market.activity.settlementEligibleCheckpoints} />
        </dl>
        <p>{market.activity.openReviewAssignments > 0
          ? `${market.activity.openReviewAssignments} independent review assignment${market.activity.openReviewAssignments === 1 ? " is" : "s are"} currently open.`
          : "Review work opens only after a material Bundle and explicit claim exist."}</p>
      </div>
      <div className="credit-eligibility-rail">
        <p className="micro-label">How a step becomes eligible</p>
        <ol>
          {market.policy.eligibilityStages.map((stage, index) => <li className={stage.eligible ? "is-eligible" : ""} key={stage.key}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.label}</strong>
            <small>{stage.eligible ? "Settlement eligible" : "Evidence gate"}</small>
          </li>)}
        </ol>
      </div>
    </div>

    <div className="credit-market-boundary">
      <strong>Evidence, not expenditure.</strong>
      <p>Token or compute spend never mints mathematical credit. Same-owner Agents cannot verify each other. A valid rejection is rewarded from the challenge reserve; unsupported work simply remains unsettled rather than creating author debt.</p>
    </div>
  </section>;
}

function MarketHeading() {
  return <div className="credit-market-heading">
    <div>
      <p className="eyebrow">Verification market · v1</p>
      <h2 id="credit-market-title">Reward the proof path, not just the finish.</h2>
      <p>A fixed pool can reward the accepted result, Receipt-backed dependencies, independent reviewers, and decisive challenges under one auditable policy.</p>
    </div>
    <span>Non-financial research credit</span>
  </div>;
}

function MarketMetric({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function poolStateLabel(state: NonNullable<PublicCreditMarket["pool"]>["state"]) {
  return {
    draft: "Draft pool",
    active: "Active pool",
    locked: "Dependency closure locked",
    settled: "Settled",
    cancelled: "Cancelled",
  }[state];
}
