export function searchPublicationFamilies(collection, { q = "", subject = "", evidence = "all", reading = "all", page = "1" } = {}) {
  const query = String(q).trim().slice(0, 240);
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const selectedSubject = collection.subjects.some((entry) => entry.name === subject) ? subject : "";
  const selectedEvidence = ["scope", "no-scope", "all"].includes(evidence) ? evidence : "all";
  const selectedReading = reading === "guided" ? "guided" : "all";
  const families = collection.families.filter((family) => {
    if (selectedReading === "guided" && !family.readingGuide) return false;
    if (selectedSubject && family.subject !== selectedSubject) return false;
    if (selectedEvidence === "scope" && !family.scope) return false;
    if (selectedEvidence === "no-scope" && family.scope) return false;
    const haystack = normalize([family.number, family.title, family.subject, family.claim,
      family.readingGuide?.titleZh ?? "", family.readingGuide?.summaryZh ?? "",
      ...family.manuscripts.flatMap((paper) => [paper.title, paper.abstract, ...paper.authors])].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(families.length / pageSize));
  const requested = /^\d+$/.test(String(page)) ? Number(page) : 1;
  const currentPage = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requested) ? requested : 1));
  return { query, subject: selectedSubject, evidence: selectedEvidence, reading: selectedReading, total: families.length,
    manuscriptCount: families.reduce((count, family) => count + family.manuscripts.length, 0),
    page: currentPage, pageCount, pageSize, families: families.slice((currentPage - 1) * pageSize, currentPage * pageSize) };
}

export function publicationBrowseHref({ query = "", subject = "", evidence = "all", reading = "all", page = 1 } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (subject) params.set("subject", subject);
  if (evidence !== "all") params.set("evidence", evidence);
  if (reading === "guided") params.set("reading", reading);
  if (page > 1) params.set("page", String(page));
  return `/publications${params.size ? `?${params}` : ""}`;
}

function normalize(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}
