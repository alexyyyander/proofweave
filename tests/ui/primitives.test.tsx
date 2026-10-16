import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, FieldList, Field, Input, Surface, CodeBlock } from "../../app/components/ui/primitives";
import { PaperSurface } from "../../app/components/ui/PaperSurface";
import { Breadcrumb } from "../../app/components/navigation/Breadcrumb";
import { StepNavigation } from "../../app/components/navigation/StepNavigation";
import { ProductStateBadge, StatusStack } from "../../app/components/evidence/Status";

test("controls preserve native form semantics, labels, and disabled busy states", () => {
  const html = renderToStaticMarkup(<form><Button type="submit" name="intent" value="save" busy>Save</Button><Input name="target" required aria-invalid="true" aria-describedby="target-error" defaultValue="A & B" /></form>);
  assert.match(html, /type="submit"/);
  assert.match(html, /name="intent"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-describedby="target-error"/);
  assert.match(html, /value="A &amp; B"/);
});

test("surface variants keep the requested semantic element and evidence text", () => {
  const html = renderToStaticMarkup(<Surface as="article" tone="card" aria-label="Evidence"><FieldList><Field label="Owner"><code>person:one</code></Field></FieldList></Surface>);
  assert.match(html, /^<article/);
  assert.match(html, /<dt>Owner<\/dt><dd><code>person:one<\/code><\/dd>/);
  assert.match(html, /aria-label="Evidence"/);
});

test("paper renders arbitrary content without a demo record and can disable stacking", () => {
  const html = renderToStaticMarkup(<PaperSurface heading="A research note" stacked={false} meta="01" footer="Pinned"><CodeBlock>{"<script>not executable</script>"}</CodeBlock></PaperSurface>);
  assert.match(html, /ui-paper-single/);
  assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /Demo|Kernel accepted/);
});

test("status primitives never infer verification from an available product state", () => {
  const html = renderToStaticMarkup(<><ProductStateBadge tone="available">Agent connected</ProductStateBadge><StatusStack statuses={["No Proofweave attestation"]} /></>);
  assert.match(html, /No Proofweave attestation/);
  assert.doesNotMatch(html, /Kernel accepted|Evidence passed/);
});

test("step navigation works with arbitrary step counts and labels", () => {
  const html = renderToStaticMarkup(<StepNavigation label="Review steps" activeIndex={1} onSelect={() => {}} items={[{ id: "read", label: "Read", accessibleLabel: "Read evidence" }, { id: "decide", label: "Decide", accessibleLabel: "Record decision" }]} />);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Record decision"/);
});

test("breadcrumbs expose the navigation landmark and current location", () => {
  const html = renderToStaticMarkup(<Breadcrumb><a href="#research">Research</a><span>/</span><span>Target</span></Breadcrumb>);
  assert.match(html, /^<nav/);
  assert.match(html, /aria-label="Breadcrumb"/);
  assert.match(html, /<span aria-current="page">Target<\/span>/);
});

test("page intro keeps one labelled heading and puts the next action before supporting metadata", async () => {
  const { PageIntro } = await import("../../app/components/ui/PageIntro");
  const html = renderToStaticMarkup(<PageIntro label="Research" title="Choose a target" description="Start with one exact statement." titleId="research-title" actions={<a href="#targets">Browse targets</a>} meta="12 targets" aside={<strong>Supporting evidence</strong>} />);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /aria-labelledby="research-title"/);
  assert.match(html, /<h1\b[^>]*id="research-title"[^>]*>/);
  assert.match(html, /<h1\b[^>]*class="ui-page-title page-intro__title"/);
  assert.ok(html.indexOf("Choose a target") < html.indexOf("Start with one exact statement."));
  assert.ok(html.indexOf("Browse targets") < html.indexOf("12 targets"));
  assert.ok(html.indexOf("12 targets") < html.indexOf("Supporting evidence"));
});
