# Trick Pause, Hidden Cards, and Bid Ownership Design

**Date:** 2026-07-14

## Goal

Make completed tricks readable before play continues, preserve closed-trump privacy through the hand result, and make the bidding team and bidding player unmistakable throughout play and scoring.

## Player Experience

Every completed trick remains in the Current trick area for 2,000 milliseconds. During this pause, all four or six played cards remain in their seat-relative positions, the prompt names the winning seat, and no player or bot can act. After the pause, the server advances to the next trick. After the final trick, the same pause occurs before the hand result is shown.

Face-down cards continue to render as the existing patterned `304` card back whenever their identity is not public. A face-down trump card becomes visible when the rules open trump. A face-down non-trump card never becomes visible merely because the trick, hand, or match ended. This follows `docs/product/03_GAME_RULES_AND_VARIANTS.md`, which states that face-down cards that are not trump remain hidden.

The table's Bid metric shows three facts together: amount, bidding team, and bidding player. Example:

```text
Bid
300
Team A · dd (Seat 1)
```

The hand result repeats ownership and explains the outcome instead of relying on the generic phrase “Winning team B.” For a missed bid it reads equivalently to:

```text
Team A · dd (Seat 1) bid 300
Team A scored 223 and missed by 77
Team B wins the hand
```

For a successful bid it states that the bidding team met the bid and won the hand. No-score hands continue to use the existing no-score presentation.

## Authoritative Trick-Pause State

The game engine gains a `trick_result` phase. Resolving a full trick determines the winner, awards cards and points, appends the completed trick, then:

- keeps the resolved trick in `currentTrick`;
- sets `phase` to `trick_result`;
- sets `activeSeat` to `null`;
- records whether advancement should start another trick or finish the hand;
- exposes no legal player actions.

A server-only `advanceTrick()` engine method performs the pending transition. For a non-final trick it creates the next empty trick led by the previous winner and returns to `trick_play`. For the final trick it calls the existing hand-scoring transition and enters `hand_result` or `match_complete`. The method rejects calls outside `trick_result`.

Keeping the pause in authoritative engine state prevents a fast client, reconnect, or bot from moving ahead while other players are still viewing the cards.

## Durable Two-Second Advancement

The game service adds a `TRICK_ADVANCE` automation job kind. Migration `0005_trick_advance_automation.sql` expands the existing database check constraint without changing the non-null target-seat schema; the completed trick's winner seat is stored as the job target for traceability.

Whenever the coordinator snapshots a `trick_result` state, it cancels obsolete turn jobs and schedules one `TRICK_ADVANCE` job for `eventVersion` at `now + 2,000ms`. Processing that job:

1. verifies the room and expected event version;
2. verifies the engine is still in `trick_result` and the winner matches the target seat;
3. invokes `advanceTrick()`;
4. appends a `TRICK_ADVANCED` room event and the new snapshot;
5. schedules the next normal bot action or human timeout.

Existing uniqueness on room, kind, version, and target seat makes scheduling idempotent. Stale jobs remain harmless because version and phase checks return the existing `stale` outcome. The delay is an injected coordinator setting named `trickRevealDelayMs`, with a production default of `2_000`, so integration tests can assert scheduling without sleeping.

## Hidden-Card Projection

`_isPlayPubliclyVisible(play)` no longer treats `hand_result` and `match_complete` as blanket reveal phases. Its rules become:

- face-up plays are public;
- a face-down play is public only when trump is open and the card's suit is the trump suit;
- otherwise the public projection is `{ cardId: "Card Back", hidden: true }` and its points remain concealed.

The same rule applies to Current trick, completed tricks, won-card views, reconnect summaries, hand results, and match results. The engine retains real cards internally for scoring; only projections remain concealed.

## Bid Ownership Presentation

No contract expansion is required. The public state already includes `bidding.currentBid`, `bidding.currentBidSeat`, and public seat records containing team, display name, and seat label. The web table derives a single bidder view from those fields.

The Bid metric shows the amount as the primary value and `Team <team> · <displayName> (<seatLabel>)` as supporting text. The result panel adds a `Bid owner` field and changes the heading and outcome copy to name the bidding team, player, bid amount, scored points, and margin. If legacy or malformed state lacks a valid bidder seat, the UI falls back to the known bidder team without failing the safe table renderer.

## Accessibility and Responsive Behavior

The completed trick retains the existing card image labels and seat-relative layout. The pause prompt is announced through the existing polite live region, for example: “Seat 3 wins the trick. Next trick starts shortly.” Card backs expose only “Hidden card” to assistive technology.

Bid ownership is text, not color-only. Supporting text wraps inside the existing metric grid on narrow screens, and the result panel continues to use semantic headings and definition lists. Reduced-motion settings require no special path because the pause changes state without adding animation.

## Testing

Tests are added before production changes and must demonstrate these regressions:

- engine: completing any non-final trick enters `trick_result`, preserves the full trick, exposes no legal actions, and advances only through `advanceTrick()`;
- engine: the final trick also pauses before hand scoring;
- engine privacy: face-down non-trump cards remain card backs during hand and match results, while an opened face-down trump is public;
- service: `trick_result` schedules exactly one `TRICK_ADVANCE` job at the configured delay, executes idempotently, and then schedules normal automation;
- recovery: a persisted `trick_result` snapshot resumes through the durable job without duplicate scoring;
- web: Bid and result surfaces name the team, player, seat, amount, points, and success or failure margin;
- browser: a completed trick remains visible while actions are absent, then advances after approximately two seconds; hidden non-trump plays remain backs at result; desktop and mobile layouts remain readable.

Final acceptance requires `pnpm check`, `pnpm build`, database migration/integration coverage, the complete Playwright suite against rebuilt Compose images, and screenshot inspection of the pause and result states.

## Scope Boundaries

- The pause is fixed at two seconds for players; no preference control is added.
- Previous-trick history or replay UI is not added.
- Card identities are not added to the hand-result contract.
- The underlying 304 bidding and token-scoring rules do not change.
- Existing card artwork, table theme, and seat positioning remain unchanged.
