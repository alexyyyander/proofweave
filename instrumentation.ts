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
    // An Error message can itself contain line breaks and fake stack frames.
    // Only keep bounded coordinates from known production entrypoint names.
    const header = `${error.name}: ${error.message}\n`;
    const frames = error.stack?.startsWith(header) ? error.stack.slice(header.length) : "";
    const frame = frames.match(/^\s+at [^\n]*[(/\s]((?:index|worker)\.js:\d{1,6}:\d{1,6})\)?$/m)?.[1];
    const kind = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : "Error";
    console.error("profile_render_failed", { digest, source: context.renderSource ?? "unspecified", kind, frame });
  }
};
