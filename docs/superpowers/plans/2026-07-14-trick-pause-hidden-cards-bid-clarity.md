# Trick Pause, Hidden Cards, and Bid Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold every completed trick on the authoritative table for two seconds, keep unrevealed face-down cards concealed through results, and name the bidding team and player in the live table and hand result.

**Architecture:** Add an engine-level `trick_result` phase and server-only `advanceTrick()` transition, then drive it with a durable `TRICK_ADVANCE` automation job scheduled by the room coordinator. Preserve privacy in the engine projector and derive bidder ownership in the web UI from existing public bidding and seat data.

**Tech Stack:** JavaScript game engine, TypeScript/Fastify game service, PostgreSQL 18 migrations, Redis-backed durable worker coordination, React 19, Next.js 16, Vitest, Node test runner, Playwright

## Global Constraints

- The visible trick pause is exactly 2,000 milliseconds in production.
- No player or bot legal action is exposed during `trick_result`.
- A face-down non-trump card never becomes public merely because a trick, hand, or match ends.
- Do not add card identities to the hand-result contract.
- Do not change 304 bidding, scoring, or token movement rules.
- Preserve the current card artwork and seat-relative table layout.
- All production code changes must be preceded by a focused failing test.

---

### Task 1: Authoritative engine trick-result phase

**Files:**
- Modify: `packages/game-engine/test/public-api.test.mjs`
- Modify: `packages/game-engine/test/second-bidding.test.mjs`
- Modify: `packages/game-engine/src/engine.js`
- Modify: `packages/game-engine/src/index.d.ts`
- Modify: `test/engine-contract.test.mjs`

**Interfaces:**
- Consumes: `GameEngine._resolveTrick()`, `GameEngine._finishHand()`, `state.currentTrick`, `state.completedTricks`, and the existing phase constants.
- Produces: phase string `trick_result`, public `GameEngine.advanceTrick(): { ok: boolean; reason?: string }`, a resolved `currentTrick` with `winnerSeat`, and a prompt naming the trick winner.

- [ ] **Step 1: Write failing engine tests for non-final and final trick pauses**

Add focused tests that construct a legal `trick_play` state with four plays due, call the final `PLAY_CARD`, and assert:

```js
assert.equal(engine.state.phase, "trick_result");
assert.equal(engine.state.activeSeat, null);
assert.equal(engine.state.currentTrick.plays.length, 4);
assert.equal(engine.state.currentTrick.winnerSeat, expectedWinner);
assert.deepEqual(engine.getLegalActions(expectedWinner), []);
assert.match(engine.getPrompt(expectedWinner), /wins the trick/i);

assert.deepEqual(engine.advanceTrick(), { ok: true });
assert.equal(engine.state.phase, "trick_play");
assert.equal(engine.state.currentTrick.plays.length, 0);
assert.equal(engine.state.activeSeat, expectedWinner);
```

For the eighth Classic trick, assert the final play enters `trick_result`, `handResult` remains `null`, and only `advanceTrick()` enters `hand_result` or `match_complete` and creates the result once.

- [ ] **Step 2: Run the focused engine tests and verify the red state**

Run:

```bash
pnpm --filter @three-zero-four/game-engine exec node --test test/public-api.test.mjs
pnpm test -- --test-name-pattern "completed trick"
```

Expected: FAIL because `_resolveTrick()` immediately creates the next trick or hand result and `advanceTrick()` does not exist.

- [ ] **Step 3: Implement the minimal engine transition**

Add `TRICK_RESULT: "trick_result"` to `PHASE`. At the end of `_resolveTrick()`, retain the resolved `currentTrick`, set `phase`, clear `activeSeat`, and set the winner message instead of immediately advancing.

Add:

