/**
 * @param {{ targetSlug?: string | null, returnHref: string }} input
 */
export function integrationRefreshHref({
  targetSlug = null,
  returnHref,
}) {
  const query = new URLSearchParams();
  if (targetSlug) query.set("target", targetSlug);
  query.set("return_to", returnHref);
  return `/integrations?${query.toString()}#codex-beta`;
}
