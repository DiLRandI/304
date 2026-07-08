# Game Rules and Variant Specification

## 1. Purpose

This document converts public 304 rules into a product-ready rule specification. It separates:

- **Source-backed Classic rules**
- **Explicit product decisions**
- **Configurable variants**
- **Rules deferred until after MVP**

304 has local differences. The app should not claim that every table plays the same way. Instead, it should ship with named rule profiles.

## 2. Classic 304 summary

Classic 304 is a partnership point-trick game.

| Area | Classic rule |
|---|---|
| Players | 4 players |
| Teams | 2 teams of 2 |
| Seating | Partners sit opposite each other |
| Direction | Deal and play counter-clockwise |
| Deck | 32 cards: 7, 8, 9, 10, J, Q, K, A in four suits |
| Cards per player | 8 |
| Goal | Bid for the right to choose trump and win at least the bid value in card points |
| Total card points | 304 |

## 3. Card rank and point values

Rank order is unusual compared with most standard card games. In all suits, from highest to lowest:

| Rank | Point value |
|---|---:|
| J | 30 |
| 9 | 20 |
| A | 11 |
| 10 | 10 |
| K | 3 |
| Q | 2 |
| 8 | 0 |
| 7 | 0 |

Total per suit: 76 points.  
Total deck points: 304 points.

### Product implementation

Represent ranks internally as stable enum values:

```ts
type Rank = 'J' | '9' | 'A' | '10' | 'K' | 'Q' | '8' | '7' | '6' | '3' | '2';
type Suit = 'spades' | 'clubs' | 'diamonds' | 'hearts';
```

The game engine must never assume standard poker rank order.

## 4. Classic 4-seat deal

1. Dealer shuffles.
2. Player to dealer's left may cut in physical play. In the app, this becomes an optional cosmetic “cut” action or a future verifiable shuffle feature.
3. Dealer deals 4 cards to each player counter-clockwise, starting at dealer's right.
4. Four-card bidding occurs.
5. Highest bidder chooses a face-down trump indicator card from their first 4 cards.
6. Dealer deals 4 more cards to each player.
7. Eight-card bidding may occur if enabled.
8. Trick play begins.

## 5. Four-card bidding

### Rules

- Bidding starts with the player to dealer's right.
- Bidding proceeds counter-clockwise.
- Bids are numeric card-point targets.
- Minimum bid: 160.
- Standard bid step: 10.
- Each bid must be higher than the current highest bid.
- A player may pass.
- If all players pass, the hand is cancelled with no score.
- If any player bids, bidding continues until three consecutive passes establish the highest bidder.

### Constraints for bids below 200

Recommended Classic implementation:

- A player who has already acted once cannot bid below 200 on a later turn.
- If the previous highest bidder is the player's partner, the player cannot bid below 200.
- Asking partner to bid is a P1 feature, not required in the first playable MVP.

### Redeal edge case

Some rules allow only the first bidder, the player to dealer's right, to reject the hand and demand a redeal if their first 4 cards are worth less than 15 points.

**Product decision:**

- MVP: make this a rule-profile toggle, default **off** for simplicity.
- P1: add “Demand Redeal” button only when the server verifies eligibility.

## 6. Trump selection

The highest four-card bidder becomes the **trump maker**.

The trump maker:

1. Chooses one of their first 4 cards.
2. Places it face down as the trump indicator.
3. The suit of that card becomes trump.
4. Other players do not know the trump suit unless/until it opens.

Important validation:

- The trump maker must select trump before seeing their final 4 cards.
- The selected trump card is removed from their hand view and shown as a face-down table card.
- The trump maker effectively has 7 playable cards in hand plus the face-down indicator until it returns or is played.

## 7. Eight-card bidding

After all players receive 8 cards, a second bidding round can occur.

Recommended Classic rules:

- Starts with the previous highest bidder.
- Goes around once counter-clockwise.
- Bids must be at least 250.
- Bids must exceed the final four-card bid.
- Each player gets only one chance.
- A player cannot ask partner to bid in this round.
- If all pass, the four-card bid stands.
- If someone bids, the new highest bidder becomes trump maker and chooses a new trump indicator from their 8 cards.

**MVP decision:**

- Implement eight-card bidding in the engine early because it affects state structure.
- UI can initially support it as part of Classic mode.
- Partner Close Caps can be disabled until P1.

## 8. Open trump and closed trump

### Open trump

The trump maker can choose to play open trump before the first lead. The indicator is revealed and returned to the trump maker's hand. From then on, all players know trump.

Use cases:

- Trump maker wants partner to know trump immediately.
- Trump maker is first leader and wants to lead trump.
- Simpler beginner practice.

### Closed trump

Most games use closed trump.

While trump is closed:

- Players who can follow suit must play face up in the led suit.
- A player unable to follow suit may play a card face down.
- Face-down cards are inspected by the trump maker at the end of the trick.
- If any face-down card is trump, trump opens and relevant cards are revealed.
- If no face-down card is trump, those cards remain hidden.

### Product design notes

The closed trump mechanic is one of the hardest parts of the app. The UI must clearly show:

- Whether trump is closed or open
- Which cards are being played face down
- Why a player is allowed to play face down
- Whether the trick winner is known yet
- What is revealed after trump maker inspection

## 9. Trick play

A trick has one card from each active seat.

Rules:

1. Leader plays the first card.
2. Other players act counter-clockwise.
3. If a player has the led suit, they must follow suit.
4. If they do not have the led suit, they may play any card.
5. If trump is open, highest trump wins the trick.
6. If no trump is played, highest card of led suit wins.
7. Trick winner leads the next trick.