```js
advanceTrick() {
  if (this.state.phase !== PHASE.TRICK_RESULT || !this.state.currentTrick) {
    this.state.error = "No completed trick is waiting to advance.";
    return { ok: false, reason: this.state.error };
  }
  const winnerSeat = this.state.currentTrick.winnerSeat;
  const handIsComplete =
    this.state.seats.every((seat) => seat.hand.length === 0) ||
    this.state.completedTricks.length >=
      this.state.profile.cardBatch[0] + this.state.profile.cardBatch[1];
  this.state.error = null;
  if (handIsComplete) {
    this._finishHand();
    return { ok: true };
  }
  this.state.phase = PHASE.TRICK_PLAY;
  this.state.currentTrick = {
    trickIndex: this.state.completedTricks.length,
    leaderSeat: winnerSeat,
    plays: [],
    points: 0,
  };
  this.state.currentLedSuit = null;
  this.state.activeSeat = winnerSeat;
  this.state.gameMessage = `Next trick led by ${formatSeat(winnerSeat, false)}.`;
  this._appendLog("TRICK_STARTED");
  return { ok: true };
}
```

Add a `TRICK_RESULT` prompt and `advanceTrick()` declaration to `index.d.ts`. Update the complete-hand drivers in `test/engine-contract.test.mjs` and `packages/game-engine/test/second-bidding.test.mjs` so they call `advanceTrick()` when phase is `trick_result`.

- [ ] **Step 4: Run focused tests and engine typecheck**

Run:

```bash
pnpm --filter @three-zero-four/game-engine test
pnpm test
pnpm --filter @three-zero-four/game-engine typecheck
```

Expected: all engine and root tests pass with the new pause phase.

- [ ] **Step 5: Commit the engine phase**

```bash
git add packages/game-engine/src/engine.js packages/game-engine/src/index.d.ts packages/game-engine/test/public-api.test.mjs packages/game-engine/test/second-bidding.test.mjs test/engine-contract.test.mjs
git commit -m "feat(engine): pause after completed tricks"
```

---

### Task 2: Preserve face-down privacy through results

**Files:**
- Modify: `packages/game-engine/test/public-api.test.mjs`
- Modify: `packages/game-engine/src/engine.js`

**Interfaces:**
- Consumes: `_isPlayPubliclyVisible(play)`, `_projectTrickForPublic(trick)`, `_projectWonCardForViewer(card, viewerSeatIndex)`, and `trump.isOpen`.
- Produces: consistent card-back projections and concealed point values in `trick_result`, `hand_result`, and `match_complete`.

- [ ] **Step 1: Write failing privacy tests for result phases**

Extend the existing face-down privacy fixture with a non-trump face-down play and assert in both result phases:

```js
engine.state.phase = "hand_result";
assert.deepEqual(engine.getPublicState(0).completedTricks[0].plays[1].card, {
  cardId: "Card Back",
  hidden: true,
});

engine.state.phase = "match_complete";
assert.deepEqual(engine.getPublicState(0).completedTricks[0].plays[1].card, {
  cardId: "Card Back",
  hidden: true,
});
```

Also assert that when `trump.isOpen = true`, a face-down play matching `trump.suit` is visible while a face-down play of another suit remains hidden.

- [ ] **Step 2: Run the privacy tests and verify the red state**

Run:

```bash
pnpm --filter @three-zero-four/game-engine exec node --test --test-name-pattern "face-down" test/public-api.test.mjs
```

Expected: FAIL because result phases currently reveal every face-down play.

- [ ] **Step 3: Remove the blanket result reveal**

Reduce `_isPlayPubliclyVisible(play)` to:

```js
_isPlayPubliclyVisible(play) {
  if (!play?.faceDown) return true;
  return Boolean(
    this.state.trump?.isOpen &&
      play.card?.suit &&
      play.card.suit === this.state.trump.suit,
  );
}
```

Do not change internal scoring cards or hand-result totals.

- [ ] **Step 4: Re-run privacy and full engine tests**

Run:

```bash
pnpm --filter @three-zero-four/game-engine test
pnpm test
```

