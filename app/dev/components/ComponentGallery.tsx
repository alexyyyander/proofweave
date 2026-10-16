"use client";

import { useState } from "react";
import Link from "next/link";
import type { CatalogProblemSummary } from "@/packages/domain/catalog";
import { CardTitle, PageIntro, SectionTitle, Button, Input, Select, Textarea, ActionLink, Surface, SectionHeading, EmptyState, FieldList, Field, CodeBlock, PaperSurface, Badge } from "@/app/components/ui";
import { ScrollArea } from "@/app/components/ui/ScrollArea";
import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageSectionNav } from "@/app/components/navigation/PageSectionNav";
import { StepNavigation } from "@/app/components/navigation/StepNavigation";
import { ProductStateBadge, StatusStack } from "@/app/components/evidence/Status";
import { ResearchCard } from "@/app/components/research/ResearchCard";

export function ComponentGallery({ project }: { project?: CatalogProblemSummary }) {
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState(3);
  const [message, setMessage] = useState("");
  const steps = ["Inspect", "Compare", "Decide"].map((label, index) => ({ id: label, label, accessibleLabel: label + " specimen", number: String(index + 1).padStart(2, "0") }));
  return <>
    <Breadcrumb><Link href="/">Overview</Link><span aria-hidden="true"> / </span><span>Component workshop</span></Breadcrumb>
    <PageIntro label="Development only" title="Shared components, in one place." description="Interactive specimens for visual and keyboard checks. Controls here change only this preview; they do not submit research or grant access." />
    <PageSectionNav links={[{ href: "#controls", label: "Controls" }, { href: "#surfaces", label: "Surfaces" }, { href: "#evidence", label: "Evidence" }, { href: "#paper", label: "Paper" }, { href: "#navigation", label: "Navigation" }, { href: "#research", label: "Research" }]} />
    <section id="controls"><SectionHeading><SectionTitle>Controls and states</SectionTitle></SectionHeading>
      <div className="gallery-actions"><Button type="button" variant="primary" onClick={() => setMessage("Primary action selected")}>Primary action</Button><Button type="button" variant="secondary">Secondary action</Button><Button type="button" variant="quiet">Quiet action</Button><Button type="button" variant="primary" busy>Working…</Button><Button type="button" variant="secondary" disabled>Unavailable</Button><ActionLink variant="secondary" href="#paper">Open paper specimen</ActionLink></div>
      <form className="gallery-form" onSubmit={(event) => { event.preventDefault(); setMessage("Preview form validated"); }}>
        <label>Target<Input name="target" placeholder="A pinned declaration" required /></label>
        <label>Scope<Select name="scope"><option>Formalize</option><option>Prove</option></Select></label>
        <label>Notes<Textarea name="notes" placeholder="Optional notes" /></label>
        <Button variant="primary" type="submit">Validate preview form</Button>
      </form>
      <p role="status">{message}</p>
    </section>
    <section id="surfaces"><SectionHeading><SectionTitle>Surfaces and empty states</SectionTitle></SectionHeading>
      <div className="gallery-grid"><Surface as="article" tone="card"><CardTitle>Reading card</CardTitle><p>A restrained surface. Focus and hover belong to the action.</p><ActionLink href="#evidence">Inspect details →</ActionLink></Surface><Surface tone="inset"><CardTitle>Supporting detail</CardTitle><p>Inset content stays visually secondary.</p></Surface><EmptyState><CardTitle>No records yet</CardTitle><p>Explain the state and offer one useful next step.</p><ActionLink variant="secondary" href="#research">Explore a target</ActionLink></EmptyState></div>
    </section>
    <section id="evidence"><SectionHeading><SectionTitle>Evidence and status</SectionTitle></SectionHeading>
      <div className="gallery-actions"><ProductStateBadge tone="available">Available</ProductStateBadge><ProductStateBadge tone="provisional">Provisional</ProductStateBadge><ProductStateBadge tone="verified">Verified specimen</ProductStateBadge><ProductStateBadge tone="not-deployed">Not deployed</ProductStateBadge><Badge tone="negative">Failed specimen</Badge></div>
      <StatusStack statuses={["Formalized statement", "Open proof branch", "No Proofweave attestation"]} />
      <FieldList><Field label="Owner"><code>person:specimen</code></Field><Field label="Fingerprint"><code>{"abcdef0123456789".repeat(4)}</code></Field><Field label="Boundary">Specimen only; no verification claim.</Field></FieldList>
      <CodeBlock aria-label="Code specimen"><code>{"theorem example : True := True.intro"}</code></CodeBlock>
    </section>
    <section id="paper" className="gallery-paper"><SectionHeading><SectionTitle>Paper as a reusable surface</SectionTitle></SectionHeading>
      <PaperSurface heading="Research note" meta="Specimen · 01 / 01" footer={<><span>Component specimen</span><code>not a signed record</code></>}>
        <CardTitle>Readable content, physical texture.</CardTitle><p>This surface accepts headings, prose, fields and code. It has no dependency on the demo or its verification data.</p><FieldList><Field label="Material">Fine grain, restrained page depth</Field><Field label="Content">Selectable HTML text</Field></FieldList>
      </PaperSurface>
    </section>
    <section id="navigation"><SectionHeading><SectionTitle>Navigation and growing lists</SectionTitle></SectionHeading>
      <StepNavigation label="Specimen steps" items={steps} activeIndex={step} onSelect={setStep} />
      <p role="status">Selected: {steps[step].label}</p>
      <Button type="button" variant="secondary" onClick={() => setRows((value) => value + 5)}>Add preview rows</Button>
      <ScrollArea maxHeight={160} aria-label="Growing preview list"><ul>{Array.from({ length: rows }, (_, index) => <li key={index}>Preview record {index + 1}</li>)}</ul></ScrollArea>
    </section>
    {project && <section id="research"><SectionHeading><SectionTitle>One research record, two compositions</SectionTitle></SectionHeading><div className="gallery-grid"><ResearchCard project={project} variant="summary" /><ResearchCard project={project} /></div></section>}
  </>;
}
