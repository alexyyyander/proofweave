import katex from "katex";

const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Upstream prose may contain TeX and basic semantic tags. All other HTML is text.
export function renderPublicationText(value) {
  const input = String(value);
  const tokens = /\$`([\s\S]*?)`\$|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$|<\/?(?:i|sup|sub)>/g;
  let result = "";
  let end = 0;
  for (const match of input.matchAll(tokens)) {
    result += escapeHtml(input.slice(end, match.index));
    if (match[0].startsWith("<")) {
      result += match[0].replace(/i/g, "em");
    } else {
      const tex = match[1] ?? match[2] ?? match[3];
      result += tex.length > 4000 ? escapeHtml(match[0]) : katex.renderToString(tex, {
        throwOnError: false, trust: false, strict: "ignore", maxExpand: 1000, maxSize: 5,
        displayMode: Boolean(match[2]), macros: {}, output: "htmlAndMathml",
      });
    }
    end = match.index + match[0].length;
  }
  return result + escapeHtml(input.slice(end));
}
