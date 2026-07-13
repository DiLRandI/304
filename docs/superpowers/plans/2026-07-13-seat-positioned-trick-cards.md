# Seat-Positioned Trick Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Current trick text tiles with accessible visual cards positioned nearest the seat that played them.

**Architecture:** Extract display-only card content into a shared `CardFace` component used by both interactive hand cards and non-interactive trick cards. Keep trick placement entirely presentational by exposing the existing `seatIndex` and `seatCount` values as data attributes consumed by responsive CSS grids.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, CSS Grid, Vitest, Testing Library, Playwright

## Global Constraints

- Preserve the existing game projection contract and authoritative server data flow.
- Do not add dependencies or new network-loaded card assets.
- Do not display card names or point values as visible Current trick text.
- Keep full card details available to screen readers and never disclose hidden card details.
- Support both four-seat and six-seat table layouts.
- Preserve the pending engine fix in `packages/game-engine/src/engine.js` and `packages/game-engine/test/public-api.test.mjs` without staging it in UI-only commits.

---

### Task 1: Shared visual card face and accessible trick markup

**Files:**
- Modify: `apps/web/test/game-table.test.tsx`
- Modify: `apps/web/src/components/card.tsx`
- Modify: `apps/web/src/components/game-table.tsx`

**Interfaces:**
- Consumes: `ProjectedCard`, `cardLabel(card)`, `ProjectedTrickPlay.seatIndex`, and `GameRoomView.publicState.seatCount`.
- Produces: `CardFace({ card, accessibleLabel?, decorative? })`, `.trick-card[data-seat-index]`, `.trick-card[data-hidden]`, and `.trick-cards[data-seat-count]` markup for CSS.

- [x] **Step 1: Write the failing Current trick rendering test**

Update the Testing Library import in `apps/web/test/game-table.test.tsx`:

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
```

Add this test inside `describe("GameTable", ...)`:

```tsx
it("renders played cards as accessible visuals at their player seats", () => {
  const projection = activeProjection();
  const publicState = projection.view.publicState as Record<string, unknown>;
  publicState.trick = {
    plays: [
      { card: sevenOfClubs, faceDown: false, seatIndex: 2 },
      {
        card: { cardId: "hidden-indicator", hidden: true },
        faceDown: true,
        seatIndex: 3,
      },
    ],
  };

  render(
    <GameTable
      connection="live"
      leave={vi.fn()}
      projection={projection}
      submit={vi.fn()}
    />,
  );

  const trick = screen.getByRole("region", { name: "Current trick" });
  const visibleCard = within(trick).getByRole("img", {
    name: "Seven of Clubs, 0 points, played by Seat 3",
  });
  expect(
    visibleCard.closest(".trick-card")?.getAttribute("data-seat-index"),
  ).toBe("2");
  expect(trick.textContent).not.toContain("Seven of Clubs");

  const hiddenCard = within(trick).getByRole("img", {
    name: "Hidden card, played by Seat 4",
  });
  expect(
    hiddenCard.closest(".trick-card")?.getAttribute("data-hidden"),
  ).toBe("true");
  expect(
    trick.querySelector(".trick-cards")?.getAttribute("data-seat-count"),
  ).toBe("4");
});
```

- [x] **Step 2: Run the focused test and verify the red state**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx
```

Expected: FAIL because Current trick cards have no image role and expose their card label as visible text.

- [x] **Step 3: Extract the shared display-only card content**

Add this export below `cardLabel` in `apps/web/src/components/card.tsx`:

```tsx
export function CardFace({
  accessibleLabel,
  card,
  decorative = false,
}: {
  accessibleLabel?: string;
  card: ProjectedCard;
  decorative?: boolean;
}) {
  const isHidden = card.hidden || !card.rank || !card.suit;
  const label = accessibleLabel ?? cardLabel(card);

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className="card-face"
      data-hidden={isHidden || undefined}
      data-suit={card.suit ?? undefined}
      role={decorative ? undefined : "img"}
    >
      {isHidden ? (
        <span aria-hidden="true" className="card-back">
          304
        </span>
      ) : (
        <>
          <span aria-hidden="true" className="card-rank">
            {card.rank}
          </span>
          <span aria-hidden="true" className="card-suit">
            {SUIT_SYMBOLS[card.suit ?? ""] ?? "?"}
          </span>
        </>
      )}
    </span>
  );
}
```

Replace `CardButton`'s current hidden/visible child branches with the shared component while retaining the existing screen-reader text:

```tsx
<CardFace card={card} decorative />
<span className="sr-only">{label}</span>
```

- [x] **Step 4: Render each trick play with visual markup and placement data**

Import `CardFace` in `apps/web/src/components/game-table.tsx`:

```tsx
import { CardButton, CardFace, cardLabel } from "./card";
```

Replace the Current trick cards container with:

