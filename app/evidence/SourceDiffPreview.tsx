"use client";

import { useState } from "react";

const maximumPreviewBytes = 1_000_000;

type PreviewState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready"; text: string }>
  | Readonly<{ kind: "unavailable"; message: string }>;

/**
 * The private evidence route remains the sole byte-access boundary. This
 * component merely renders a bounded, escaped text preview after that route
 * has authenticated the browser session and returned a source patch.
 */
export function SourceDiffPreview({ href }: { href: string }) {
  const [state, setState] = useState<PreviewState>({ kind: "idle" });

  const showPreview = async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(href, { headers: { accept: "text/plain" } });
      if (!response.ok) throw new Error("The source diff is unavailable.");
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isSafeInteger(declaredLength) && declaredLength > maximumPreviewBytes) {
        throw new Error("This source diff is larger than the 1 MiB in-page preview limit. Download it to inspect the full immutable artifact.");
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maximumPreviewBytes) {
        throw new Error("This source diff is larger than the 1 MiB in-page preview limit. Download it to inspect the full immutable artifact.");
      }
      setState({ kind: "ready", text });
    } catch (cause) {
      setState({ kind: "unavailable", message: cause instanceof Error ? cause.message : "The source diff is unavailable." });
    }
  };

  if (state.kind === "ready") {
    return <details className="evidence-result" open><summary>Normalized source diff</summary><pre><code>{state.text}</code></pre></details>;
  }
  return <div className="evidence-preview-action"><button className="quiet-action" type="button" onClick={showPreview} disabled={state.kind === "loading"}>{state.kind === "loading" ? "Loading diff…" : "Preview source diff"}</button>{state.kind === "unavailable" && <p role="status">{state.message}</p>}</div>;
}
