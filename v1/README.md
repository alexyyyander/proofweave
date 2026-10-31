# Proofweave v1 — “Soft Ledger” design preview

An independent, static design preview of a revised Proofweave frontend language.
It is self-contained: no build step, no dependencies, and it does not touch the
main application under `app/`.

The design language synthesizes engineering ideas observed in the
`open-claude-ui` Claude design-system reconstruction (MIT) — surface ladder,
retina hairline ring, radius matrix, motion tokens, seven-stop scroll fade,
container-query typography, roving focus, IME guard, scroll pinning — expressed
in Proofweave’s own palette, typography, and posture.

## Run locally

```sh
node v1/serve.mjs          # http://localhost:4173
node v1/serve.mjs 8080     # custom port
```

Open <http://localhost:4173>.

## Pages

| File | Shows |
| --- | --- |
| `index.html` | Design-system gallery: palette, surfaces, radius, type, motion, controls, evidence, scroll fade. |
| `explore.html` | Catalog with segmented filter, conjecture cards, keyboard roving focus. |
| `conjecture.html` | Detail: status stack, dependency chain, evidence drawer. |
| `receipt.html` | Contribution receipt: summary grid, machine evidence, lifecycle. |
| `workbench.html` | Agent supervision: IME-guarded composer, pinned event stream. |

## Files

- `assets/tokens.css` — design tokens (surfaces, radius, motion, hairline).
- `assets/base.css` — layout and components.
- `assets/app.js` — runtime (nav, segmented thumb, roving focus, scroll fade,
  overlay/drawer, catalog filter, IME guard, scroll pinning).

## Design notes

- **Surfaces** form a four-tier ladder: `#efece2` → `#fbfaf6` → `#ffffff` →
  overlay. Borders use a retina hairline ring (`0 0 0 0.5px`) instead of a
  solid `1px` line; no element carries both a border and a ring.
- **Status is always text + icon**, never colour alone.
- All motion is disabled under `prefers-reduced-motion: reduce`.
- Sample content is illustrative and clearly labelled; it is not live network
  data.

## Deploying to a `v1` subdomain

The folder is plain static output. It can be published unchanged to any static
host (for example Cloudflare Pages) and mapped to a `v1` subdomain. No build
required.
