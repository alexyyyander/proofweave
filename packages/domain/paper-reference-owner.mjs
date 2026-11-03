// Only explicit proof headings bind references to a statement. A preceding
// statement is not sufficient evidence: papers routinely delay proofs.
export function explicitProofOwner(text) {
  const heading = String(text).match(/^\s*\[([^\]]*)\]/)?.[1];
  if (!heading) return null;
  const match = heading.match(/^\s*(?:(?:completion|continuation)\s+of\s+(?:the\s+)?)?proof\s+of\s+(?:(?:the\s+)?(?:theorem|lemma|proposition|corollary)\s*)?~?\s*\\(?:c|C|auto)?ref\{([^}]+)\}\s*[.]?\s*$/i);
  return match?.[1] ?? null;
}
