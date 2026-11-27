import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (context.routeType !== "render" || !/^\/(?:zh-CN\/)?profile\/?$/.test(request.path.split("?")[0])) return;
  // vinext assigns the digest immediately after invoking this hook.
  await Promise.resolve();
  const digest = error instanceof Error && "digest" in error ? error.digest : undefined;
  if (typeof digest === "string" && /^\d{1,12}$/.test(digest)) {
    console.error("profile_render_failed", { digest, source: context.renderSource });
  }
};
