/**
 * The OAuth vocabulary for the remote Proofweave MCP resource. Keeping this
 * list outside either Worker avoids a resource-server/authorization-server
 * import cycle and makes discovery, issuance, and enforcement share one
 * protocol surface.
 */
export const remoteMcpScopes = Object.freeze([
  "catalog:read",
  "attempt:create",
  "attempt:read",
  "progress:write",
  "artifact:write",
  "run:request",
  "run:read",
  "run:cancel",
  "verification:replay",
  "verification:write",
]);