```tsx
<div className="trick-cards" data-seat-count={publicState.seatCount}>
  {view.publicState.trick.length === 0 ? (
    <p>Waiting for the lead card.</p>
  ) : (
    view.publicState.trick.map((play) => (
      <div
        className="trick-card"
        data-hidden={play.card.hidden || undefined}
        data-seat-index={play.seatIndex}
        data-suit={play.card.suit ?? undefined}
        key={`${play.seatIndex}-${play.card.cardId}`}
      >
        <CardFace
          accessibleLabel={`${cardLabel(play.card)}, played by Seat ${play.seatIndex + 1}`}
          card={play.card}
        />
      </div>
    ))
  )}
</div>
```

- [x] **Step 5: Run the focused test and typecheck**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx
pnpm --filter @three-zero-four/web typecheck
```

Expected: all `game-table.test.tsx` tests pass and TypeScript exits with status 0.

- [x] **Step 6: Commit the semantic card rendering change**

```bash
git add apps/web/test/game-table.test.tsx apps/web/src/components/card.tsx apps/web/src/components/game-table.tsx
git commit -m "feat(web): render trick plays as cards"
```

Expected: the commit contains only the three web files from this task.

---

### Task 2: Seat-relative responsive trick layout

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `.trick-cards[data-seat-count]`, `.trick-card[data-seat-index]`, `.trick-card[data-hidden]`, `.trick-card[data-suit]`, and `.card-face` from Task 1.
- Produces: four-seat and six-seat CSS grid placement, responsive visual card sizing, high-contrast styling, and large-card preference styling.

- [x] **Step 1: Define the four-seat and six-seat trick grids**

Replace the existing `.trick-area`, `.trick-cards`, `.trick-card`, and `.trick-card span` rules in `apps/web/src/app/globals.css` with:

```css
.trick-area {
  display: grid;
  min-height: 13rem;
  align-content: start;
  gap: 0.75rem;
}

.trick-cards {
  display: grid;
  min-height: 10.5rem;
  grid-template-areas:
    ". seat-2 ."
    "seat-1 . seat-3"
    ". seat-0 .";
  grid-template-columns: repeat(3, minmax(3.25rem, 1fr));
  grid-template-rows: repeat(3, minmax(3.25rem, 1fr));
  gap: 0.35rem;
  place-items: center;
}

.trick-cards[data-seat-count="6"] {
  grid-template-areas:
    "seat-3 seat-4 ."
    "seat-2 . seat-5"
    "seat-1 . seat-0";
}

.trick-cards > p {
  grid-area: 1 / 1 / -1 / -1;
  align-self: center;
  color: #afc4b1;
  font-size: 0.86rem;
  text-align: center;
}

.trick-card[data-seat-index="0"] { grid-area: seat-0; }
.trick-card[data-seat-index="1"] { grid-area: seat-1; }
.trick-card[data-seat-index="2"] { grid-area: seat-2; }
.trick-card[data-seat-index="3"] { grid-area: seat-3; }
.trick-card[data-seat-index="4"] { grid-area: seat-4; }
.trick-card[data-seat-index="5"] { grid-area: seat-5; }