## 10. Special trump indicator rules

In closed trump:

- The trump indicator card cannot normally be led.
- It can be played face down to cut a non-trump trick led by another player.
- It can be played in the final trick if it is the trump maker's only card.
- If a bid is 250 or more, the indicator is revealed after the first trick and returned to hand.

**Implementation note:**

The engine should treat the trump indicator as a card in a special zone, not just a normal card in hand.

```ts
type CardZone =
  | { type: 'playerHand'; seatId: string }
  | { type: 'trumpIndicator'; seatId: string; face: 'down' | 'up' }
  | { type: 'currentTrick' }
  | { type: 'wonPile'; teamId: string };
```

## 11. Scoring tokens

At the end of the hand, count the card points in the trump maker team's won tricks.

If trump maker team points >= bid, the bid succeeds. Otherwise it fails.

Recommended Classic token table:

| Final bid | Successful bid | Failed bid |
|---|---:|---:|
| Less than 200 | Win 1 token | Lose 2 tokens |
| 200 to 249 | Win 2 tokens | Lose 3 tokens |
| 250 or more | Win 3 tokens | Lose 4 tokens |
| Partner Close Caps | Win 4 tokens | Lose 5 tokens |

Default match target:

- Each team starts with 11 tokens or equivalent score state.
- Traditional mode: first team to collect all tokens wins.
- Short mode: losing team pays to a neutral bank; first team to lose all tokens loses.

**MVP product decision:**

Use **short-mode scoring** for casual web sessions unless the host chooses Traditional. It ends faster and is easier to explain.

## 12. Caps

Caps means winning all tricks, not just all points. Winning all 304 points while losing a zero-point trick does not count as Caps.

Product recommendation:

- MVP: support automatic “all tricks won” detection for post-hand summary.
- P1: support manual Caps calling and penalty rules.
- P2: strict Caps timing enforcement for competitive rooms.

Reason: strict Caps timing is complex and may frustrate beginners.

## 13. Spoilt trumps

A spoilt trump game can occur if trump maker's opponents hold no trumps.

Product recommendation:

- MVP: disabled by default.
- P1: table-rule toggle in private rooms.
- Competitive mode: only enable if validation avoids hidden-information exploits.

Possible safe implementation:

- Allow declaration only from seats eligible by rule.
- Server validates the hidden state.
- If valid, hand redeals.
- If invalid, apply a configured penalty or ignore, but avoid revealing why in a way that leaks hidden cards.

## 14. Six-player variant

Public rules mention multiple six-player approaches. The app should choose one named variant and make it configurable.

### Recommended six-seat profile: `six_36_sri_lanka`

| Area | Rule |
|---|---|
| Seats | 6 |
| Teams | 2 teams of 3 |
| Seating | Alternating team seats around table |
| Deck | 36 cards: Classic 32 + 6s in each suit |
| Sixes | Lowest rank, zero points |
| Cards per player | 6 |
| First batch | 4 cards per player |
| Second batch | 2 cards per player |
| Four-card bidding | Same as Classic, with configuration |
| Six-card bidding | Same concept as eight-card bidding, adapted to 6-card hands |
| Scoring | Same token model as Classic unless overridden |

Rank order high to low:

J, 9, A, 10, K, Q, 8, 7, 6

Point values:

J=30, 9=20, A=11, 10=10, K=3, Q=2, 8=0, 7=0, 6=0

Total points remain 304.

### Alternative six-seat profile: `six_24_compact`

| Area | Rule |
|---|---|
| Seats | 6 |
| Teams | 2 teams of 3 |
| Deck | 24 cards, removing 7s and 8s |
| Cards per player | 4 |
| Use | Fast variant / future setting |

**Product decision:**

Do not default to compact mode. Six-player users usually expect more play depth than only 4 cards each.

## 15. Bot fill rules

The engine should treat bots as normal seats with automated decision makers.

| Human count | Classic 4 allowed? | Six-seat allowed? | Recommended default |
|---:|---|---|---|
| 1 | Yes, 3 bots | Yes, 5 bots | Classic 4 practice |
| 2 | Yes, 2 bots | Yes, 4 bots | Classic 4 |
| 3 | Yes, 1 bot | Yes, 3 bots | Classic 4 |
| 4 | Yes, 0 bots | Yes, 2 bots | Classic 4 |
| 5 | No, unless spectator | Yes, 1 bot | Six-seat |
| 6 | No, unless spectators | Yes, 0 bots | Six-seat |

## 16. Rule engine acceptance tests

The rules implementation is correct when it can pass fixtures for:

- Deck creation and total points
- Dealing order
- Four-card bidding order
- Illegal low bids
- Trump indicator selection before final cards
- Follow-suit enforcement
- Closed-trump face-down play
- Trump reveal after successful cut
- Trick winner with and without trump
- 250+ trump reveal after first trick
- End-of-hand card point count
- Bid success and token movement
- Bot legal move generation
- Six-seat 36-card deck and deal

## 17. Product wording for users

Use clear labels:

- **Classic 304:** 4 players, 32-card deck, 2v2.
- **Six-player 304:** 6 players, 36-card variant, 3v3.
- **Bots fill empty seats:** You can start even without a full group.
- **Closed trump:** Trump is hidden until someone cuts or it opens by rule.
- **Open trump:** Trump is shown before play starts.

Avoid claiming: “This is the only correct 304 rule set.”
