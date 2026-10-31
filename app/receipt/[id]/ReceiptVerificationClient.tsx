"use client";

import { Button, SectionTitle } from "@/app/components/ui";

import { useRef, useState } from "react";
import {
  contributionReceiptVerificationBundleHash,
  normalizeContributionReceiptVerificationBundle,
  verifyContributionReceiptVerificationBundle,
  verifyContributionReceiptVerificationBundleWithIssuerKeyset,
} from "@/packages/protocol/contribution-receipt-verification-bundle.mjs";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  verifyContributionReceiptSignature,
} from "@/packages/protocol/contribution-receipt.mjs";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey } from "@/app/i18n/translate";

type GateId = "bundle" | "hash" | "signature" | "policy" | "closure" | "keys";
type GateStatus = "idle" | "running" | "passed" | "failed" | "unavailable";
type GateState = Readonly<{ id: GateId; status: GateStatus; detail?: string; error?: string }>;
type Verdict = "passed" | "failed" | "partial";

const gateOrder: readonly GateId[] = ["bundle", "hash", "signature", "policy", "closure", "keys"];

const gateCopy: Record<GateId, { label: TranslationKey; idle: TranslationKey; passed: TranslationKey }> = {
  bundle: { label: "receiptVerify.gate.bundle", idle: "receiptVerify.gate.bundleIdle", passed: "receiptVerify.gate.bundleDetail" },
  hash: { label: "receiptVerify.gate.hash", idle: "receiptVerify.gate.hashIdle", passed: "receiptVerify.gate.hashIdle" },
  signature: { label: "receiptVerify.gate.signature", idle: "receiptVerify.gate.signatureDetail", passed: "receiptVerify.gate.signatureDetail" },
  policy: { label: "receiptVerify.gate.policy", idle: "receiptVerify.gate.policyDetail", passed: "receiptVerify.gate.policyDetail" },
  closure: { label: "receiptVerify.gate.closure", idle: "receiptVerify.gate.closureDetail", passed: "receiptVerify.gate.closureDetail" },
  keys: { label: "receiptVerify.gate.keys", idle: "receiptVerify.gate.keysDetail", passed: "receiptVerify.gate.keysDetail" },
};

const stateCopy: Record<GateStatus, TranslationKey> = {
  idle: "receiptVerify.state.idle",
  running: "receiptVerify.state.running",
  passed: "receiptVerify.state.passed",
  failed: "receiptVerify.state.failed",
  unavailable: "receiptVerify.state.unavailable",
};

const verdictCopy: Record<Verdict, TranslationKey> = {
  passed: "receiptVerify.result.passed",
  failed: "receiptVerify.result.failed",
  partial: "receiptVerify.result.partial",
};

type VerificationBundle = Readonly<{
  rootReceiptId: string;
  receipts: readonly Readonly<{
    receipt: Readonly<{ id: string }> & Record<string, unknown>;
    receiptHash: string;
  }>[];
  issuerKeys: readonly Readonly<{ id: string }>[];
}>;

function initialGates(): GateState[] {
  return gateOrder.map((id) => ({ id, status: "idle" as const }));
}

function reasonOf(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return undefined;
}

/**
 * Re-runs the published protocol in the reader's own browser. The server only
 * serves the portable bundle; the verdict shown here is computed locally from
 * those bytes, so a reader never has to trust this page's word for it.
 */