Expected: all tests pass and concealed trick points remain partial until the corresponding plays are public.

- [ ] **Step 5: Commit the privacy fix**

```bash
git add packages/game-engine/src/engine.js packages/game-engine/test/public-api.test.mjs
git commit -m "fix(engine): keep unrevealed cards concealed"
```

---

### Task 3: Durable two-second trick advancement

**Files:**
- Create: `infra/postgres/migrations/0005_trick_advance_automation.sql`
- Modify: `apps/game-service/src/domain/room-store.ts`
- Modify: `apps/game-service/src/domain/room-maintenance.ts`
- Modify: `apps/game-service/src/domain/room-coordinator.ts`
- Modify: `apps/game-service/test/realtime-store.integration.test.ts`
- Modify: `apps/game-service/test/room-automation.integration.test.ts`
- Modify: `apps/game-service/test/room-simulation.test.ts`
- Modify: `apps/game-service/test/recovery-fuzz.integration.test.ts`
- Modify: `apps/game-service/test/durable-rooms.integration.test.ts`
- Modify: `apps/game-service/test/realtime-multiclient.integration.test.ts`
- Modify: `test/room-flow.test.mjs`

**Interfaces:**
- Consumes: `AutomationJobKind`, `scheduleNextAutomation()`, `runAutomation(job)`, event-version idempotency, and `GameEngine.advanceTrick()`.
- Produces: job kind `TRICK_ADVANCE`, injected `automation.trickRevealDelayMs`, durable `TRICK_ADVANCED` events, and normal automation rescheduling after the pause.

- [ ] **Step 1: Write failing store and coordinator tests**

Add `TRICK_ADVANCE` to test-only job unions, then create an integration test that persists a `trick_result` snapshot and calls scheduling through a room command. Assert one pending job:

```ts
expect(job).toMatchObject({
  kind: "TRICK_ADVANCE",
  targetSeatIndex: winnerSeat,
  expectedEventVersion: pausedVersion,
});
expect(job.dueAt.getTime() - beforeSchedule).toBeGreaterThanOrEqual(1_900);
expect(job.dueAt.getTime() - beforeSchedule).toBeLessThanOrEqual(2_100);
```

Force the job due, run it, and assert `TRICK_ADVANCED`, the next `trick_play` projection, and one normal turn job. Run it again and assert `stale` with no duplicate score or event.

- [ ] **Step 2: Run the focused integration tests and verify the red state**

Run with the repository integration database and Redis environment:

```bash
pnpm --filter @three-zero-four/game-service exec vitest run test/realtime-store.integration.test.ts test/room-automation.integration.test.ts
```

Expected: FAIL because the job kind, migration constraint, scheduling path, and engine advancement path do not exist.

- [ ] **Step 3: Add the migration and job type**

Create migration `0005_trick_advance_automation.sql`:

```sql
ALTER TABLE room_automation_jobs
  DROP CONSTRAINT room_automation_jobs_kind_check;

ALTER TABLE room_automation_jobs
  ADD CONSTRAINT room_automation_jobs_kind_check
  CHECK (kind IN ('BOT_ACTION', 'TURN_TIMEOUT', 'DISCONNECT_GRACE', 'TRICK_ADVANCE'));
```

Add `"TRICK_ADVANCE"` to `AutomationJobKind`, parsing, and maintenance cancellation sets. Include it in `scheduleNextAutomation()`'s obsolete-job cancellation so a newer room version cannot retain an old pause job.

- [ ] **Step 4: Schedule and process authoritative advancement**

Extend coordinator automation options:

```ts
automation?: {
  botActionDelayMs: number;
  disconnectGraceSeconds?: number;
  trickRevealDelayMs?: number;
};
```

In `scheduleNextAutomation()`, when `engine.state.phase === "trick_result"`, schedule only:

