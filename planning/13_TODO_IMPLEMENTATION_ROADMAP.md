# Todo List and Implementation Roadmap

## 1. Roadmap overview

Recommended build order:

1. Foundations
2. Game engine
3. Local playable prototype
4. Realtime rooms
5. Bot fill
6. Scoring and match loop
7. Reconnect and stability
8. UI polish and tutorial
9. Six-seat variant
10. Beta/release readiness

## 2. Phase 0: Product and project setup

### Product decisions

- [ ] Confirm product name.
- [ ] Confirm default rule profile name: Classic 304.
- [ ] Confirm whether MVP includes six-seat mode or only engine support.
- [ ] Confirm scoring mode default: Traditional or Short Mode.
- [ ] Confirm whether Caps is MVP, P1, or disabled at launch.
- [ ] Confirm whether spoilt trump is disabled at launch.
- [ ] Confirm whether users can play as guests.

### Repository setup

- [ ] Create monorepo.
- [ ] Add TypeScript config.
- [ ] Add linting and formatting.
- [ ] Add test framework.
- [ ] Add CI pipeline.
- [ ] Add environment variable management.

## 3. Phase 1: Game engine foundation

### Card model

- [ ] Define `Suit`, `Rank`, `Card`, `CardId`.
- [ ] Implement Classic 32-card deck.
- [ ] Implement 36-card six-seat deck.
- [ ] Implement rank order comparison.
- [ ] Implement card point values.
- [ ] Add deck total point tests.

### Rule profiles

- [ ] Define `RuleProfile` interface.
- [ ] Create `classic_304_4p` profile.
- [ ] Create draft `six_304_36` profile.
- [ ] Add token scoring config.
- [ ] Add feature toggles for Caps/spoilt trump.

### Game state

- [ ] Define `GameState`.
- [ ] Define `SeatState` and `TeamState`.
- [ ] Define `BiddingState`.
- [ ] Define `TrumpState`.
- [ ] Define `TrickState`.
- [ ] Define `ScoringState`.

## 4. Phase 2: Engine rules

### Dealing

- [ ] Implement secure shuffle input adapter.
- [ ] Implement deterministic deck shuffle for tests.
- [ ] Implement first deal batch.
- [ ] Implement final deal batch.
- [ ] Implement dealer rotation.
- [ ] Test counter-clockwise deal order.

### Bidding

- [ ] Implement four-card bidding phase.
- [ ] Implement pass.
- [ ] Implement minimum bid validation.
- [ ] Implement bid increment validation.
- [ ] Implement three-consecutive-pass ending.
- [ ] Implement all-pass cancellation.
- [ ] Implement below-200 constraints.
- [ ] Implement second bidding round.
- [ ] Add bidding fixtures.

### Trump

- [ ] Implement trump indicator selection.
- [ ] Restrict indicator to eligible cards.
- [ ] Move selected card to trump indicator zone.
- [ ] Implement open trump choice.
- [ ] Implement closed trump state.
- [ ] Implement high-bid reveal-after-first-trick rule.
- [ ] Add trump selection tests.

### Trick play

- [ ] Implement legal card detection.
- [ ] Implement follow-suit enforcement.
- [ ] Implement face-down play in closed trump.
- [ ] Implement trick winner resolution.
- [ ] Implement trick pile assignment.
- [ ] Implement next leader assignment.
- [ ] Add trick fixtures.

### Scoring

- [ ] Count card points by team.
- [ ] Compare bidder team points against final bid.
- [ ] Apply token movement.
- [ ] Detect match completion.
- [ ] Add scoring fixtures.

## 5. Phase 3: Local prototype

Build a local single-browser prototype before WebSockets.

- [ ] Create Next.js app.
- [ ] Render table layout.
- [ ] Render player hand.
- [ ] Render bid panel.
- [ ] Render trump panel.
- [ ] Render trick area.
- [ ] Render score panel.
- [ ] Connect UI to local engine state.
- [ ] Add simple debug controls.
- [ ] Play a full hand locally with 4 scripted players.

## 6. Phase 4: Backend and realtime rooms

### Backend setup

- [ ] Create server app.
- [ ] Add WebSocket gateway.
- [ ] Add REST API for room creation.
- [ ] Add guest session support.
- [ ] Add room service.
- [ ] Add in-memory active room state.
- [ ] Add event log persistence.

### Room flow