export function ReceiptVerificationClient({ receiptId }: { receiptId: string }) {
  const { t } = useI18n();
  const [gates, setGates] = useState<GateState[]>(initialGates);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [bundleHash, setBundleHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const setGate = (id: GateId, patch: Omit<GateState, "id">) => {
    setGates((current) => current.map((gate) => (gate.id === id ? { ...gate, ...patch } : gate)));
  };

  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setVerdict(null);
    setError(null);
    setBundleHash(null);
    setGates(initialGates());
    let failed = false;
    let currentGate: GateId = "bundle";
    const enter = (id: GateId) => {
      currentGate = id;
      setGate(id, { status: "running" });
    };
    const fail = (id: GateId, reason?: string) => {
      failed = true;
      setGate(id, { status: "failed", error: reason });
    };

    try {
      enter("bundle");
      let response: Response;
      try {
        response = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}/verification-bundle`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
      } catch {
        fail("bundle");
        setError(t("receiptVerify.error.network"));
        setVerdict("failed");
        return;
      }
      if (response.status === 404) {
        fail("bundle");
        setError(t("receiptVerify.error.notFound"));
        setVerdict("failed");
        return;
      }
      if (!response.ok) {
        fail("bundle", `HTTP ${response.status}`);
        setError(t("receiptVerify.error.network"));
        setVerdict("failed");
        return;
      }
      const payload = await response.json().catch(() => null);
      let bundle: VerificationBundle;
      try {
        bundle = normalizeContributionReceiptVerificationBundle(payload) as VerificationBundle;
      } catch (cause) {
        fail("bundle", reasonOf(cause));
        setVerdict("failed");
        return;
      }
      setGate("bundle", {
        status: "passed",
        detail: t("receiptVerify.gate.bundleDetail", {
          receipts: bundle.receipts.length,
          keys: bundle.issuerKeys.length,
        }),
      });
      const root = bundle.receipts.find((entry) => entry.receipt.id === bundle.rootReceiptId);
      if (!root) {
        fail("bundle");
        setVerdict("failed");
        return;
      }

      enter("hash");
      const recomputedHash = await contributionReceiptHash(root.receipt);
      if (recomputedHash !== root.receiptHash) {
        fail("hash", `${recomputedHash} ≠ ${root.receiptHash}`);
        setVerdict("failed");
        return;
      }
      setGate("hash", { status: "passed", detail: shortHash(recomputedHash) });

      enter("signature");
      if (!await verifyContributionReceiptSignature(root.receipt)) {
        fail("signature");
        setVerdict("failed");
        return;
      }
      setGate("signature", { status: "passed", detail: t("receiptVerify.gate.signatureDetail") });

      enter("policy");
      try {
        assertContributionReceiptPolicy(root.receipt);
      } catch (cause) {
        fail("policy", reasonOf(cause));
        setVerdict("failed");
        return;
      }
      setGate("policy", { status: "passed", detail: t("receiptVerify.gate.policyDetail") });

      enter("closure");
      try {
        await verifyContributionReceiptVerificationBundle(bundle);
      } catch (cause) {
        fail("closure", reasonOf(cause));
        setVerdict("failed");
        return;
      }
      setGate("closure", { status: "passed", detail: t("receiptVerify.gate.closureDetail") });

      setBundleHash(await contributionReceiptVerificationBundleHash(bundle));

      enter("keys");
      let keyset: unknown = null;
      try {
        const keysetResponse = await fetch("/api/receipts/issuer-keys", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (keysetResponse.ok) keyset = await keysetResponse.json();
      } catch {
        keyset = null;
      }
      if (!keyset) {
        setGate("keys", { status: "unavailable" });
        if (!failed) setVerdict("partial");
        return;
      }
      try {
        await verifyContributionReceiptVerificationBundleWithIssuerKeyset(bundle, keyset);
      } catch (cause) {
        fail("keys", reasonOf(cause));
        setVerdict("failed");
        return;
      }
      setGate("keys", { status: "passed", detail: t("receiptVerify.gate.keysDetail") });
      setVerdict(failed ? "failed" : "passed");
    } catch (cause) {
      fail(currentGate, reasonOf(cause));
      setVerdict("failed");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  return (
    <section className="receipt-verify" id="receipt-verification" aria-labelledby="receipt-verification-title">
      <div className="receipt-verify-copy">
        <p className="eyebrow">{t("receiptVerify.eyebrow")}</p>
        <SectionTitle id="receipt-verification-title">{t("receiptVerify.title")}</SectionTitle>
        <p>{t("receiptVerify.body")}</p>
        <div className="receipt-verify-actions">
          <Button variant="primary" type="button" onClick={() => { void run(); }} disabled={running} busy={running}>
            {running ? t("receiptVerify.running") : verdict ? t("receiptVerify.again") : t("receiptVerify.action")}
          </Button>
          <a href={`/api/receipts/${encodeURIComponent(receiptId)}/verification-bundle`}>
            {t("receiptVerify.download")}
          </a>
        </div>
        {error && <p className="receipt-verify-error" role="alert">{error}</p>}
      </div>

      <div className="receipt-verify-panel" aria-live="polite">
        {verdict && <div className={`receipt-verify-verdict is-${verdict}`}>
          <span className="receipt-verify-signal" aria-hidden="true">{verdict === "failed" ? "!" : "✓"}</span>
          <div>
            <strong>{t(verdictCopy[verdict])}</strong>
            <p>{t("receiptVerify.result.note")}</p>
            {bundleHash && <small>{t("receiptVerify.bundleHash")} <code>{shortHash(bundleHash)}</code></small>}
          </div>
        </div>}
        <ol className="receipt-verify-gates">
          {gates.map((gate, index) => <li key={gate.id} className={`is-${gate.status}`}>
            <span className="receipt-verify-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="receipt-verify-gate-copy">
              <strong>{t(gateCopy[gate.id].label)}</strong>
              <p>{gate.detail ?? t(gateCopy[gate.id].idle)}</p>
              {gate.error && <details className="receipt-verify-reason">
                <summary>{t("receiptVerify.error.prefix")}</summary>
                <code>{gate.error}</code>
              </details>}
            </div>
            <span className="receipt-verify-state">{t(stateCopy[gate.status])}</span>
          </li>)}
        </ol>
      </div>
    </section>
  );
}

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return normalized.length > 24 ? `sha256:${normalized.slice(0, 10)}…${normalized.slice(-8)}` : value;
}
