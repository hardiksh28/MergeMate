# MergeMate logo: usage guide

## The idea
A lowercase **m** whose two arches share one middle stem, and that stem lands on a **commit node**: two arches, one merge.
It's MergeMate's initial and the moment a PR lands, in a single shape.

## Files

Everything is SVG. `source/build.py` regenerates all of it from one set of parameters.

| Need | File |
|---|---|
| Symbol (master, ink) | `svg/mergemate-symbol.svg` · pure black `-black.svg` |
| Symbol on dark (thinned ~5 %) | `svg/mergemate-symbol-lime.svg`, `svg/mergemate-symbol-white.svg` |
| Small-size cut (24–48 px) | `svg/mergemate-symbol-small.svg` |
| Centre-line version (draw-on animation) | `svg/mergemate-symbol-stroke.svg` |
| Horizontal lockup | `svg/mergemate-horizontal.svg` · `-black` · `-on-dark` · `-white` · `-lime` |
| Stacked lockup | `svg/mergemate-stacked.svg` · `-on-dark` · `-white` |
| Wordmark only | `svg/mergemate-wordmark.svg` |
| App icon (lime tile) | `icons/app-icon.svg` |
| iOS / Android full-bleed | `icons/apple-touch-icon.svg`, `icons/maskable-icon.svg` |
| Avatar (circle-safe) | `icons/avatar.svg` |
| Favicon | `icons/favicon.svg`, `icons/favicon-dark.svg`, `icons/favicon-16.svg` (drawn on the pixel grid) |
| Web manifest | `icons/site.webmanifest` (SVG icons) |
| Construction + clear-space diagram | `diagrams/construction.svg` |
| Raster, only where a platform demands it | `icons/raster/favicon.ico`, `icons/raster/apple-touch-icon.png` (both rendered from the SVGs) |

### Editing colours and animating
- There are no transforms anywhere; every coordinate is baked into the path data.
- Colours are plain `fill` attributes on three groups, so Figma and Illustrator read them, and inline CSS overrides them:
  `.mm-mark` (symbol), `.mm-word` (wordmark), `.mm-tile` (icon background).
- The symbol is three overlapping layers: `.mm-arch-left` (left leg, left arch and middle stem), `.mm-arch-right`
  (right arch and leg) and `.mm-node` (commit node and fillets). They overlap a few units, so moving or scaling one
  never opens a hairline seam. Animate with `transform-box: fill-box` to get per-part origins.
- The wordmark is one path per letter: `.mm-letter` plus `.mm-letter-1` … `.mm-letter-9`.
- For draw-on effects, use `mergemate-symbol-stroke.svg`. Its `.mm-arches` and `.mm-stem` paths have
  `pathLength="1"`, so `stroke-dasharray: 1; stroke-dashoffset: 1 → 0` works with no measuring, and `.mm-node` is a
  plain `<circle>`. It matches the filled mark except for the small stem-to-node fillets.
- Inline the SVG (or use `<svg><use>`) for CSS to reach it. An `<img src>` can't be styled.

## Colour

| | HEX | RGB | CMYK (approx.) | Role |
|---|---|---|---|---|
| **Lime** | `#d4ff3a` | 212 255 58 | 17 0 77 0 | Signature colour: the symbol on dark, the app-icon tile |
| **Ink** | `#0b0d02` | 11 13 2 | 60 40 40 100 (rich black) | The logo on light grounds, the mark on lime |
| **Paper** | `#f6f5f1` | 246 245 241 | 2 2 4 0 | Wordmark on dark |

The nearest Pantone match for lime is fluorescent territory. Confirm it against a physical swatch book before you print anything.

Contrast: ink on lime is 16.9:1 and lime on the site background `#08080a` is 17.3:1. **Lime on white is 1.2:1, so never put the lime logo on a light ground.**

### Approved combinations
- Ink logo on white, paper, or any light ground.
- Lime symbol + paper wordmark on ink / near-black (`-on-dark` files).
- Ink symbol on a lime tile (app icon, avatar, favicon).
- All-white on photos or busy dark grounds.

## Clear space
Keep clear space on every side equal to the **diameter of the commit node** (64 units on the 256 grid, ≈ ⅓ of the symbol's height).

## Minimum sizes

| Artwork | Screen | Print |
|---|---|---|
| Symbol (master) | 48 px | 10 mm |
| Symbol small cut | 24–48 px | 6–10 mm |
| Favicon | 16–32 px (use the favicon files) | n/a |
| Horizontal lockup | 120 px wide | 25 mm wide |
| Stacked lockup | 80 px wide | 18 mm wide |

## Construction
- 256-unit grid. Stems and arches are 40 units thick with 40-unit counters, and the arches are true semicircles (R 60 / r 20).
- The commit node is r 32, centred on the middle stem, and flows into it through 10-unit fillets.
- The reversed cut thins strokes to 38 units, so light-on-dark doesn't look heavier.
- The small cut uses 46-unit strokes and a 36-unit node. The favicon uses a micro cut, and the 16 px version is drawn on the pixel grid.

## Typography
The wordmark is **Bricolage Grotesque Bold**, set lowercase with −3 % tracking and converted to outlines. The font is under the SIL Open Font License, which allows logo use; the licence is in `source/`. The wordmark's x-height is 62 % of the symbol's arch height.

## Don'ts
- Don't recolour the logo outside the palette, or use lime on light grounds.
- Don't add gradients, shadows, outlines or glows.
- Don't stretch, rotate or skew it (rotated 180° it reads as a "w").
- Don't rebuild the wordmark in live type; use the outlined files.
- Don't separate the node from the stem or change its size.
- Don't use the master symbol below 24 px; use the small or favicon cut.

## Open items
- Run a trademark search before launch (USPTO / EUIPO plus a reverse image search). This kit doesn't clear the mark.
- Add a social OG image. For X/GitHub avatars, use `icons/avatar.svg` (export at upload time if a site rejects SVG).
- PDF/EPS print masters need Illustrator or Inkscape; the SVGs are the source of truth.