```ts
await this.store.scheduleAutomation(transaction, {
  id: randomUUID(),
  roomId: room.id,
  expectedEventVersion: room.eventVersion,
  kind: "TRICK_ADVANCE",
  targetSeatIndex: engine.state.currentTrick.winnerSeat,
  dueAt: new Date(Date.now() + (this.automation?.trickRevealDelayMs ?? 2_000)),
});
return;
```

Handle `TRICK_ADVANCE` before active-seat validation in `runAutomation()`. Validate phase and winner, call `advanceTrick()`, append a `TRICK_ADVANCED` event, then call `scheduleNextAutomation()` with the new version. Extend event replay so `TRICK_ADVANCED` calls `engine.advanceTrick()` and rejects recovery if that transition is not valid.

- [ ] **Step 5: Update simulation and recovery drivers**

Where engine-direct test simulations currently require a numeric active seat for every in-hand phase, handle:

```ts
if (engine.state.phase === "trick_result") {
  expect(engine.advanceTrick().ok).toBe(true);
  continue;
}
```

Add recovery coverage proving a hydrated paused snapshot advances once without duplicate trick points.

Where room-level tests drive visible commands until `hand_result`, allow `trick_result` to advance through the durable worker or focused test server automation instead of looking up a human session for a null active seat. Update affected durable-room, realtime, and legacy room-flow helpers rather than bypassing the server pause.

- [ ] **Step 6: Run service integration, unit, and type checks**

Run:

```bash
pnpm --filter @three-zero-four/game-service test
pnpm --filter @three-zero-four/game-service typecheck
pnpm typecheck
```

Expected: all enabled service tests and typechecks pass.

- [ ] **Step 7: Commit durable advancement**

```bash
git add infra/postgres/migrations/0005_trick_advance_automation.sql apps/game-service/src apps/game-service/test
git commit -m "feat(service): advance completed tricks durably"
```

---

### Task 4: Bid ownership and result explanation UI

**Files:**
- Modify: `apps/web/test/browser-fixtures.ts`
- Modify: `apps/web/test/game-table.test.tsx`
- Modify: `apps/web/src/components/game-table.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `publicState.bidding.currentBid`, `publicState.bidding.currentBidSeat`, public seat `team`, `displayName`, and `seatLabel`, plus `handResult` totals.
- Produces: derived bidder text, explicit success/failure explanation, and responsive metric supporting text.

- [ ] **Step 1: Write failing UI tests for live and result bidder ownership**

Update fixtures so Seat 1 is `dd`, Team A, current bidder. Assert the active table contains:

```tsx
expect(screen.getByText("300")).toBeTruthy();
expect(screen.getByText("Team A · dd (Seat 1)")).toBeTruthy();
```

For a failed result with 223 bidder points and 81 opponent points, assert:

```tsx
expect(screen.getByRole("heading", { name: "Team B wins the hand" })).toBeTruthy();
expect(screen.getByText("Team A · dd (Seat 1) bid 300")).toBeTruthy();
expect(screen.getByText("Team A scored 223 and missed by 77")).toBeTruthy();
```

Add a successful-bid assertion for “met the 300 bid” and a malformed bidder-seat fallback assertion.

- [ ] **Step 2: Run the GameTable tests and verify the red state**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx
```

Expected: FAIL because the table only renders the amount and the result uses generic labels.

- [ ] **Step 3: Derive and render bidder ownership**

Inside `GameTable`, derive:

```ts
const bidderSeat = publicState.seats.find(
  (seat) => seat.index === publicState.bidding.currentBidSeat,
);
const bidderTeam = publicState.handResult?.bidderTeam ?? bidderSeat?.team;
const bidderOwner = bidderSeat
  ? `Team ${bidderSeat.team} · ${bidderSeat.displayName} (${bidderSeat.seatLabel})`
  : bidderTeam
    ? `Team ${bidderTeam}`
    : "Bidder unavailable";
```

