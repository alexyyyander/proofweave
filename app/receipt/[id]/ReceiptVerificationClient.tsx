"use client";

import { Button, SectionTitle } from "@/app/components/ui";

import { useRef, useState } from "react";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey } from "@/app/i18n/translate";
import {
  verifyReceiptBundle,
  type ReceiptGateId,
  type ReceiptGateResult,
  type ReceiptVerificationResult,
  type ReceiptVerdict,
} from "./receipt-verification";

type GateStatus = "idle" | "running" | "passed" | "failed" | "unavailable";
type GateState = Readonly<{ id: ReceiptGateId; status: GateStatus; detail?: string; error?: string }>;

const gateOrder: readonly ReceiptGateId[] = ["bundle", "identity", "hash", "signature", "policy", "closure", "keys"];

const gateCopy: Record<ReceiptGateId, { label: TranslationKey; idle: TranslationKey }> = {
  bundle: { label: "receiptVerify.gate.bundle", idle: "receiptVerify.gate.bundleIdle" },
  identity: { label: "receiptVerify.gate.identity", idle: "receiptVerify.gate.identityIdle" },
  hash: { label: "receiptVerify.gate.hash", idle: "receiptVerify.gate.hashIdle" },
  signature: { label: "receiptVerify.gate.signature", idle: "receiptVerify.gate.signatureDetail" },
  policy: { label: "receiptVerify.gate.policy", idle: "receiptVerify.gate.policyDetail" },
  closure: { label: "receiptVerify.gate.closure", idle: "receiptVerify.gate.closureDetail" },
  keys: { label: "receiptVerify.gate.keys", idle: "receiptVerify.gate.keysIdle" },
};

const stateCopy: Record<GateStatus, TranslationKey> = {
  idle: "receiptVerify.state.idle",
  running: "receiptVerify.state.running",
  passed: "receiptVerify.state.passed",
  failed: "receiptVerify.state.failed",
  unavailable: "receiptVerify.state.unavailable",
};

const verdictCopy: Record<ReceiptVerdict, TranslationKey> = {
  passed: "receiptVerify.result.passed",
  failed: "receiptVerify.result.failed",
  partial: "receiptVerify.result.partial",
};

function initialGates(): GateState[] {
  return gateOrder.map((id) => ({ id, status: "idle" as const }));
}

/**
 * Re-runs the published protocol in the reader's own browser. The server only
 * serves the portable bundle; the verdict shown here is computed locally from
 * those bytes, so a reader never has to trust this page's word for it. The
 * checks themselves live in ./receipt-verification so they can be tested
 * without a browser.
 */
export function ReceiptVerificationClient({ receiptId, receiptHash }: { receiptId: string; receiptHash: string }) {
  const { t } = useI18n();
  const [gates, setGates] = useState<GateState[]>(initialGates);
  const [verdict, setVerdict] = useState<ReceiptVerdict | null>(null);
  const [bundleHash, setBundleHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const failBeforeChecks = (reason?: string) => {
    setGates(initialGates().map((gate) => gate.id === "bundle" ? { ...gate, status: "failed", error: reason } : gate));
    setVerdict("failed");
  };

  const detailFor = (id: ReceiptGateId, result: ReceiptVerificationResult): string => {
    switch (id) {
      case "bundle":
        return t("receiptVerify.gate.bundleDetail", { receipts: result.receipts, keys: result.issuerKeys });
      case "identity":
        return t("receiptVerify.gate.identityDetail");
      case "hash":
        return result.receiptHash ? shortHash(result.receiptHash) : t("receiptVerify.gate.hashIdle");
      case "signature":
        return t("receiptVerify.gate.signatureDetail");
      case "policy":
        return t("receiptVerify.gate.policyDetail");
      case "closure":
        return t("receiptVerify.gate.closureDetail");
      case "keys":
        return result.retiredIssuerKeys > 0
          ? t("receiptVerify.gate.keysRetired")
          : t("receiptVerify.gate.keysDetail");
    }
  };

  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setVerdict(null);
    setError(null);
    setBundleHash(null);
    setGates(initialGates().map((gate) => gate.id === "bundle" ? { ...gate, status: "running" as const } : gate));

    try {
      // The keyset answers a freshness question, so it is fetched beside the
      // bundle rather than after it.
      const keysetPromise = fetch("/api/receipts/issuer-keys", {
        cache: "no-store",
        headers: { accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);

      let response: Response;
      try {
        response = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}/verification-bundle`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
      } catch {
        failBeforeChecks();
        setError(t("receiptVerify.error.network"));
        return;
      }
      if (response.status === 404) {
        failBeforeChecks();
        setError(t("receiptVerify.error.notFound"));
        return;
      }
      if (!response.ok) {
        failBeforeChecks(`HTTP ${response.status}`);
        setError(t("receiptVerify.error.network"));
        return;
      }
      const bundle = await response.json().catch(() => null);
      if (!bundle) {
        failBeforeChecks();
        setError(t("receiptVerify.error.network"));
        return;
      }

      const progress = initialGates();
      const applyGate = (gate: ReceiptGateResult) => {
        const index = gateOrder.indexOf(gate.id);
        if (index < 0) return;
        progress[index] = { id: gate.id, status: gate.status, error: gate.error };
        const next = progress[index + 1];
        if (next && next.status === "idle") progress[index + 1] = { ...next, status: "running" };
        setGates([...progress]);
      };

      const result = await verifyReceiptBundle({
        receiptId,
        receiptHash,
        bundle,
        currentKeyset: await keysetPromise,
        onGate: applyGate,
      });

      setGates(gateOrder.map((id) => {
        const gate = result.gates.find((candidate) => candidate.id === id);
        if (!gate) return { id, status: "idle" as const };
        return {
          id,
          status: gate.status,
          error: gate.error,
          // A failed or unavailable gate falls back to its neutral description;
          // the passed wording would contradict the failure beside it.
          detail: gate.status === "passed" ? detailFor(id, result) : undefined,
        };
      }));
      setBundleHash(result.bundleHash);
      setVerdict(result.verdict);
    } catch (cause) {
      failBeforeChecks(cause instanceof Error ? cause.message : undefined);
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
