"use client";

import { Button, CodeBlock } from "@/app/components/ui";

import { useState } from "react";
import { useI18n } from "@/app/i18n/client";

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
  const { t } = useI18n();
  const [state, setState] = useState<PreviewState>({ kind: "idle" });

  const showPreview = async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(href, { headers: { accept: "text/plain" } });
      if (!response.ok) throw new Error(t("sourceDiff.unavailable"));
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isSafeInteger(declaredLength) && declaredLength > maximumPreviewBytes) {
        throw new Error(t("sourceDiff.tooLarge"));
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maximumPreviewBytes) {
        throw new Error(t("sourceDiff.tooLarge"));
      }
      setState({ kind: "ready", text });
    } catch (cause) {
      setState({ kind: "unavailable", message: cause instanceof Error ? cause.message : t("sourceDiff.unavailable") });
    }
  };

  if (state.kind === "ready") {
    return <details className="evidence-result" open><summary>{t("sourceDiff.title")}</summary><CodeBlock><code>{state.text}</code></CodeBlock></details>;
  }
  return <div className="evidence-preview-action"><Button className="quiet-action" type="button" onClick={showPreview} disabled={state.kind === "loading"}>{state.kind === "loading" ? t("sourceDiff.loading") : t("sourceDiff.preview")}</Button>{state.kind === "unavailable" && <p role="status">{state.message}</p>}</div>;
}
