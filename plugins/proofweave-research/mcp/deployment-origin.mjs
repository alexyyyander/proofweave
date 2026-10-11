export const productionOrigin = "https://proofweave.org";
export const legacyProductionOrigin = "https://proofweave-research.yualex031821.chatgpt.site";

// Only this exact, operator-owned hostname move retains the Agent identity.
// Other deployments still require a new key; tokens never cross audiences.
export function isProductionDomainMigration(previousOrigin, nextOrigin) {
  return previousOrigin === legacyProductionOrigin && nextOrigin === productionOrigin;
}
