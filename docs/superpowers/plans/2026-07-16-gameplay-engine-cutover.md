# Gameplay Engine Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@three-zero-four/gameplay` the only authoritative gameplay domain used by the production service, preserve every public and persisted compatibility contract, and remove the legacy engine and root prototype runtime.

**Architecture:** Keep the current modular-monolith topology. Application ports first hide the legacy facade, characterization tests then prove pure-domain parity, and an adapter converts the existing snapshot/event schema to and from the new aggregate until all persisted state remains readable. Cut over recovery, commands, projections, connections, and automation one boundary at a time; delete compatibility code only after the full integration, recovery, release, and Playwright gates pass.

**Tech Stack:** TypeScript 5.9, Node.js 24, Vitest, Node test runner, Fastify, PostgreSQL 18, Redis 8, Docker Compose, Next.js 16, React 19, Playwright 1.61.

## Global Constraints

- Every pull request is small, stacked on the previous pull request, ready for review, and never merged by the agent.
- Preserve `/v1` routes, cookies, WebSocket messages, error codes, command idempotency, event versions, event payloads, snapshot schema version 1, hidden-card behavior, and current UI copy.
- `packages/gameplay` remains deterministic and imports no transport, framework, Node randomness, database, Redis, or UI module.
- Room connection and occupant state belongs to Room Management; Gameplay owns only card-game rules and state.
- Every behavior change follows red-green-refactor and every PR passes `pnpm check && pnpm build && git diff --check`.
- Runtime cutover is not complete until `make integration`, production Compose health, backup/restore, load smoke, and all Playwright tests pass from clean state.

---

### Task 1: Own the recovered-gameplay application port

**Files:**
- Create: `apps/game-service/src/contexts/gameplay/application/recovered-gameplay.ts`
- Modify: `apps/game-service/src/contexts/gameplay/application/gameplay-recovery.ts`
- Modify: `test/architecture-boundaries.test.mjs`
- Test: `apps/game-service/test/legacy-gameplay-command-executor.test.ts`

**Interfaces:**
- Produces: `RecoveredGameplay`, the context-owned behavioral facade returned by `GameplayRecovery.recover()`.
- Consumes: existing schema-version-1 snapshots through `GameplayRecoveryStore`.

- [ ] **Step 1: Add a failing architecture assertion**

```js
assert.doesNotMatch(
  read("apps/game-service/src/contexts/gameplay/application/gameplay-recovery.ts"),
  /@three-zero-four\/game-engine/,
);
```

- [ ] **Step 2: Run the focused architecture test and observe the forbidden import**

Run: `node --test --test-name-pattern "Gameplay recovery owns its runtime port" test/architecture-boundaries.test.mjs`

Expected: FAIL because `gameplay-recovery.ts` imports `GameEngine`.

- [ ] **Step 3: Define the smallest behavioral port used by recovery consumers**

```ts
export interface RecoveredGameplay {
  readonly state: RecoveredGameplayState;
  advanceTrick(): GameplayOperationResult;
  applyAction(action: Record<string, unknown>): GameplayOperationResult;
  applyAutomationAction(
    action: Record<string, unknown>,
    seatIndex: number,
  ): GameplayOperationResult;
  getBotAction(seatIndex: number): Record<string, unknown> | null;
  getLegalActions(seatIndex: number): Array<Record<string, unknown>>;
  getPrompt(viewerSeatIndex?: number | null): string;
  getPublicState(viewerSeatIndex?: number | null): Record<string, unknown>;
  getSeatView(
    viewerSeatIndex: number,
    seatIndex?: number,
  ): Record<string, unknown> | null;
  getSnapshot(): unknown;
}
```

Change `GameplayRecovery.recover()` to return `Promise<RecoveredGameplay>`. The current `GameEngine` adapter satisfies the port structurally, so behavior remains unchanged.

- [ ] **Step 4: Run focused tests and the full gate**

