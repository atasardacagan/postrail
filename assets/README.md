# Postrail visual kit

Original vector artwork and raster exports for GitHub and portfolio use. MIT licensed with the repository. The mark combines text lines and a deliberate approval check. No LinkedIn logo, official product identity, stock photo or third-party screenshot is included.

## Assets

| File | Dimensions | Intended use |
| --- | --- | --- |
| `brand/logo.svg` / `.png` | 128 × 128 | Project mark |
| `brand/wordmark.svg` | 360 × 90 | Light-background wordmark |
| `brand/wordmark-dark.svg` | 360 × 90 | Dark-background wordmark |
| `hero.png` / `.svg` | 1600 × 900 | README hero and full-width portfolio cover |
| `social-preview.png` / `.svg` | 1280 × 640 | GitHub social preview |
| `showcase/project-card.png` / `.svg` | 1200 × 900 | Portfolio project card |
| `showcase/workflow.png` / `.svg` | 1280 × 720 | Recorded workflow presentation |
| `showcase/architecture.png` / `.svg` | 1200 × 900 | Simplified architecture illustration |
| `demo/workflow.gif` | 1280 × 720; 16 seconds | Five-step replay for README |
| `demo/run.json` | Structured recorded data | Provenance for the replay and workflow covers |

## Honest provenance

There is no shipped web dashboard in v1. The actual human interface is Telegram. These assets are **designed presentations**, not screenshots of a live Telegram account, product dashboard or LinkedIn result. `scripts/showcase.ts` executes the real application with fresh PGlite migrations and explicitly selected fixture adapters. It records the initial draft, a hook-only revision, CTA removal and a final explicit approval followed by one publication-adapter call. All other blocks are asserted to remain unchanged. Only the recording slot is accelerated to the current minute. No provider keys are loaded into the runtime and no live publication occurs.

The GIF changes the display timing to make that captured state sequence readable. Counters in it describe this one test run, not customers or production activity. Its five frames last 2 / 3.5 / 3.5 / 3.5 / 3.5 seconds. Cover illustrations use the same recorded text and approval behavior. For accessibility or reduced motion, use `showcase/workflow.png` with the written flow in the README.

## Rebuild

From the repository root after `npm ci`:

```sh
npm run demo:record
npm run assets:render
```

The generator is plain SVG plus Sharp rasterization and gifenc encoding, used only as development dependencies. Arial/Helvetica and Menlo/Consolas are system fallback fonts; pixel appearance can differ across machines. No external font or remote image is required. Changes to the generator should be visually reviewed at both native size and a narrow GitHub README width.

## Design tokens

- Paper: `#F4F2EC`
- Ink: `#172B2B`
- Forest: `#355B4F`
- Mint: `#D8EBCE`
- Accent: `#DF744F`
- Dark background: `#122425`

Keep spacious typography, restrained flat colors and visible approval semantics. Use the PNG for social previews; keep the editable SVG source for future sizing.
