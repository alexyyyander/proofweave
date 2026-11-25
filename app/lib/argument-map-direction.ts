/** Direction glyph for argument-map relationships; undirected links never imply a `from` → `to` claim. */
export function edgeDirectionGlyph(edge: { directed?: boolean }, reverse = false) {
  if (edge.directed === false) return "↔";
  return reverse ? "←" : "→";
}
