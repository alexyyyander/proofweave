import { ActionLink, CardTitle, SectionTitle } from "@/app/components/ui";

import type { PublicContributionReceipt } from "@/db/repositories/receipts";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

/**
 * Reads the receipt as a claim rather than a machine record: what a reader may
 * conclude from it, which pinned inputs it inherits, and where its evidence
 * stops. Every line is derived from the signed fields, so the block cannot
 * promise a review that the receipt does not carry.
 */
const claimOrder = [
  "bundle_reproducible",
  "kernel_accepted",
  "project_accepted",
  "statement_faithful",
  "novelty_reviewed",
] as const satisfies readonly PublicContributionReceipt["claims"][number]["claimType"][];

const requiredClaims: readonly PublicContributionReceipt["claims"][number]["claimType"][] = [
  "bundle_reproducible",
  "kernel_accepted",
  "project_accepted",
];

const claimLabelKeys: Record<(typeof claimOrder)[number], TranslationKey> = {
  bundle_reproducible: "receipt.boundary.claim.bundle_reproducible",
  kernel_accepted: "receipt.boundary.claim.kernel_accepted",
  project_accepted: "receipt.boundary.claim.project_accepted",
  statement_faithful: "receipt.boundary.claim.statement_faithful",
  novelty_reviewed: "receipt.boundary.claim.novelty_reviewed",
};

export function ReceiptBoundary({ receipt, reviewerCount, t }: {
  receipt: PublicContributionReceipt;
  reviewerCount: number;
  t: Translator;
}) {
  const attested = (claimType: PublicContributionReceipt["claims"][number]["claimType"]) =>
    receipt.claims.some((claim) => claim.claimType === claimType);
  const dependencyCount = receipt.bundle.dependencyReceipts.length;
  const environment = receipt.run.environment;

  return (
    <section className="receipt-boundary" aria-labelledby="receipt-boundary-title">
      <div className="receipt-boundary-heading">
        <div>
          <p className="eyebrow">{t("receipt.boundary.eyebrow")}</p>
          <SectionTitle id="receipt-boundary-title">{t("receipt.boundary.title")}</SectionTitle>
          <p>{t("receipt.boundary.body")}</p>
        </div>
        <ActionLink variant="primary" href="#receipt-verification">
          {t("receipt.boundary.action")} <span aria-hidden="true">↓</span>
        </ActionLink>
      </div>

      <div className="receipt-boundary-grid">
        <div className="receipt-boundary-column">
          <CardTitle as="h3" className="receipt-boundary-column-title">{t("receipt.boundary.establishes")}</CardTitle>
          <ul>
            <li>{t("receipt.boundary.kernel", {
              declaration: receipt.target.declaration,
              run: shortValue(receipt.run.id),
            })}</li>
            <li>{t("receipt.boundary.claims", {
              attestations: receipt.claims.length,
              people: reviewerCount,
            })}</li>
            <li>{dependencyCount === 0
              ? t("receipt.boundary.dependencies.none")
              : dependencyCount === 1
                ? t("receipt.boundary.dependencies.one")
                : t("receipt.boundary.dependencies.other", { count: dependencyCount })}</li>
            {attested("statement_faithful") && <li>{t("receipt.boundary.statementFaithful")}</li>}
            {attested("novelty_reviewed") && <li>{t("receipt.boundary.noveltyReviewed")}</li>}
          </ul>
        </div>

        <div className="receipt-boundary-column">
          <CardTitle as="h3" className="receipt-boundary-column-title">{t("receipt.boundary.relies")}</CardTitle>
          <ul>
            {environment && <li>{t("receipt.boundary.environment", {
              lean: environment.leanToolchain,
              mathlib: environment.mathlibRevision.slice(0, 12),
            })}</li>}
            {environment && <li>{t("receipt.boundary.image", {
              image: shortDigest(environment.imageDigest),
            })}</li>}
            <li>{t("receipt.boundary.statement", { hash: shortValue(receipt.target.statementHash) })}</li>
            <li>{t("receipt.boundary.issuer", { key: receipt.issuerKeyId })}</li>
            {dependencyCount > 0 && <li>{t("receipt.boundary.upstream")}</li>}
          </ul>
        </div>

        <div className="receipt-boundary-column is-limits">
          <CardTitle as="h3" className="receipt-boundary-column-title">{t("receipt.boundary.limits")}</CardTitle>
          <ul>
            {!attested("statement_faithful") && <li>{t("receipt.boundary.limit.statement")}</li>}
            {!attested("novelty_reviewed") && <li>{t("receipt.boundary.limit.novelty")}</li>}
            {!environment && <li>{t("receipt.boundary.limit.environment")}</li>}
            <li>{t("receipt.boundary.limit.scope")}</li>
            <li>{t("receipt.boundary.limit.human")}</li>
          </ul>
        </div>
      </div>

      <div className="receipt-claim-coverage">
        <div className="receipt-claim-coverage-copy">
          <p className="eyebrow">{t("receipt.boundary.coverageTitle")}</p>
          <p>{t("receipt.boundary.coverageBody")}</p>
        </div>
        <ul>
          {claimOrder.map((claimType) => {
            const present = attested(claimType);
            const required = requiredClaims.includes(claimType);
            return <li key={claimType} className={present ? "is-attested" : "is-missing"}>
              <span className="receipt-claim-state">{present
                ? t("receipt.boundary.coverageAttested")
                : t("receipt.boundary.coverageMissing")}</span>
              <span className="receipt-claim-label">{t(claimLabelKeys[claimType])}</span>
              <small>{required
                ? t("receipt.boundary.coverageRequired")
                : t("receipt.boundary.coverageOptional")}</small>
            </li>;
          })}
        </ul>
      </div>
    </section>
  );
}

function shortValue(value: string) {
  return value.length > 26 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value;
}

function shortDigest(digest: string) {
  const value = digest.replace(/^sha256:/, "");
  return value.length > 34 ? `${value.slice(0, 16)}…${value.slice(-10)}` : value;
}
