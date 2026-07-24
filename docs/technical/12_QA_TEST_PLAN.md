# QA and Test Plan

## 1. Purpose

This document defines the test strategy for 304 Online. Because 304 has complex rules and hidden information, automated tests are essential.

## 2. Testing goals

- Verify game rules.
- Prevent hidden-card leaks.
- Ensure bots always play legal moves.
- Validate room/bot-fill behavior for 1 to 6 humans.
- Confirm reconnect works.
- Keep UI usable on desktop and mobile.
- Prevent regressions in scoring.

## 3. Test pyramid

```text
Highest volume: unit tests for engine and pure functions
Medium volume: integration tests for rooms, sockets, bots
Lower volume: end-to-end browser tests
Manual exploratory tests for UX and regional rule feel
```

## 4. Unit tests

### Card and deck tests

- Classic deck has 32 cards.
- Classic deck total points = 304.
- Four suits exist.
- Rank order is J, 9, A, 10, K, Q, 8, 7.
- Six-seat 36-card deck adds four 6s.
- Sixes are zero points and lowest rank.
- No duplicate card IDs.

### Deal tests

- Four-seat mode deals 4 cards each in first batch.
- Four-seat mode deals 8 total cards each after final deal.
- Six-seat 36-card mode deals 4 first, then 2 more.
- Dealer advances to the right after hand.
- Deal order is counter-clockwise.

### Bidding tests

- First bidder is dealer's right-hand player.
- Minimum Classic bid is 160.
- Bid must exceed current bid.
- Invalid bid increments are rejected.
- All-pass hand cancels with no score.
- Three consecutive passes after a bid ends four-card bidding.
- Below-200 second-turn constraints work if enabled.
- Eight-card bidding accepts only 250+ when enabled.

### Trump tests

- Trump maker can select a valid eligible card.
- Non-trump maker cannot select trump.
- Trump indicator is removed from normal hand zone.
- Trump cannot be revealed to other players in closed mode.
- Open trump reveals suit and returns card to hand.
- 250+ bid reveals trump after first trick when profile enables it.
- Below 250, a completed closed first trick remains closed unless a face-down
  trump cuts.
- A cut reveal projects `face-down-trump-cut`, exposes the other players'
  required trick cards, and retains the maker's face-down non-trump privacy.
- A 250+ reveal projects `high-bid-after-first-trick`, exposes the indicator
  and suit, and retains unrelated face-down non-trump privacy.
- Reveal reason announcements are available to assistive technology without
  naming a concealed card.

### Trick-play tests

- Player must follow suit when able.
- Player may play off-suit when void.
- Highest led-suit card wins when no trump.
- Highest trump wins when trump is open.
- Face-down play is allowed only when trump closed and player cannot follow suit.
- Illegal face-down play is rejected.
- Trick winner leads next trick.
- Dealer's right-hand player leads trick one in both four- and six-seat modes.
- Closed void followers receive only face-down hand actions.
- Closed maker restrictions cover hand trump, indicator cutting, and exhausted
  trumps in both profiles.

### Scoring tests

- Card points in won tricks are counted correctly.
- Bid success when points equal bid.
- Correct token tier for bid less than 200.
- Correct token tier for bid 200-249.
- Correct token tier for bid 250+.
- All-pass hand has no token movement.
- Match complete when target reached.
- With early settlement enabled, settle only after a complete trick at exact
  bid-reached and bid-unreachable boundaries.
- With early settlement disabled, play continues until all tricks complete.
- Early result copy labels both totals as points captured when play stopped.

## 5. Projection and hidden-information tests

These are critical.

Test every phase for each viewer seat:

- Own hand visible.
- Other hands hidden.
- Trump indicator hidden to non-authorized viewers.
- Face-down cards hidden unless revealed.
- Completed hidden cards not leaked in previous trick review.
- Spectator view does not contain hand card IDs.
- Bot context does not contain extra hidden state.
- Reveal and settlement reasons contain no card identity.
- Legacy v1/v2 snapshots and older v3 snapshots hydrate without public reveal
  evidence; current v3 snapshots retain revealed indicator/reason on reconnect.

Example assertion:

```ts
expect(JSON.stringify(playerBView)).not.toContain(playerAHiddenCardId);
```

## 6. Bot tests

### Legal action tests

Run simulated hands:

