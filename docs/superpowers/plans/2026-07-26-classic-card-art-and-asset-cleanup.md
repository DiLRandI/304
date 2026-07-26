# Classic Card Art and Asset Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ornate card pack with a deterministic, conventional SVG deck and remove card asset formats that the application does not use.

**Architecture:** A focused Node script owns card metadata and produces the 44 face SVGs plus one shared back from reusable classic-card primitives. The existing application resolver and public-asset sync contract continue to consume SVG paths, while the manifest and CSV become SVG-only inventories.

**Tech Stack:** Node.js 24, ECMAScript modules, SVG, Next.js 16, React 19, Vitest, Node test runner, Biome, TypeScript

## Global Constraints

- Keep the supported standard ranks `J`, `9`, `A`, `10`, `K`, `Q`, `8`, and `7`.
- Keep the six-player variant ranks `2`, `3`, and `6`.
- Use black spades and clubs and red hearts and diamonds.
- Use white faces, mirrored corner indices, conventional pip layouts, restrained mirrored court figures, and a shared classic back.
- Do not place point values, `304` branding, explanatory labels, gradients, medallions, gold ornament, or promotional text in artwork.
- Do not change gameplay rules, scoring, rank order, accessibility behavior, or card identifiers.
- Preserve Playwright, integration, Compose, backup/restore, load-smoke, CI, and other release-gate files.

---

## File Structure

- Create `scripts/generate-classic-card-assets.mjs`: card metadata, reusable SVG primitives, deterministic face/back rendering, file emission, manifest emission, and CSV emission.
- Create `test/classic-card-assets.test.mjs`: structural and content contract for generated assets.
- Modify `package.json`: expose the generator and run its contract in the root test suite.
- Modify `assets/card_manifest.json`: retain gameplay metadata but publish SVG paths only under the neutral classic-pack identity.
- Modify `docs/resources/card_list.csv`: retain card IDs/rules metadata with a single SVG path column.
- Modify `docs/README.md`: describe the SVG-only generated card pack.
- Modify `apps/web/test/card-artwork.test.ts`: verify all resolver URLs correspond to the retained classic SVG contract and keep hidden/fallback behavior.
- Delete `assets/cards/standard_304/png/`, `assets/cards/variant_extras/png/`, `assets/backs/png/`, `assets/previews/`, and `assets/spritesheets/`: unused derivatives.
- Regenerate `assets/cards/standard_304/svg/*.svg`, `assets/cards/variant_extras/svg/*.svg`, and `assets/backs/svg/card_back_304_ceylon.svg`.

### Task 1: Lock the SVG-Only Classic Deck Contract

**Files:**
- Create: `test/classic-card-assets.test.mjs`
- Modify: `package.json`
- Test: `test/classic-card-assets.test.mjs`

**Interfaces:**
- Consumes: repository-root `assets/card_manifest.json` and `docs/resources/card_list.csv`
- Produces: a test contract requiring 44 unique face SVGs, one back SVG, SVG-only metadata, valid referenced paths, and forbidden-decoration absence

- [ ] **Step 1: Write the failing asset contract**

Create a Node test that:

```js
const FORBIDDEN_ARTWORK = [
  /(?:^|[^0-9])304(?:[^0-9]|$)/i,
  /\bpts?\b/i,
  /Sri Lankan 304 rank value/i,
  /HIGH 304/i,
  /<linearGradient\b/i,
  /<radialGradient\b/i,
  /softMedallion/i,
];
```

It must parse the manifest, assert `standard_cards.length === 32`, `variant_extra_cards.length === 12`, assert every entry has an `svg` property and no `png` property, assert every referenced SVG exists, scan every SVG against each forbidden pattern, assert the back contains no `<text`, and assert the CSV header is exactly `id,rank,suit,points,standard_304,svg`.

- [ ] **Step 2: Add the test to the root suite and verify it fails**

Modify the root `test` script to keep `node --test test/*.test.mjs`; the glob automatically discovers the new file.

Run:

```bash
pnpm test --test-name-pattern="classic card asset pack"
```

Expected: FAIL because the manifest and CSV still contain PNG paths and the current SVGs contain forbidden ornament/copy.

- [ ] **Step 3: Commit the red contract**

```bash
git add test/classic-card-assets.test.mjs package.json
git commit -m "test: define classic card asset contract"
```

### Task 2: Build the Deterministic Classic SVG Generator

**Files:**
- Create: `scripts/generate-classic-card-assets.mjs`
- Modify: `package.json`
- Test: `test/classic-card-assets.test.mjs`

**Interfaces:**
- Consumes: `SUITS`, `STANDARD_RANKS`, `EXTRA_RANKS`, and point metadata defined in the generator
- Produces: `renderFace({ rank, suitCode })`, `renderBack()`, 44 face SVG files, one back SVG, `assets/card_manifest.json`, and `docs/resources/card_list.csv`

- [ ] **Step 1: Implement shared card metadata and SVG escaping**

Define immutable suit records with symbols, names, and `#171717` or `#b91c1c` colors. Define the exact standard and extra rank arrays with their existing point metadata. Add:

```js
function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
```

- [ ] **Step 2: Implement conventional number-card pip layouts**

Use normalized positions over a `500 × 700` view box. Define exact position arrays for ranks `2`, `3`, `6`, `7`, `8`, `9`, and `10`; mark lower-half pips for 180-degree rotation. Render suit symbols as SVG text using `Georgia, "Times New Roman", serif`, with no gradients or filters.

- [ ] **Step 3: Implement ace and mirrored court compositions**

Render aces with one large centered suit. Render `J`, `Q`, and `K` with a clipped central panel containing simple geometric, mirrored royal figures, suit-colored accents, and rank-specific crown/headwear shapes. Keep the figures restrained and recognizable, without labels beyond the conventional corner rank and suit indices.

