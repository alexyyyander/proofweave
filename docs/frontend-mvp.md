# Proofweave frontend MVP

## Product posture

Proofweave should feel like a public research observatory and proof laboratory,
not a crypto exchange or an Agent chat room. The primary objects are mathematical
claims and evidence. People and their delegated Agents are visible through the
work they contributed.

The UI should answer four questions quickly:

1. What mathematical goal is being pursued?
2. What verified progress exists?
3. What evidence supports each status?
4. Which people, through which delegated Agents, contributed to it?

The public entry experience has one additional job: explain in under ten
seconds why an individual would want to participate in mathematics through a
delegated Agent.

## Entry model

Proofweave has separate public and authenticated entry surfaces:

```text
Unauthenticated /       Public welcome
Unauthenticated /explore Public conjecture catalog
Authenticated /home     Personal research home
Authenticated /workbench Agent supervision and submission
```

Do not force registration before a visitor can inspect conjectures, Lean
statements, verification evidence, contribution receipts, or public profiles.

## Navigation

Public navigation:

```text
Explore Mathematics
How It Works
Contributions
About

Search                                      Sign In | Delegate Your Agent
```

Authenticated navigation:

```text
Explore
Projects
Verify
Workbench
People

Search                                        Account / delegated Agent status
```

Avoid a global leaderboard in the first release. It would turn provisional
metrics into a game before the contribution rules have survived adversarial use.

## MVP page hierarchy

The product is organized around the user’s research path rather than a generic
dashboard. The four primary surfaces are:

1. `/` — understand the participation model and enter without an account.
2. `/explore` and `/explore/[slug]` — choose a problem, then inspect its
   statement, dependencies, and evidence.
3. `/workbench` — supervise one delegated Agent and take the next bounded
   research action.
4. `/receipt/[id]` — inspect durable, public attribution once a contribution
   actually exists.

`/how-it-works` is supporting protocol education, not a competing primary
destination. The verification queue is the next major authenticated page after
the workbench; it should be implemented before profiles, rankings, or social
features.

## Page 0: Public welcome

The information architecture should follow the successful citizen-science
pattern used by Zooniverse: mission first, real projects second, participation
model third, and institutional trust before the final call to action.

Reference: https://www.zooniverse.org/

The page is not a generic SaaS landing page. It introduces a new form of
participation in research.

### Hero

Recommended primary message:

```text
Advance mathematics through your agent.

Proofweave is an open network where personally delegated research agents
formalize conjectures, prove lemmas, find counterexamples, and verify one
another's work. Every accepted step remains reproducible and credited to the
person behind the Agent.
```

Primary actions:

```text
Explore open mathematics
Delegate your Agent
```

The hero visual should show the attribution chain, not an abstract globe or a
chat transcript:

```text
Person
  → delegated Agent
      → signed mathematical contribution
          → Lean and independent verification
              → contribution receipt credited to Person
```

### Public research preview

Immediately below the hero, show three to six real, currently available goals
from a pinned data snapshot. Each card includes:

- informal title and mathematical domain;
- source and formal statement revision;
- exact status layers rather than a generic `verified` badge;
- open subgoal or accepted-contribution counts where available;
- a direct link to inspect the complete public conjecture page.

Never invent activity, contributor counts, solved-problem counts, institutional
partners, or live-network statistics for visual effect.

### Participation model

Explain that useful progress is broader than final proof authorship:

```text
Formalize a statement
Discover a reusable lemma
Find a counterexample
Verify independent work
Synthesize proof branches
```

Each example should link to an actual or schema-valid public contribution
receipt once those records exist.

### Trust explanation

Use a short evidence sequence:

```text
Signed by delegated Agent
→ reproducible Lean bundle
→ kernel checked
→ independently reviewed
→ permanently attributable
```

Avoid claiming that Lean alone proves the informal statement is faithful or the
result is novel.

### Final call to action

End with two equal paths:

```text
Explore without an account
Create a person profile and delegate an Agent
```

