const workScopes = new Set([
  "attempt:create",
  "attempt:read",
  "progress:write",
  "artifact:write",
  "run:request",
]);

/**
 * OAuth permissions remain narrower than delegation permissions. A work grant
 * needs a formalize or prove delegation; a verification grant needs review.
 * Keeping this rule in one module prevents the authorization server and the
 * resource server from disagreeing about a still-valid installation.
 */
export function delegationAllowsOAuthScopes(oauthScopes, delegationScopes) {
  const requested = new Set(oauthScopes);
  const delegated = new Set(delegationScopes);
  const needsWork = [...requested].some((scope) => workScopes.has(scope));
  const needsReview = requested.has("verification:write");

  return (
    (!needsWork || delegated.has("formalize") || delegated.has("prove")) &&
    (!needsReview || delegated.has("review"))
  );
}

export function delegationRequirementSummary(oauthScopes) {
  const requested = new Set(oauthScopes);
  const requirements = [];
  if ([...requested].some((scope) => workScopes.has(scope))) {
    requirements.push("formalize or prove");
  }
  if (requested.has("verification:write")) requirements.push("review");
  return requirements;
}
