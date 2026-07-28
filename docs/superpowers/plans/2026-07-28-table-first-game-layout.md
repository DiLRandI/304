# Table-First Game Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the active game screen so the table appears first, the player's hand appears second, and all supporting controls and information appear afterward.

**Architecture:** Preserve the existing `GameTable` child components and data flow while changing their DOM hierarchy. Keep `table-board` as the playfield, narrow `table-action-dock` to the hand, and introduce `table-information` as the ordered container for all supporting UI.

**Tech Stack:** React, TypeScript, CSS Grid/Flexbox, Vitest, Testing Library, Biome

## Global Constraints

- Desktop and mobile must use the order table, hand, then information.
- Existing game behavior, accessibility semantics, and green table visual direction must remain unchanged.
- The player's hand must remain horizontally scrollable where necessary.
- This change must not alter gameplay, APIs, realtime behavior, or information content.

---

### Task 1: Reorder the active game layout

**Files:**
- Modify: `apps/web/test/game-table.test.tsx`
- Modify: `apps/web/src/features/room/ui/game-table.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: existing `GameTable`, `TableSeats`, `CurrentTrick`, `PlayerHand`, `CommandActions`, `TablePrompt`, `TableMetrics`, `HandResult`, and `RulesDrawer` components.
- Produces: `.table-board`, followed by `.table-action-dock`, followed by `.table-information` in `GameTable` DOM order.

- [ ] **Step 1: Write the failing layout-order test**

Replace the current layout assertion with:

```tsx
it("places the table before the hand and supporting information", () => {
  const { container } = render(
    <GameTable
      connection="live"
      leave={vi.fn()}
      projection={activeProjection()}
      submit={vi.fn()}
    />,
  );

  const table = container.querySelector(".game-table");
  const board = container.querySelector(".table-board");
  const dock = container.querySelector(".table-action-dock");
  const information = container.querySelector(".table-information");
  const hand = screen.getByRole("region", { name: "Your hand" });

  expect(table).not.toBeNull();
  expect(dock?.contains(hand)).toBe(true);
  expect(
    board?.compareDocumentPosition(dock as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    dock?.compareDocumentPosition(information as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node_modules/.bin/vitest run apps/web/test/game-table.test.tsx
```

Expected: the new test fails because `.table-board` currently follows the hand and `.table-information` does not exist.

- [ ] **Step 3: Implement the new DOM hierarchy**

In `GameTable`, render in this order:

```tsx
<div className="table-board">{/* seats and current trick */}</div>

<div className="table-action-dock">
  <PlayerHand {...playerHandProps} />
</div>

<div className="table-information">
  <CommandActions {...commandActionProps} />
  <TablePrompt {...tablePromptProps} />
  {publicState.handResult ? <HandResult {...handResultProps} /> : null}
  <TableMetrics {...tableMetricProps} />
  <RulesDrawer profileId={publicState.profileId} />
  <div className="table-exit">{/* existing exit UI */}</div>
</div>
```

Keep the existing status header immediately before the table as compact table chrome, not an information window.

- [ ] **Step 4: Style the information zone**

Add:

```css
.table-information {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
```

Keep `.table-action-dock` focused on the hand and preserve all existing responsive hand and table rules.

- [ ] **Step 5: Run focused verification**

Run:

```bash
node_modules/.bin/vitest run apps/web/test/game-table.test.tsx
node_modules/.bin/biome check apps/web/src/features/room/ui/game-table.tsx apps/web/test/game-table.test.tsx apps/web/src/app/globals.css
```

Expected: all `game-table` tests pass and Biome reports no errors.

- [ ] **Step 6: Run web verification**

Run:

```bash
CI=true PNPM_CONFIG_STORE_DIR=/tmp/304-game-table-layout-pnpm-store corepack pnpm --filter @three-zero-four/web test
CI=true PNPM_CONFIG_STORE_DIR=/tmp/304-game-table-layout-pnpm-store corepack pnpm --filter @three-zero-four/web typecheck
```

Expected: web tests and type checking pass. If package installation is blocked by restricted network access, report the exact blocker and retain the focused local verification evidence.

- [ ] **Step 7: Commit the implementation**

```bash
git add apps/web/test/game-table.test.tsx apps/web/src/features/room/ui/game-table.tsx apps/web/src/app/globals.css docs/superpowers/plans/2026-07-28-table-first-game-layout.md
git commit -m "feat(web): prioritize table and player hand"
```