The public welcome page must remain valuable to mathematicians who never intend
to run an Agent themselves.

## Page 1: Explore

Explore is a searchable public research catalog. It is the main destination
from the welcome page, but it is not the root landing page.

Each conjecture card shows:

- informal title and mathematical domain;
- lifecycle status: proposed, formalized, active, kernel-checked, attested;
- target project and pinned Lean environment;
- accepted lemmas, open subgoals, active owners, and last verified activity;
- source paper or canonical problem link;
- a small dependency/progress sparkline.

Primary filters:

```text
Domain | Status | Contribution type | Project | Formalization confidence
```

Keep benchmark/tutorial problems under a separate “Practice” scope.

## Page 2: Conjecture detail

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Title · domain · source · revision                         Follow / Join │
│ Formalized ✓  Kernel checked —  Statement attested —                    │
├───────────────────────┬──────────────────────────────┬───────────────────┤
│ Informal / Lean       │ Dependency and branch graph  │ Active work       │
│ statement             │                              │ Agent + owner     │
│ assumptions           │ selected node details        │ signed events     │
│ source correspondence │ accepted/open/blocked nodes  │ latest receipts   │
├───────────────────────┴──────────────────────────────┴───────────────────┤
│ Contributions | Attempts | Verifications | History | Files              │
└──────────────────────────────────────────────────────────────────────────┘
```

Important interaction: selecting a graph node opens the exact Lean declaration,
its dependencies, accepted artifacts, owner attribution, and verification chain.

Status must be expressed as text plus icon, not color alone.

## Page 3: Workbench

The workbench is for a person supervising a delegated Agent.

```text
┌────────────────────┬─────────────────────────────┬───────────────────────┐
│ Goal / context     │ Lean source and proof state │ Agent run / artifacts │
│ accepted premises │ compiler diagnostics        │ budget and controls   │
│ search results    │ branch diff                 │ submit signed attempt │
└────────────────────┴─────────────────────────────┴───────────────────────┘
```

Required controls:

- choose an active delegation certificate;
- display scope and expiry before the Agent runs;
- pin problem, Lean, Mathlib, and dependency revisions;
- inspect proposed source changes before submission;
- show axiom usage and `sorry` status;
- submit an artifact bundle, not a chat transcript;
- pause or revoke the delegated Agent.

Do not expose private chain-of-thought. Store and display structured events,
tool calls, artifacts, rationales written for publication, and verification
results.

The first frontend implementation may use an explicitly labeled local preview
workspace while identity, run execution, and submission APIs are being built.
It must never imply that an event was signed, checked, or sent to the network
when it has only been simulated in the browser.

## Page 4: Verification queue

Verifiers need an evidence-oriented inbox:

- randomly assigned bundles where owner independence is satisfied;
- reproducibility result and environment digest;
- source diff and declaration diff;
- allowed versus observed axioms;
- statement revision and expected target;
- previous attestations hidden until the verifier submits when appropriate;
- actions: reproduce, kernel-attest, flag, request changes.

Separate these attestations in the UI:

```text
Build reproducible
Kernel accepted
Statement faithful
Novelty reviewed
Project useful
```

No generic green “Verified” badge should collapse them.

## Page 5: Person and delegated Agents

The person is the profile root. Agents appear as revocable delegates, never as
independent human-like accounts.

Profile header:

- display name, persistent Proofweave ID, optional ORCID;
- active and historical Agent delegations;
- key rotation and revocation history;
- contribution dimensions, without one total score.

Contribution view:

```text
Formalization  Lemma  Counterexample  Verification  Synthesis  Infrastructure
```

Below it, show a filterable receipt timeline and a downstream-impact graph.
Each item links to immutable evidence. Compute and funding appear in distinct
sections and never inflate mathematical contribution counts.

## Page 6: Contribution receipt

This is the canonical shareable evidence page.

Human-readable top section:

- contribution type and accepted mathematical result;
- credited person and delegated Agent;
- target goal and downstream use;
- verification status and any later retraction or supersession.

Machine evidence section:

- receipt ID and content hash;
- delegation certificate hash;
- artifact and environment manifests;
- declaration IDs and dependency edges;
- Agent signature, server timestamp, verifier signatures;
- Lean version, Mathlib commit, build result, and axioms.

Corrections append a new signed event. They do not rewrite the old receipt.

## Visual system

### Reference language

The design direction combines four existing frontend languages:

| Reference | Borrow | Do not copy |
| --- | --- | --- |
| Zooniverse | Mission → real projects → participation → trust | Its dated visual treatment |
| Formal Conjectures | Academic catalog, filters, statement cards | Collapsing complex status to Open/Solved |
| Lean Blueprint | Mathematical dependency structure | Showing the complete unreadable DAG by default |
| GitHub pull requests | Evidence tabs, checks, diff, reviewers, history | Developer-specific terminology where mathematical language is clearer |

The synthesis should feel like a contemporary public research institution with
the interaction precision of an engineering tool.

### Character

- deep navy public header, warm neutral research canvas, near-black text, and a
  restrained indigo accent;
- a slightly editorial composition on the public welcome page and a denser tool
  composition inside the authenticated application;
- green only for a specific completed verification layer;
- amber for provisional or human-review states;
- red for invalid, revoked, or retracted evidence;
- monospace for Lean, hashes, keys, revisions, and receipt identifiers;
- readable serif or highly legible sans-serif for mathematical exposition.

Avoid neon gradients, token tickers, glowing network globes, and anonymous bot
avatars. The differentiator is evidence clarity.

Do not use fake terminal output, auto-playing Agent conversations, or animated
node clouds in the welcome hero. They center the Agent spectacle instead of the
person and the resulting mathematics.

### Core components

```text
ConjectureCard
FormalStatementPanel
VerificationStack
DependencyGraph
ContributionRoleChip
PersonAgentBadge
DelegationStatus
ArtifactDiff
AxiomAudit
ReceiptTimeline
EvidenceDrawer
SourceCitation
```

`PersonAgentBadge` should always encode the relationship visually:

```text
[Person avatar/name]
  via [Agent glyph/name]
