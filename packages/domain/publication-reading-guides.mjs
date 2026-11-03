/** Attach version-bound editorial notes without changing upstream evidence. */
export function withPublicationReadingGuides(collection, snapshot) {
  if (snapshot.schemaVersion !== "pw-publication-reading-guides-v1" || snapshot.upstreamRevision !== collection.source.revision) {
    throw new Error("Reading guides must match the pinned publication revision.");
  }
  const byNumber = new Map();
  const manuscriptIds = new Set();
  for (const guide of snapshot.guides) {
    const family = collection.families.find((item) => item.number === guide.familyNumber);
    if (!family || byNumber.has(guide.familyNumber)) throw new Error("Reading guide family is missing or repeated.");
    if (guide.editorialStatus !== "ai_assisted_source_reading" || guide.readingLevel !== "introduction_and_main_statements") {
      throw new Error("Reading guides are source reading, not proof review or replay.");
    }
    if (!guide.manuscriptIds.length || new Set(guide.manuscriptIds).size !== guide.manuscriptIds.length ||
        guide.manuscriptIds.some((id) => !family.manuscripts.some((paper) => paper.id === id))) {
      throw new Error("Reading guide manuscript does not belong to its family.");
    }
    const required = ["title", "summary", "question", "paperClaim", "whyItMatters", "scopeNotes", "boundary", "limitations", "comparatorNote"];
    if (required.some((key) => typeof guide[key] !== "string" || !guide[key].trim()) ||
        !guide.proofRoute.length || !guide.sources.length) throw new Error("Reading guide is incomplete.");
    const roles = new Set();
    for (const source of guide.sources) {
      const [start, end] = source.readLines;
      const prefix = `https://github.com/openai/math/blob/${snapshot.upstreamRevision}/`;
      if (!/^[a-f0-9]{64}$/.test(source.sha256) || !/^[A-Za-z0-9_./+-]+$/.test(source.path) ||
          source.path.split("/").some((part) => part === ".." || !part) ||
          !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start ||
          source.url !== `${prefix}${source.path}#L${start}-L${end}`) {
        throw new Error("Reading source must bind a safe pinned path, hash, and line range.");
      }
      roles.add(source.role);
    }
    if (["paper_introduction", "scope_document", "comparator_statement", "comparator_configuration", "solution_entry"].some((role) => !roles.has(role))) {
      throw new Error("Reading guide needs paper, scope, declaration, configuration, and solution references.");
    }
    guide.manuscriptIds.forEach((id) => manuscriptIds.add(id));
    byNumber.set(guide.familyNumber, guide);
  }
  return {
    ...collection,
    readingGuides: {
      schemaVersion: snapshot.schemaVersion, language: snapshot.language,
      preparedAt: snapshot.preparedAt, attribution: snapshot.attribution,
    },
    statistics: { ...collection.statistics, readingGuideFamilies: byNumber.size, guidedManuscripts: manuscriptIds.size },
    families: collection.families.map((family) => ({ ...family, readingGuide: byNumber.get(family.number) ?? null })),
  };
}
