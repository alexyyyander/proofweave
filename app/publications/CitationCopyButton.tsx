"use client";
import { Button } from "@/app/components/ui";

import { useState } from "react";

export function CitationCopyButton({ citation }: { citation: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(citation); setStatus("Copied"); }
    catch { setStatus("Select and copy the citation below."); }
  }
  return <span className="publication-copy-action"><Button type="button" onClick={copy}>Copy BibTeX</Button><span role="status">{status}</span></span>;
}
