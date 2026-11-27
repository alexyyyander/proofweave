import type { Instrumentation } from "next";

// Both pinned vinext runtimes use reverse DJB2 over message + stack. SSR can
// report an Error before attaching its digest, or leave the Error unmodified.
function renderDigest(error: Error): string {
  const input = error.message + (error.stack || "");
  let hash = 5381;
  for (let index = input.length - 1; index >= 0; index--) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return String(hash >>> 0);
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  if (context.routeType !== "render" || !/^\/(?:zh-CN\/)?profile\/?$/.test(request.path.split("?")[0])) return;
  if (!(error instanceof Error)) return;
  const digest = ("digest" in error ? error.digest : undefined) ?? renderDigest(error);
  if (typeof digest === "string" && /^\d{1,12}$/.test(digest)) {
    console.error("profile_render_failed", { digest, source: context.renderSource ?? "unspecified" });
  }
};