.trick-card {
  display: grid;
  width: clamp(3.35rem, 5vw, 4.6rem);
  aspect-ratio: 0.68;
  place-items: center;
  border: 1px solid rgb(38 47 35 / 32%);
  border-radius: 0.6rem;
  background: linear-gradient(145deg, #fffaf0, #e9dfc9);
  box-shadow:
    0 0.55rem 0.8rem rgb(0 0 0 / 25%),
    inset 0 0 0 2px rgb(255 255 255 / 54%);
  color: #1a2b20;
  padding: 0.35rem;
}

.trick-card > .card-face {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
}

.trick-card[data-suit="hearts"],
.trick-card[data-suit="diamonds"] {
  color: #8d3029;
}

.card-button > .card-face {
  display: contents;
}
```

Format the six one-line seat selectors according to Biome's CSS output if the formatter expands them.

- [x] **Step 2: Extend accessibility preferences to trick cards**

Add `.trick-card` alongside `.card-button` in the large-card and high-contrast sections:

```css
html[data-card-size="large"] .trick-card {
  width: clamp(4rem, 6vw, 5.4rem);
}

html[data-contrast="high"] .card-button,
html[data-contrast="high"] .trick-card {
  border: 3px solid #000;
  background: #fff;
  box-shadow: none;
}

html[data-contrast="high"] .card-button[data-suit="hearts"],
html[data-contrast="high"] .card-button[data-suit="diamonds"],
html[data-contrast="high"] .trick-card[data-suit="hearts"],
html[data-contrast="high"] .trick-card[data-suit="diamonds"] {
  color: #7a0000;
}
```

- [x] **Step 3: Format and run focused web verification**

Run:

```bash
pnpm exec biome format --write apps/web/src/app/globals.css apps/web/src/components/card.tsx apps/web/src/components/game-table.tsx apps/web/test/game-table.test.tsx
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx
pnpm --filter @three-zero-four/web typecheck
```

Expected: formatting changes are limited to the listed UI files, all focused tests pass, and TypeScript exits with status 0.

- [x] **Step 4: Commit the responsive layout**

```bash
git add apps/web/src/app/globals.css
git commit -m "style(web): position trick cards by seat"
```

Expected: the commit contains only `apps/web/src/app/globals.css`.

---

### Task 3: Close bidding immediately at the effective maximum

**Files:**
- Modify: `packages/game-engine/test/public-api.test.mjs`
- Modify: `packages/game-engine/test/second-bidding.test.mjs`
- Modify: `packages/game-engine/src/engine.js`

**Interfaces:**
- Consumes: the profile `maxBid`, the active bidding phase's step, and the existing four-card and second-round completion transitions.
- Produces: immediate terminal transitions after a 300 bid and no pass-only second round after a maximum four-card bid.

- [x] **Step 1: Write failing maximum-bid regression tests**

Add a public API test proving that a legal 300 bid immediately enters trump selection and, after indicator selection, skips second bidding. Add a second-bidding test where the original maker passes and another seat bids 300, proving that the new winner immediately enters trump selection without pass-only turns.

- [x] **Step 2: Run both engine test files and verify the red state**

Run:

```bash
pnpm --filter @three-zero-four/game-engine exec node --test test/public-api.test.mjs test/second-bidding.test.mjs
```

Expected: both new tests fail because `_handleBid` advances to a seat whose only legal action is `PASS_BID`.

- [x] **Step 3: Centralize and apply terminal bidding transitions**

In `packages/game-engine/src/engine.js`, add a helper that recognizes when the current bid plus the active round's step exceeds `profile.maxBid`. Extract the existing four-card and second-round completion blocks into methods, call them immediately after an effective maximum bid, and skip second bidding after indicator selection when the four-card winner already bid the effective maximum.

Do not synthesize user action history. The terminal phase transition itself represents the remaining players' implicit passes.

- [x] **Step 4: Run engine regressions and typecheck**

Run:

```bash
pnpm --filter @three-zero-four/game-engine exec node --test test/public-api.test.mjs test/second-bidding.test.mjs
pnpm --filter @three-zero-four/game-engine typecheck
```

Expected: both test files and the engine syntax checks pass.

---

### Task 4: Correct Nine's value in player-facing rules

**Files:**
- Modify: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/test/public-pages.test.tsx`
- Modify: `apps/web/src/components/rules-drawer.tsx`

**Interfaces:**
- Consumes: the authoritative point table documented in `docs/product/03_GAME_RULES_AND_VARIANTS.md` and implemented by the game profile.
- Produces: a visible `Nine · 20 points` rule entry and a zero-point entry containing only Eight, Seven, and Six.

- [x] **Step 1: Add failing rules UI assertions**

Add `expect(screen.getByText("Nine · 20 points")).toBeTruthy()` to both the rules drawer accessibility test and the public rules page test.

- [x] **Step 2: Run the focused tests and verify the red state**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/accessibility.test.tsx test/public-pages.test.tsx
```

Expected: both new assertions fail because the rules list incorrectly groups Nine with zero-point cards.

- [x] **Step 3: Correct the shared card-value list**

In `apps/web/src/components/rules-drawer.tsx`, insert `"Nine · 20 points"` immediately after Jack and change the zero-point entry to `"Eight, Seven, and Six · 0 points"`.

- [x] **Step 4: Re-run the focused tests**

Run the Step 2 command again. Expected: both test files pass.

---

### Task 5: Full regression and browser-game verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: the complete UI from Tasks 1 and 2 and the existing local Compose stack.
- Produces: test, typecheck, build, and browser evidence that trick cards remain readable and correctly placed.

- [x] **Step 1: Run the repository verification suite**

Run:

```bash
pnpm check
pnpm build
```

Expected: lint, typechecks, unit tests, and production builds pass. The previously pending engine test remains green.

- [x] **Step 2: Rebuild and start the local stack**

Run:

```bash
pnpm compose:up
```

Expected: Postgres, Redis, migration, game service, worker, and web services become healthy at `http://127.0.0.1:3000`.

- [x] **Step 3: Run the browser suite**

Run:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
```

Expected: the complete Playwright suite passes.

- [x] **Step 4: Visually inspect an active trick**

Create a local four-player practice room, play until at least three cards are in Current trick, and verify at desktop and narrow viewport widths that:

- only visual card faces or backs appear in Current trick;
- each card is nearest the seat that played it;
- no card overlaps another card, the Current trick heading, or table metrics;
- face-down cards disclose no rank, suit, or points;
- high-contrast and large-card preferences preserve legibility.

Expected: the live table matches the approved seat-positioned design without console or page errors.

- [x] **Step 5: Confirm final repository state**

Run:

```bash
git status --short --branch
git log -5 --oneline --decorate
```

Expected: `master` contains the UI commits, and any remaining working-tree modifications are only the previously identified engine fix unless that fix has been intentionally committed separately.
