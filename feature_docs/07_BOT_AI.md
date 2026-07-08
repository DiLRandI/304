# Feature Doc: Bot Users and Bot AI

## 1. Feature summary

Bot users fill empty seats so a game can start with any human count from 1 to 6. Bots must behave legally, realistically, and fairly. They are not only placeholders; they are core to solo practice, small-group play, and reconnect autopilot.

## 2. Bot goals

- Always make legal moves.
- Never access hidden information unavailable to the bot seat.
- Fill missing seats immediately on game start.
- Give beginners a useful practice experience.
- Avoid moves that feel random or intentionally bad.
- Provide difficulty levels for different skill levels.
- Act at a human-like pace.

## 3. Bot types

| Bot type | Use case | Description |
|---|---|---|
| Fill bot | Empty seat at game start | Full bot player for entire hand/match |
| Practice bot | Solo practice | May be tuned to be learner-friendly |
| Autopilot bot | Disconnected human | Temporarily acts for human until reconnect |
| Debug bot | QA/testing | Deterministic scripted actions for tests |

## 4. Bot difficulty levels

### Easy

- Makes legal moves.
- Uses simple point and rank heuristics.
- Conservative bidding.
- May miss advanced partner signals.
- Good for beginners.

### Normal

- Tracks public cards played.
- Makes sensible bids from first 4 cards.
- Chooses trump based on strength and suit length.
- Avoids wasting high cards on partner-won tricks.
- Cuts high-value tricks when useful.

### Strong

- Estimates unseen cards.
- Models partner/opponent likely holdings.
- Uses Monte Carlo simulations where time allows.
- Bids more accurately.
- Plays endgames with card counting.

## 5. Fairness rule

A bot must make decisions from an **information state**, not from the full hidden server state.

```ts
interface BotDecisionContext {
  botSeatId: SeatId;
  privateView: ClientGameView;
  legalActions: LegalAction[];
  memory: BotMemory;
  difficulty: BotDifficulty;
  ruleProfile: RuleProfile;
}
```

The bot may know:

- Its own hand
- Public bid history
- Public cards played face up
- Publicly revealed trump
- Team and seating layout
- Its own previous decisions

The bot may not know:

- Hidden cards in human hands
- Hidden trump if it is not the trump maker and trump is closed
- Face-down non-revealed cards
- Full deck order after deal

## 6. Bot memory

```ts
interface BotMemory {
  seenCards: CardId[];
  voidSuitsBySeat: Record<SeatId, Suit[]>;
  inferredTrump?: Suit;
  bidTendencies: Record<SeatId, BidProfile>;
  partnerLikelyStrongSuits: Suit[];
  opponentLikelyStrongSuits: Suit[];
}
```

Memory is reset or archived at hand boundaries depending on difficulty.

## 7. Bidding heuristics

### Hand evaluation

For the first 4 cards, compute:

- Total points in hand
- Number of Jacks and Nines
- Suit lengths
- Highest cards per suit
- Whether hand contains strong trump candidates
- Whether cards are spread across suits
- Current bid pressure
- Partner bid/pass information

Example score:

```ts
function evaluateFourCardBidHand(hand: Card[]): number {
  let score = 0;
  for (const card of hand) {
    score += cardPointValue(card);
    if (card.rank === 'J') score += 15;
    if (card.rank === '9') score += 8;
    if (card.rank === 'A') score += 3;
  }
  score += longestSuitLength(hand) * 8;
  return score;
}
```

### Easy bidding

- Bid 160 if hand evaluation is decent.
- Pass weak hands.
- Rarely bid above 180.

### Normal bidding

Approximate rules:

| Hand condition | Likely action |
|---|---|
| Very weak, no points | Pass |
| One strong suit with J/9 | Bid 160-180 |
| Strong suit and high point total | Bid 180-200 |
| Very strong first 4 cards | Bid 200+ cautiously |
| Partner already high bidder | Usually pass unless strong support and rule allows |

### Strong bidding

- Uses suit control and expected trick count.
- Considers current bidder team.
- May bid 200+ with strong trump-making potential.
- Rarely overbids beyond realistic success odds.

## 8. Trump choice heuristics

When bot is trump maker, score each candidate suit.

Factors:

- Has Jack of suit
- Has Nine of suit
- Number of cards in suit
- Supporting Ace/Ten
- Ability to draw trumps
- Weakness in other suits

Example:

```ts
function scoreTrumpSuit(hand: Card[], suit: Suit): number {
  const cards = hand.filter(c => c.suit === suit);
  let score = cards.length * 10;
  for (const c of cards) {
    if (c.rank === 'J') score += 50;
    if (c.rank === '9') score += 35;
    if (c.rank === 'A') score += 15;
    if (c.rank === '10') score += 10;
  }
  return score;
}
```

For four-card trump selection, only first-batch cards are eligible.

## 9. Open vs closed trump bot choice

Default bot behavior:

- Choose **closed trump** most of the time.
- Choose **open trump** when partner needs to know trump immediately, when leading trump is strategically required, or when high bid rules make trump open soon anyway.

Easy bots may always choose closed trump for simplicity.

## 10. Trick play heuristics

### If leading

Possible priorities:

1. Lead strong trump if trump is open and bot can draw opponents' trumps.
2. Lead high-value winner if likely safe.
3. Lead low card from weak suit to test opponents.
4. Avoid leading unsupported high-point cards into danger.

### If following suit

- If partner is currently winning, conserve high cards unless points must be protected.
- If opponent is winning and trick contains many points, try to win with the lowest sufficient card.
- If cannot win, discard low-value card unless sloughing points is strategically safe.

### If unable to follow suit

- If trump is open and trick has high points, cut with the lowest trump that can win.
- If partner is winning, avoid cutting partner unless necessary.
- If no chance to win, discard low point cards.
- In closed trump, follow legal face-down behavior.

## 11. Partner awareness

Bots should understand team goals.

Examples:

- Do not overtake partner's winning Jack unless needed.
- Protect partner's bid when on bidder team.
- Defend aggressively when opponents bid high.
- Feed points to partner's winning trick when safe.
- Avoid revealing trump unnecessarily if partner benefits from hidden trump.

## 12. Autopilot behavior

Autopilot should prioritize safety over cleverness.

Rules:

- Use Normal or Easy policy, never Strong unless user selected it.
- Do not bid aggressively for a disconnected user.
- If forced to choose trump, choose best simple suit.
- If playing a card, choose legal move that minimizes obvious harm.
- When user reconnects, stop immediately after current action resolves.

## 13. Bot pacing

Bots should not act instantly unless in fast-forward testing.

Recommended delays:

| Action | Delay |
|---|---:|
| Pass weak bid | 0.7s - 1.5s |
| Make bid | 1.0s - 2.5s |
| Choose trump | 1.2s - 3.0s |
| Play obvious card | 0.6s - 1.4s |
| Complex trick play | 1.5s - 3.5s |

Add small randomness, but keep game moving.

## 14. Bot names

Use clearly non-human labels:

- Bot Nimal
- Bot Kavindi
- Bot Sahan
- Bot Amaya
- Bot Ruwan
- Bot Thara

UI must include a bot badge.

## 15. Bot testing

### Unit tests

- Bot always returns one legal action.
- Bot never accesses hidden state in decision context.
- Bot bids within legal ranges.
- Bot follows suit when possible.
- Bot can finish 10,000 simulated hands without crashing.

### Quality tests

Track:

- Bid success rate by difficulty
- Average points won as bidder team
- Illegal action attempts
- Time per decision
- Frequency of obvious blunders

## 16. Future bot improvements

### Monte Carlo search

For Strong bots:

1. Generate possible hidden hand distributions consistent with public info.
2. Simulate legal play outcomes for candidate actions.
3. Choose action with highest expected team outcome.

### Bot explanations

After a hand, show optional explanation:

> Bot Sahan cut because the trick had 63 points and your team was defending against a 220 bid.

This should be P2 because explanations require careful wording and rule confidence.

## 17. Acceptance criteria

Bot feature is complete when:

- A game can start with bots filling every missing seat.
- Bots can complete hands without illegal moves.
- Bots can bid, select trump, choose open/closed trump, and play tricks.
- Bots are visually labeled.
- Autopilot handles disconnected players.
- Bot decisions do not use hidden information unavailable to that seat.
- Bot speed feels natural and does not stall the game.