- Easy bots complete 1,000 hands with no illegal actions.
- Normal bots complete 10,000 hands with no illegal actions.
- Six-seat bots complete 1,000 hands with no illegal actions.
- Seeded bidding calibration covers weak, average, and elite hands; partner
  ownership; all-pass redeals; difficulty ceilings; and ordinary-game
  distributions that do not cluster at 250-300.

### Decision quality tests

Track:

- Average bid amount
- Bid success percentage
- Average points when bidder team
- Frequency of cutting partner's winning trick
- Timeout frequency
- Decision latency

### Hidden-information tests

- Bot function input excludes hidden opponent cards.
- Strong bot simulation uses generated possible hands, not actual hidden hands.

## 7. Room and bot-fill tests

| Human count | Expected active seats | Expected bots |
|---:|---:|---:|
| 1 | 4 | 3 |
| 2 | 4 | 2 |
| 3 | 4 | 1 |
| 4 | 4 | 0 |
| 5 | 6 | 1 |
| 6 | 6 | 0 |

Additional tests:

- Host can start with 1 human.
- Non-host cannot start room.
- Bot seats are labeled.
- Human can replace bot before hand starts if host allows.
- Fifth human cannot join a locked 4-seat room.
- Room closes if no humans remain before start.

## 8. WebSocket integration tests

- Connect to room.
- Receive private room state.
- Send valid bid and receive state update.
- Send invalid card play and receive rejection.
- Two clients receive different private views.
- Reconnect returns same seat.
- Stale action is rejected or safely ignored.
- Bot action is broadcast correctly.

## 9. End-to-end browser tests

Use Playwright or Cypress.

### E2E: Solo practice

1. Open landing page.
2. Click Practice.
3. Confirm 1 human + 3 bots.
4. Play through a complete hand.
5. See score screen.

### E2E: Private room with 2 humans

1. User A creates room.
2. User B joins by link.
3. Host starts.
4. Two bots fill.
5. Both humans can bid/play on their turns.
6. Hand completes.

### E2E: Five-human six-seat room

1. Create auto room.
2. Join with five browser contexts.
3. Start room.
4. Confirm six-seat mode and one bot.
5. Confirm six-card hands.

### E2E: Reconnect

1. Start hand.
2. Disconnect active user.
3. Confirm seat shows disconnected.
4. Reconnect same session.
5. Confirm same hand and correct private cards.

## 10. Accessibility tests

- Cards have ARIA labels.
- Keyboard can select and play cards.
- Focus order follows game flow.
- Color is not the only suit indicator.
- Reduced-motion setting works.
- Text contrast passes target standard.
- Mobile screen reader announces turn prompts.

## 11. Performance tests

### Client

- Initial page load on mobile connection.
- Card animations stay smooth.
- Large state updates do not freeze UI.

### Server

- 100 active rooms with bots.
- 1,000 WebSocket connections idle.
- Bot decision latency under threshold.
- Event log writes stay reliable.

## 12. Manual QA checklist

### Game feel

- Does bidding feel understandable?
- Is trump selection clear?
- Are face-down cards confusing?
- Are bot moves believable enough?
- Does mobile table feel cramped?
- Can a beginner finish a hand without outside help?

### Local rule review

Ask experienced Sri Lankan 304 players to review:

- Bidding flow
- Closed trump behavior
- Token scoring
- Caps handling
- Six-player rule assumptions
- Terminology

## 13. Regression fixtures

Create named fixtures:

```text
fixtures/
  classic_deck_points.json
  classic_all_pass.json
  classic_bid_200_success.json
  closed_trump_cut_reveal.json
  closed_trump_no_reveal.json
  high_bid_250_reveal_after_first_trick.json
  high_bid_250_non_trump_stays_hidden.json
  cut_reveal_maker_discard_stays_hidden.json
  six_36_deal.json
  bot_legal_full_hand.json
```

Each fixture should include:

- Initial state
- Action sequence
- Expected final state
- Expected public/private projections

## 14. Definition of done for QA

QA is acceptable when:

- All P0 unit tests pass.
- Projection tests prove no hidden-card leaks.
- Browser acceptance covers the default early-settlement setting, captured-at-
  stop result copy, conservative bot bidding, closed trump below 250, both
  reveal causes, and accessible reveal announcements.
- Bot simulations complete without illegal actions.
- E2E tests cover 1, 2, 5, and reconnect journeys.
- Manual mobile test passes on at least two screen sizes.
- Rule fixtures are reviewed by a knowledgeable 304 player.