Render `bidderOwner` beneath the Bid metric. For scored results, calculate `margin = Math.abs(bidderTeamPoints - bid)` and render explicit owner, outcome, and winning-team sentences. Keep no-score behavior unchanged.

- [ ] **Step 4: Add responsive supporting-text styles**

Add a `.metric-detail` rule with block display, subdued readable color, smaller type, normal wrapping, and a small top gap. Ensure high contrast overrides it to white and mobile table metrics do not overflow.

- [ ] **Step 5: Run focused web tests and typecheck**

Run:

```bash
pnpm --filter @three-zero-four/web exec vitest run test/game-table.test.tsx test/accessibility.test.tsx
pnpm --filter @three-zero-four/web typecheck
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 6: Commit bid clarity UI**

```bash
git add apps/web/test/browser-fixtures.ts apps/web/test/game-table.test.tsx apps/web/src/components/game-table.tsx apps/web/src/app/globals.css
git commit -m "feat(web): explain bid ownership and outcomes"
```

---

### Task 5: Browser acceptance for pause and privacy

**Files:**
- Modify: `apps/web/e2e/practice-and-room.spec.ts`

**Interfaces:**
- Consumes: live room projections, visible Current trick cards, legal-action controls, and hand-result copy.
- Produces: end-to-end evidence for the two-second pause, hidden card backs, and bid-owner/result presentation.

- [ ] **Step 1: Add a failing Playwright pause assertion**

During a practice hand, detect a full Current trick and record time. Assert the trick still has four (or six) visual cards and no legal action is available for at least 1,500ms, then assert the next trick becomes actionable within 3,500ms.

- [ ] **Step 2: Add privacy and result-copy assertions**

Drive a deterministic closed-trump state containing a face-down non-trump play. At result, assert its accessible label is `Hidden card, played by Seat N`, its element has `data-hidden="true"`, and no rank or suit text leaks. Assert the result names the bid owner and explains met/missed margin.

- [ ] **Step 3: Run the focused browser test**

Run against rebuilt local services:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test e2e/practice-and-room.spec.ts
```

Expected after implementation: focused Playwright scenarios pass without console errors.

- [ ] **Step 4: Commit browser acceptance**

```bash
git add apps/web/e2e/practice-and-room.spec.ts
git commit -m "test(web): cover trick pause and hidden results"
```

---

### Task 6: Full verification and merge readiness

**Files:**
- Verify only.

**Interfaces:**
- Consumes: all prior tasks and the local Docker Compose stack.
- Produces: fresh repository, build, database, browser, visual, and branch-state evidence.

- [ ] **Step 1: Run complete repository validation and build**

```bash
pnpm check
pnpm build
```

Expected: lint, all typechecks, root/engine/contracts/service/web tests, and the Next.js production build pass.

- [ ] **Step 2: Rebuild the Compose stack with migration 0005**

```bash
pnpm compose:up
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml ps
curl -fsS http://127.0.0.1:4100/livez
curl -fsS http://127.0.0.1:4100/readyz
```

Expected: migration exits successfully; Postgres, Redis, game service, worker, and web are healthy; both probes succeed.

- [ ] **Step 3: Run the complete browser suite**

```bash
E2E_BASE_URL=http://127.0.0.1:3000 pnpm --filter @three-zero-four/web exec playwright test
```

Expected: every Playwright test passes.

- [ ] **Step 4: Capture desktop and mobile evidence**

Capture screenshots during `trick_result` and `hand_result`. Verify four/six cards remain seat-positioned, hidden cards show backs only, bid owner copy wraps without overlap, and there are no console errors or horizontal document overflow.

- [ ] **Step 5: Audit branch state**

```bash
git status --short --branch
git log --oneline --decorate master..HEAD
git diff --check master...HEAD
```

Expected: clean `feature/trick-pause-bid-clarity`, only intentional commits, and no whitespace errors. Then use `superpowers:finishing-a-development-branch` to merge the verified branch into `master` and rerun the complete validation on the merged result.
