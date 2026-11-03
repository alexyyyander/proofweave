/**
 * Paths that must never be rewritten or redirected for a locale: API and auth
 * endpoints, runner/token machinery, internal build assets, dot segments, and
 * static files. The middleware matcher and its per-request check both derive
 * from this list so they cannot drift apart.
 */
export const nonPageSegments = [
  "api",
  "auth",
  "authorize",
  "callback",
  "mcp",
  "signin-with-chatgpt",
  "signout-with-chatgpt",
  "start",
  "token",
  "_next",
] as const;

export const assetExtensions = [
  "avif",
  "bin",
  "css",
  "csv",
  "gif",
  "gz",
  "htm",
  "html",
  "ico",
  "jpe?g",
  "js",
  "json",
  "map",
  "md",
  "mjs",
  "mp3",
  "mp4",
  "otf",
  "pdf",
  "png",
  "svg",
  "ttf",
  "txt",
  "wasm",
  "wav",
  "webm",
  "webmanifest",
  "webp",
  "woff2?",
  "xml",
  "zip",
] as const;

const assetPathPattern = new RegExp(`\\.(?:${assetExtensions.join("|")})$`, "i");

export function isNonPagePath(pathname: string): boolean {
  if (assetPathPattern.test(pathname)) return true;
  if (pathname.split("/").some((segment) => segment.startsWith(".") && segment.length > 0)) return true;
  return nonPageSegments.some((segment) => pathname === `/${segment}` || pathname.startsWith(`/${segment}/`));
}

const matcherExclusion = [
  `(?:${nonPageSegments.join("|")})(?:/|$)`,
  String.raw`\.[^/]*`,
  String.raw`.*\/\.[^/]*`,
  String.raw`.*\.(?:${assetExtensions.join("|")})$`,
].join("|");

export const middlewareMatcher = `/((?!${matcherExclusion}).*)`;
