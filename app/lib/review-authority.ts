import type { DelegationProfile } from "@/db/repositories/delegation";

export function hasActiveReviewDelegation(profile: DelegationProfile | null, now = Date.now()) {
  return Boolean(profile?.delegations.some((delegation) =>
    delegation.revokedAt === null &&
    delegation.scopes.includes("review") &&
    Date.parse(delegation.validFrom) <= now &&
    now < Date.parse(delegation.validUntil),
  ));
}