Run: `node --test --test-name-pattern "Gameplay recovery owns its runtime port" test/architecture-boundaries.test.mjs && pnpm --filter @three-zero-four/game-service test && pnpm check && pnpm build && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit and publish the stacked PR**

```bash
git add apps/game-service/src/contexts/gameplay/application test/architecture-boundaries.test.mjs
git commit -m "refactor(gameplay): own recovered runtime port"
```

### Task 2: Own the automation scheduling view

**Files:**
- Modify: `apps/game-service/src/contexts/automation/application/automation-scheduler.ts`
- Modify: `apps/game-service/src/contexts/automation/application/automation-policy.ts`
- Modify: `apps/game-service/src/contexts/automation/adapters/integration/legacy-gameplay-automation-scheduler.ts`
- Modify: `test/architecture-boundaries.test.mjs`
- Test: `apps/game-service/test/legacy-gameplay-automation-scheduler.test.ts`

**Interfaces:**
- Produces: `AutomatableGameplay`, containing only phase, active-seat, completed-trick, and seat automation data.
- Consumes: no Gameplay application import; Automation owns this query shape.

- [ ] **Step 1: Add a failing assertion that Automation application code cannot import `GameEngine`**
- [ ] **Step 2: Observe the focused architecture failure**
- [ ] **Step 3: Replace the engine parameter with `AutomatableGameplay` and make policy functions consume that view**
- [ ] **Step 4: Run scheduler tests and the full gate**
- [ ] **Step 5: Commit `refactor(automation): own scheduling gameplay view` and publish the stacked PR**

### Task 3: Characterize old and new gameplay transitions

**Files:**
- Create: `packages/gameplay/test/legacy-parity.test.ts`
- Create: `packages/gameplay/test/fixtures/legacy-transition-parity.json`
- Modify: `packages/gameplay/package.json`

**Interfaces:**
- Produces: deterministic fixtures for both rule profiles covering bidding, second bidding, trump selection/mode, every trick, scoring, and next-hand acknowledgement.
- Consumes: legacy fixture generation only in the test tool; production `packages/gameplay/src` never imports the old engine.

- [ ] **Step 1: Generate fixed decks and legacy expected transitions for four-seat and six-seat profiles**
- [ ] **Step 2: Add a parity test that fails at the first missing new-domain transition**
- [ ] **Step 3: Keep fixture fields limited to observable gameplay state, legal actions, and hidden-information projections**
- [ ] **Step 4: Run `pnpm --filter @three-zero-four/gameplay test` and retain the expected RED result for Task 4**
- [ ] **Step 5: Commit `test(gameplay): characterize legacy transition parity` and publish the stacked PR**

### Task 4: Complete aggregate hand and match progression

**Files:**
- Modify: `packages/gameplay/src/aggregate.ts`
- Modify: `packages/gameplay/src/messages.ts`
- Modify: `packages/gameplay/src/index.ts`
- Test: `packages/gameplay/test/aggregate-transitions.test.ts`
- Test: `packages/gameplay/test/legacy-parity.test.ts`

**Interfaces:**
- Produces: `advanceGameplayTrick(hand)` and `acknowledgeGameplayResult(hand, nextDeck)` with explicit entropy input.
- Consumes: `GameplayHand`, `nextDealer`, `startGameplayHand`, and the existing scoring result.

- [ ] **Step 1: Add failing tests for final-trick pause, hand result, match result, dealer rotation, token carry-over, and new-hand start**
- [ ] **Step 2: Observe each focused failure**
- [ ] **Step 3: Implement pure transitions without clock or randomness imports**
- [ ] **Step 4: Run aggregate, parity, and package tests**
- [ ] **Step 5: Commit `feat(gameplay): complete hand progression` and publish the stacked PR**

### Task 5: Own legal actions, prompts, and bot choice in Gameplay

**Files:**
- Create: `packages/gameplay/src/legal-actions.ts`
- Create: `packages/gameplay/src/prompt.ts`
- Create: `packages/gameplay/src/bot-policy.ts`
- Modify: `packages/gameplay/src/index.ts`
- Test: `packages/gameplay/test/legal-actions.test.ts`
- Test: `packages/gameplay/test/bot-policy.test.ts`
- Test: `packages/gameplay/test/legacy-parity.test.ts`

**Interfaces:**
- Produces: `legalGameplayCommands(hand, actor)`, `gameplayPrompt(hand, viewer)`, and `chooseGameplayBotCommand(hand, actor, random)`.
- Consumes: pure aggregate state plus an injected `RandomSource`.

- [ ] **Step 1: Add failing parity tests for every phase and hidden-trump bot decisions**
- [ ] **Step 2: Observe the focused failures**
- [ ] **Step 3: Implement legal commands and prompts from domain policy**
- [ ] **Step 4: Implement bot choice using only legal commands and injected randomness**
- [ ] **Step 5: Run all Gameplay tests, commit `feat(gameplay): own actions prompts and bots`, and publish the stacked PR**

### Task 6: Decode and encode the persisted compatibility snapshot

**Files:**
- Create: `apps/game-service/src/contexts/gameplay/adapters/persistence/domain-gameplay-snapshot-codec.ts`
- Modify: `apps/game-service/src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.ts`
- Test: `apps/game-service/test/gameplay-snapshot-codec.test.ts`
- Test: `apps/game-service/test/room-store.integration.test.ts`

**Interfaces:**
- Produces: `decodeGameplayHand(snapshot)` and `encodeGameplayHand(hand, compatibilityMetadata)`.
- Consumes: schema-version-1 snapshot JSON and `@three-zero-four/gameplay` value constructors.

- [ ] **Step 1: Add failing round-trip tests for real lobby, in-hand, trick-result, hand-result, and match-result snapshots**
- [ ] **Step 2: Observe decode failures before implementation**
- [ ] **Step 3: Decode with exhaustive validation and return `RecoveryError` for unsupported state**
- [ ] **Step 4: Encode byte-shape-compatible JSON and prove old snapshots remain readable**
- [ ] **Step 5: Run codec plus integration tests, commit `feat(gameplay): map compatibility snapshots`, and publish the stacked PR**

### Task 7: Project the domain aggregate to the existing wire contract

**Files:**
- Create: `apps/game-service/src/contexts/gameplay/adapters/delivery/domain-gameplay-room-presenter.ts`
- Modify: `apps/game-service/src/contexts/gameplay/adapters/delivery/game-action-presenter.ts`
- Test: `apps/game-service/test/gameplay-room-presenter.test.ts`
- Test: `apps/game-service/test/room-projection-query-adapter.test.ts`

**Interfaces:**
- Produces: the unchanged `RoomProjection` DTO for one viewer.
- Consumes: `GameplayHand`, room record, room-owned seats, legal commands, and `projectGameplayHand`.

- [ ] **Step 1: Add failing equality tests against legacy public/private projections for both profiles**
- [ ] **Step 2: Observe the focused mismatch**
- [ ] **Step 3: Map domain projection, prompt, legal actions, host policy, and room metadata to the wire DTO**
- [ ] **Step 4: Prove opponent cards and closed trump remain hidden**
- [ ] **Step 5: Run projection tests, commit `feat(gameplay): project domain room views`, and publish the stacked PR**

### Task 8: Cut human gameplay commands over to the domain aggregate

**Files:**
- Create: `apps/game-service/src/contexts/gameplay/adapters/integration/domain-gameplay-command-executor.ts`
- Modify: `apps/game-service/src/bootstrap/server-runtime.ts`
- Test: `apps/game-service/test/submit-gameplay-command.test.ts`
- Test: `apps/game-service/test/durable-rooms.integration.test.ts`

**Interfaces:**
- Produces: `DomainGameplayCommandExecutor`, implementing `GameplayCommandExecutor`.
- Consumes: recovery, snapshot codec, room lease/store, automation scheduler, domain presenter, and injected entropy.

- [ ] **Step 1: Add a failing bootstrap architecture assertion requiring the domain executor**
- [ ] **Step 2: Observe the focused failure**
- [ ] **Step 3: Translate wire action to `GameplayCommand`, apply the pure aggregate, atomically persist the unchanged event/snapshot, and return the domain projection**
- [ ] **Step 4: Run command, deduplication, integration, and recovery tests**
- [ ] **Step 5: Commit `feat(gameplay): execute commands through domain aggregate` and publish the stacked PR**

### Task 9: Separate room connection state from gameplay state

**Files:**
- Create: `apps/game-service/src/contexts/rooms/application/update-room-connection.ts`
- Modify: `apps/game-service/src/contexts/gameplay/adapters/integration/legacy-gameplay-connections.ts`
- Modify: `apps/game-service/src/bootstrap/server-runtime.ts`
- Test: `apps/game-service/test/legacy-gameplay-connections.test.ts`
- Test: `apps/game-service/test/realtime-multiclient.integration.test.ts`

**Interfaces:**
- Produces: a Rooms use case that owns reconnect, disconnect, and autopilot cancellation persistence/events.
- Consumes: Rooms lease, presence, seats, command writer, and the Gameplay scheduling port.

- [ ] **Step 1: Add failing tests proving connection changes do not mutate card-game state**
- [ ] **Step 2: Observe the focused failure**
- [ ] **Step 3: Move connection-state decisions and events to Rooms while preserving event versions and snapshots**
- [ ] **Step 4: Run realtime multi-client and reconnect recovery tests**
- [ ] **Step 5: Commit `refactor(rooms): own player connection transitions` and publish the stacked PR**

### Task 10: Cut automation execution and scheduling over

**Files:**
- Create: `apps/game-service/src/contexts/automation/adapters/integration/domain-gameplay-automation-executor.ts`
- Create: `apps/game-service/src/contexts/automation/adapters/integration/domain-gameplay-automation-scheduler.ts`
- Modify: `apps/game-service/src/bootstrap/server-runtime.ts`
- Modify: `apps/game-service/src/bootstrap/worker-runtime.ts`
- Test: `apps/game-service/test/automation-worker.test.ts`
- Test: `apps/game-service/test/room-automation.integration.test.ts`

**Interfaces:**
- Produces: domain-backed bot, timeout, disconnect-grace, and trick-advance jobs.
- Consumes: domain legal actions/bot policy, Rooms seat state, recovery, persistence, and Automation-owned scheduling view.

- [ ] **Step 1: Add failing tests for each durable job kind through the new adapters**
- [ ] **Step 2: Observe the focused failures**
- [ ] **Step 3: Implement automation via the same domain commands used by humans**
- [ ] **Step 4: Run worker, full-hand, trick-pause, reconnect, and integration tests**
- [ ] **Step 5: Commit `feat(automation): execute domain gameplay commands` and publish the stacked PR**

### Task 11: Cut recovery replay over and retire legacy adapters

**Files:**
- Create: `apps/game-service/src/contexts/gameplay/adapters/persistence/domain-gameplay-recovery.ts`
- Modify: `apps/game-service/src/bootstrap/server-runtime.ts`
- Modify: `apps/game-service/src/bootstrap/worker-runtime.ts`
- Delete: `apps/game-service/src/contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.ts`
- Delete: `apps/game-service/src/contexts/gameplay/adapters/engine/legacy-engine-factory.ts`
- Delete: `apps/game-service/src/contexts/gameplay/adapters/engine/legacy-engine-seat-mapper.ts`
- Delete: remaining `legacy-gameplay-*` and `legacy-started-room-*` adapters after their consumers are gone
- Test: `apps/game-service/test/recovery-fuzz.integration.test.ts`

**Interfaces:**
- Produces: domain recovery from snapshot plus accepted events.
- Consumes: schema-version-1 codec, room seats, domain command translation, and `GameplayRecoveryStore`.

- [ ] **Step 1: Add a failing architecture assertion that production source has no legacy gameplay adapter imports**
- [ ] **Step 2: Observe the focused failure**
- [ ] **Step 3: Replay every supported event into the domain aggregate and mark invalid histories `recovery_failed`**
- [ ] **Step 4: Run all 24 snapshot-deletion variants and invalid-event recovery tests in Compose**
- [ ] **Step 5: Delete unused adapters/tests, commit `refactor(gameplay): recover domain aggregates`, and publish the stacked PR**

### Task 12: Remove migration scaffolding and prove release parity

**Files:**
- Delete: `packages/game-engine/`
- Delete: root static prototype runtime files after confirming they are unreferenced
- Modify: `pnpm-workspace.yaml`
- Modify: root `package.json`
- Modify: `apps/game-service/package.json`
- Modify: `apps/game-service/Dockerfile`
- Modify: `docs/technical/14_DOMAIN_DRIVEN_ARCHITECTURE.md`
- Modify: `README.md`
- Test: `test/architecture-boundaries.test.mjs`
- Test: `test/production-foundation-workspace.test.mjs`

**Interfaces:**
- Produces: one authoritative Gameplay domain and no legacy runtime package.
- Consumes: all prior cutover tasks.

- [ ] **Step 1: Add failing assertions for no `@three-zero-four/game-engine`, no legacy adapter paths, and no root prototype runtime entrypoint**
- [ ] **Step 2: Observe the focused failures**
- [ ] **Step 3: Remove workspace/package/build references and update architecture status from migration to operational**
- [ ] **Step 4: Run `pnpm check`, `pnpm build`, `make integration`, production Compose health, backup/restore, load smoke, and all Playwright tests from clean state**
- [ ] **Step 5: Commit `refactor(gameplay): retire legacy engine runtime`, publish the final stacked PR, and run the requirement-by-requirement completion audit without merging any PR**
