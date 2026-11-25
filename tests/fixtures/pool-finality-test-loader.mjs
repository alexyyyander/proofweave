// Test process only: substitute one ephemeral synthetic authority into the
// otherwise empty compiled registry. This loader is never used by the app or
// operator command and must not be used against a real database.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith("/packages/protocol/pool-finality-adjudication.mjs")) return result;
  const authority = JSON.parse(process.env.PROOFWEAVE_TEST_FINALITY_AUTHORITY ?? "null");
  if (!authority || authority.projectId !== "project:receipt" || authority.personId !== "person:carol" || authority.keyId !== "person-key:carol" || !/^sha256:[0-9a-f]{64}$/.test(authority.keyFingerprint)) throw new Error("Synthetic finality authority is invalid.");
  const marker = "  // { projectId, personId, keyId, keyFingerprint } entries require a separate";
  const source = String(result.source);
  if (!source.includes(marker)) throw new Error("Finality trust registry marker is missing.");
  return { ...result, source: source.replace(marker, `  ${JSON.stringify(authority)},\n${marker}`) };
}