```

Never show an Agent alone where attribution or verifier independence matters.

## Graph behavior

Use graphs only for local mathematical structure. Default to the selected theorem
and one or two dependency levels; a full project DAG can contain thousands of
nodes and should load on demand.

Suggested node semantics:

- outline: artifact status;
- fill: contribution type;
- small owner marker: credited person;
- edge style: `uses`, `derivedFrom`, or `inspiredBy`;
- halo: currently active attempt, not verification.

Provide a list/table fallback for accessibility, mobile use, and exact auditing.

## MVP build order

1. Public welcome with real or clearly labeled snapshot-backed project cards.
2. Read-only Explore and Conjecture detail using a pinned Formal Conjectures
   snapshot.
3. Receipt page with mocked but schema-valid evidence.
4. Person profile and delegated-Agent relationship.
5. Verification queue backed by real Lean build jobs.
6. Workbench submission flow.
7. Project DAG and downstream-impact views.

The first usability test should ask participants to distinguish “kernel checked”
from “statement attested.” If they cannot, the status design is not yet safe.

## Suggested frontend primitives

- React and TypeScript for the application shell and evidence components.
- React Flow (`@xyflow/react`) for the first interactive dependency view:
  https://reactflow.dev/
- Monaco Editor for Lean source, diffs, and diagnostics:
  https://github.com/microsoft/monaco-editor
- KaTeX for fast mathematical display with HTML/MathML output:
  https://katex.org/
- Cytoscape.js as a later option for larger read-only graph analysis:
  https://js.cytoscape.org/

Start with React Flow only. Maintaining two graph renderers before real project
data exposes performance limits would add complexity without validating the
product. The graph API should nevertheless use renderer-neutral nodes and edges.
