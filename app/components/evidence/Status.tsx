import { Badge } from "../ui";
import { type ReactNode } from "react";
import { type CatalogDisplayStatus } from "@/packages/domain/catalog";

export type ProductStateTone = "available" | "provisional" | "verified" | "not-deployed";

export function ProductStateBadge({ tone, children }: { tone: ProductStateTone; children: ReactNode }) {
  return <Badge tone={tone === "verified" || tone === "available" ? "positive" : tone === "provisional" ? "warning" : "neutral"} className={`product-state product-state-${tone}`}>{children}</Badge>;
}

const stateClass: Record<CatalogDisplayStatus, string> = {
  "Formalized statement": "state-formalized",
  "Open proof branch": "state-open",
  "Kernel accepted": "state-kernel",
  "Statement fidelity reviewed": "state-review",
  "Independent review": "state-review",
  "No Proofweave attestation": "state-unverified",
};

export function StatusStack({ statuses, compact = false }: { statuses: readonly CatalogDisplayStatus[]; compact?: boolean }) {
  return <div className={compact ? "status-stack compact" : "status-stack"} aria-label="Verification states">{statuses.map((status) => <Badge className={stateClass[status]} key={status}><i aria-hidden="true" />{status}</Badge>)}</div>;
}