- [ ] **Step 4: Implement the shared face shell and classic back**

`renderFace` must produce a plain `#fffdf8` rounded rectangle, thin `#c8c3b8` border, mirrored indices, and the rank body. `renderBack` must produce a symmetric red-and-cream lattice using basic paths/polygons only, bounded by a double border, with no text, rank, suit, or gameplay information.

- [ ] **Step 5: Implement deterministic file and metadata emission**

Write the face files using the existing names and collection directories. Write a manifest whose entries retain `id`, `rank`, `rank_name`, `suit`, `suit_name`, `points`, ordering, and `standard_304`, but expose only `svg`. Write the CSV header `id,rank,suit,points,standard_304,svg` and one row per face. Add:

```json
"generate:card-assets": "node scripts/generate-classic-card-assets.mjs"
```

to root scripts.

- [ ] **Step 6: Generate assets and run the focused contract**

Run:

```bash
pnpm generate:card-assets
pnpm test --test-name-pattern="classic card asset pack"
```

Expected: PASS with 44 classic faces, one text-free back, and synchronized SVG-only metadata.

- [ ] **Step 7: Verify generation is deterministic**

Run the generator twice and confirm:

```bash
git diff --exit-code -- assets/cards assets/backs/svg assets/card_manifest.json docs/resources/card_list.csv
```

after recording the first generated state in the worktree index or a temporary checksum list. Expected: the second run introduces no differences.

- [ ] **Step 8: Commit the generator and generated SVG pack**

```bash
git add scripts/generate-classic-card-assets.mjs package.json assets/cards/standard_304/svg assets/cards/variant_extras/svg assets/backs/svg assets/card_manifest.json docs/resources/card_list.csv
git commit -m "feat: replace card art with classic SVG deck"
```

### Task 3: Remove Unused Card Derivatives and Update Documentation

**Files:**
- Delete: `assets/cards/standard_304/png/`
- Delete: `assets/cards/variant_extras/png/`
- Delete: `assets/backs/png/`
- Delete: `assets/previews/`
- Delete: `assets/spritesheets/`
- Modify: `docs/README.md`
- Modify: `apps/web/test/card-artwork.test.ts`
- Test: `test/classic-card-assets.test.mjs`
- Test: `apps/web/test/card-artwork.test.ts`

**Interfaces:**
- Consumes: SVG-only manifest and the unchanged `/generated/card-art/.../svg/...` resolver URLs
- Produces: a repository with one authoritative artwork format and no stale derivative references

- [ ] **Step 1: Strengthen resolver coverage**

Update the resolver test description from Ceylon artwork to classic artwork. For every supported card, assert the returned URL ends in `.svg`, contains the correct standard/variant directory, and does not contain `/png/`. Keep the hidden-card and unknown-visible-card assertions unchanged.

- [ ] **Step 2: Run the focused web test**

```bash
pnpm --filter @three-zero-four/web test -- card-artwork
```

Expected: PASS.

- [ ] **Step 3: Remove only audited unused derivatives**

Delete the five derivative directories listed in this task. Do not remove any runtime/test/operations path outside `assets`.

- [ ] **Step 4: Update the asset documentation**

Document that `assets/card_manifest.json` inventories the generated classic SVG faces and that `pnpm generate:card-assets` reproducibly updates faces, back, manifest, and CSV. Remove any documentation references to PNG previews or spritesheets.

- [ ] **Step 5: Prove there are no stale references**

Run:

```bash
rg -n "assets/(?:cards/.+/png|backs/png|previews|spritesheets)|\\.png" assets/card_manifest.json docs/resources/card_list.csv docs/README.md apps scripts test
```

Expected: no card-pack PNG, preview, or spritesheet references.

- [ ] **Step 6: Run focused asset and web tests**

```bash
pnpm test --test-name-pattern="classic card asset pack"
pnpm --filter @three-zero-four/web test
```

Expected: PASS.

- [ ] **Step 7: Commit cleanup**

```bash
git add -A assets docs/README.md apps/web/test/card-artwork.test.ts
git commit -m "chore: remove unused card asset derivatives"
```

### Task 4: Verify the Complete Change

**Files:**
- Verify: all files changed by Tasks 1–3

**Interfaces:**
- Consumes: generated classic SVG deck and SVG-only repository inventory
- Produces: lint, type, unit, build, and browser evidence

- [ ] **Step 1: Validate metadata and referenced paths**

Run:

```bash
jq empty assets/card_manifest.json
pnpm test --test-name-pattern="classic card asset pack"
```

Expected: both commands pass.

- [ ] **Step 2: Run the repository quality gate**

```bash
pnpm check
```

Expected: lint, type checking, and all unit tests pass.

- [ ] **Step 3: Run the production build**

```bash
pnpm build
```

Expected: all packages and the Next.js production app build successfully, including the card-asset sync prebuild.

- [ ] **Step 4: Inspect representative SVGs**

Visually inspect at least the ace, ten, jack, queen, king, and shared back across red and black suits. Confirm standard rank/suit recognition, mirrored orientation, plain faces, and absence of gameplay point labels or decorative branding.

- [ ] **Step 5: Run desktop and mobile browser checks**

Start the app on an isolated non-default port and use Playwright to inspect a populated player hand and current trick at desktop and mobile viewports. Confirm cards are not clipped, remain distinguishable, and expose no console errors.

- [ ] **Step 6: Report the exact cleanup**

Compare the pre/post asset byte counts with `du -sh assets` and list deleted directories. Report verification command outcomes and the final `git status -sb`; do not claim unrelated repository files are unused.
