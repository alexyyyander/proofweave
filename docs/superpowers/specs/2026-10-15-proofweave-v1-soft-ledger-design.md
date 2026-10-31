# Proofweave v1 — “Soft Ledger” design preview site

Date: 2026-10-15
Status: approved for implementation (local preview)

## Goal

Build an independent, static design-preview site that applies a revised
frontend design language (“Soft Ledger”) to real Proofweave product objects, so
the direction can be reviewed locally and later deployed independently to a
`v1` subdomain. It must not modify the existing application, its stylesheet, or
its tests.

The design language synthesizes engineering-grade ideas observed in the
`open-claude-ui` Claude design-system reconstruction (MIT) — surface ladder,
hairline ring, radius matrix, motion tokens, scroll-fade masks, container
queries, roving focus, IME guard, scroll pinning — while keeping Proofweave’s
own palette, typography, and product posture.

## Scope

In scope:

- a zero-dependency static site under `v1/` (plain HTML/CSS/vanilla JS);
- a design-system gallery page plus four representative product views;
- a shared token layer and a small interactive runtime;
- a zero-dependency local static server and a run/deploy README.

Out of scope (explicitly):

- no changes to `app/`, `app/globals.css`, `next.config`, or any existing test;
- no adoption of Claude branding (clay `#d97757`, chat bubbles, thinking
  accordion, ambient glow, synthetic audio, Electron desktop chrome);
- no fabricated network statistics (activity, contributor counts, solved
  counts); all sample content is clearly labelled illustrative.

## Product posture guardrails

- Status is always expressed as text + icon, never colour alone
  (`docs/frontend-mvp.md:226`).
- The site is a design preview, not a live network surface; a persistent
  “DESIGN PREVIEW · illustrative data” marker is shown.
- Person → delegated Agent attribution stays legible
  (`docs/frontend-mvp.md:379`).

## Design language

### Surfaces (4-tier ladder, warm-neutral)

| Token | Value | Role |
| --- | --- | --- |
| `--surface-0` | `#efece2` | recessed wells, table headers |
| `--surface-1` | `#fbfaf6` | page canvas |
| `--surface-2` | `#ffffff` | cards, panels |
| `--surface-3` | `#ffffff` | overlays/popovers (double-ring shadow) |

### Hairline ring

`--hairline: rgba(21, 34, 57, .16)`. Applied as `0 0 0 .5px` under
`@media (min-resolution: 2dppx)`, otherwise a `1px` fallback. No element
carries both a solid border and a ring.

### Radius matrix

pill `999px` (chips/segmented) · card `12px` · panel `10px` ·
control/input `8px` · small control `6px` · overlay `16px`.

### Motion tokens

`--t-micro 70ms` · `--t-settle 120ms` · `--t-panel 300ms`;
easing `--ease-out cubic-bezier(.2,.8,.2,1)`,
`--ease-snap cubic-bezier(.16,1,.3,1)`. All motion is disabled under
`prefers-reduced-motion: reduce`.

### Colour, type

Unchanged palette: navy `#0b1830`, indigo `#3d5fe6`, sage `#3b644f`, amber
`#795b20`, ink `#152239` and its soft/faint steps. Geist for UI, Geist Mono for
evidence, Georgia serif for mathematical headings.

## Absorbed features (adapted)

1. Surface ladder + hairline ring.
2. Radius matrix + single-border rule.
3. Seven-stop non-linear scroll-fade mask on long lists.
4. Container-query (`@container`) fluid typography, four tiers.
5. Motion tokens + `active:scale(.98)` tactile buttons.
6. Segmented sliding pill for catalog filters.
7. Status stack (text + icon).
8. Roving-focus keyboard navigation for grids/tabs.
9. IME composition guard (`isComposing || keyCode === 229`) on the workbench
   composer.
10. Scroll pinning with a cooldown so streaming events do not steal the viewport.

## Site structure

```
v1/
├─ index.html        design-system gallery
├─ explore.html      catalog: segmented filters, cards, scroll-fade
├─ conjecture.html   detail: status stack, dependency chain, evidence drawer
├─ receipt.html      contribution receipt: summary grid, machine evidence, lifecycle
├─ workbench.html    agent supervision: composer, event stream, submit
├─ assets/tokens.css design tokens
├─ assets/base.css   base layout + components
├─ assets/app.js     runtime (nav, segmented, scroll-pin, IME guard, roving focus)
├─ serve.mjs         zero-dependency static server
└─ README.md         run + deploy notes
```

## Local run

`node v1/serve.mjs` serves the folder at `http://localhost:4173`.

## Verification

- Each page returns HTTP 200 from the local server.
- No file under `app/` is modified; `git status` shows only additions under
  `v1/` and this spec.
- `prefers-reduced-motion` disables transitions.
- Keyboard: roving focus reaches every card/filter; tab order is logical.

## Future

The static folder can be deployed unchanged to a static host (e.g. Cloudflare
Pages) and mapped to a `v1` subdomain; no build step is required.