- [ ] Create room endpoint.
- [ ] Join room by invite code.
- [ ] Seat selection.
- [ ] Ready toggle.
- [ ] Host start.
- [ ] Room state broadcast.
- [ ] Private game view broadcast.

### Game action flow

- [ ] Client sends bid action.
- [ ] Server validates and reduces.
- [ ] Server appends event.
- [ ] Server broadcasts private views.
- [ ] Client handles rejected action.

## 7. Phase 5: Bot fill and bot AI

### Bot fill

- [ ] Implement bot identity generation.
- [ ] Implement fill-empty-seats on game start.
- [ ] Label bot seats in UI.
- [ ] Allow host to choose bot difficulty.
- [ ] Add bot count to room summary.

### Bot decisions

- [ ] Implement legal-action bot baseline.
- [ ] Implement simple bidding heuristic.
- [ ] Implement trump choice heuristic.
- [ ] Implement trick play heuristic.
- [ ] Add bot delays.
- [ ] Add bot simulation test harness.

### Autopilot

- [ ] Detect disconnected active player.
- [ ] Start grace timer.
- [ ] Trigger autopilot after timeout.
- [ ] Stop autopilot on reconnect.

## 8. Phase 6: Complete match loop

- [ ] Hand scoring screen.
- [ ] Token movement animation.
- [ ] Match score persistence.
- [ ] Dealer rotation after hand.
- [ ] Rematch button.
- [ ] Leave after hand.
- [ ] Replace bot after hand.
- [ ] Match complete screen.

## 9. Phase 7: Reconnect and reliability

- [ ] Persist room/session mapping.
- [ ] Reconnect to same seat.
- [ ] Send latest private snapshot.
- [ ] Handle duplicate connections.
- [ ] Handle stale event versions.
- [ ] Add room cleanup job.
- [ ] Add crash recovery test from snapshot + events.

## 10. Phase 8: UX polish and tutorial

- [ ] Add landing page.
- [ ] Add rule summary drawer.
- [ ] Add card value reference.
- [ ] Add contextual action prompts.
- [ ] Add illegal move explanations.
- [ ] Add beginner bidding hints.
- [ ] Add mobile layout.
- [ ] Add keyboard navigation.
- [ ] Add screen-reader labels.
- [ ] Add reduced-motion setting.

## 11. Phase 9: Six-seat variant

- [ ] Finalize six-seat rule profile.
- [ ] Implement 6-seat table layout.
- [ ] Implement 36-card deal: 4 + 2 cards.
- [ ] Validate 3v3 team seating.
- [ ] Update bot fill for 5 humans.
- [ ] Add six-seat bot simulations.
- [ ] Add six-seat E2E test.
- [ ] Label mode clearly as variant.

## 12. Phase 10: Beta readiness

### Quality

- [ ] Complete P0 engine tests.
- [ ] Complete hidden projection tests.
- [ ] Complete bot simulation tests.
- [ ] Complete core E2E tests.
- [ ] Conduct manual rule review with experienced players.

### Operations

- [ ] Add error monitoring.
- [ ] Add basic analytics.
- [ ] Add rate limits.
- [ ] Add room cleanup.
- [ ] Add health checks.
- [ ] Add production deploy pipeline.

### Documentation

- [ ] Write user-facing rules page.
- [ ] Write privacy policy.
- [ ] Write terms of use.
- [ ] Write release notes.

## 13. MVP cut checklist

The app is MVP-ready when:

- [ ] Classic 4-seat game is playable from start to scoring.
- [ ] Rooms support 1 to 4 humans with bot fill.
- [ ] Bot players can finish hands legally.
- [ ] Server validates all actions.
- [ ] Hidden cards are not leaked.
- [ ] Reconnect works.
- [ ] UI works on mobile and desktop.
- [ ] No real-money betting/wagering exists.
- [ ] Basic tutorial/rule help exists.

## 14. Suggested milestones

### Milestone A: Engine proof

Deliverable: engine test suite can play scripted hand.

### Milestone B: Local playable

Deliverable: one browser can play with local bots/no server.

### Milestone C: Realtime room

Deliverable: two browsers can join room and play actions.

### Milestone D: Bot-fill MVP

Deliverable: 1 to 4 humans can start Classic with bots.

### Milestone E: Public beta

Deliverable: stable private-room web app with reconnect and tutorial.

### Milestone F: Six-player beta

Deliverable: 5 to 6 humans can play six-seat variant with bot fill.
