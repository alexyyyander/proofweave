"use client";
import { Button } from "@/app/components/ui";

import { useState } from "react";
import { useI18n } from "@/app/i18n/client";

export function CitationCopyButton({ citation }: { citation: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(citation); setStatus(t("publicationDetail.copy.copied")); }
    catch { setStatus(t("publicationDetail.copy.manual")); }
  }
  return <span className="publication-copy-action"><Button type="button" onClick={copy}>{t("publicationDetail.copy.action")}</Button><span role="status">{status}</span></span>;
}
