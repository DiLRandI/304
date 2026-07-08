# Product Requirements Document: 304 Online

## 1. Product summary

**304 Online** is a browser-based multiplayer web application for playing the Sri Lankan card game **304** with human players and bot users. The app supports **1 to 6 human users** in a room and automatically fills empty seats with bots so a game can start even when a full group is not available.

The product should feel familiar to Sri Lankan players while still being learnable for new players. Because 304 has regional variations, the app should be rule-configurable, with **Classic 4-seat Sri Lankan 304** as the primary mode and **Six-player 304** as a configurable variant.

## 2. Problem statement

Players who enjoy 304 often need exactly the right number of people and a shared physical deck. New players also struggle to learn because 304 includes unusual mechanics: high-value Jacks and Nines, hidden trump, closed-trump cutting, two-stage bidding, token scoring, Caps, and regional rules.

A web app can solve this by giving players:

- A room they can start with 1 to 6 humans
- Bot users to fill missing seats
- Clear visual enforcement of rules
- A guided tutorial for beginners
- A consistent rule set for online play
- Optional variants for local play styles

## 3. Goals

### Product goals

1. Let a player start a valid game with **any human count from 1 to 6**.
2. Preserve the feel of Sri Lankan 304, especially bidding, hidden trump, cutting, and team play.
3. Prevent illegal moves through server-side validation.
4. Make the game understandable to beginners without slowing experienced players.
5. Support casual private play first, then public matchmaking and ranked play later.
6. Build a flexible game engine that can support 4-seat and 6-seat table configurations.

### Business and engagement goals

1. Increase replayability through bots, rooms, rematches, and difficulty levels.
2. Keep session start friction low: a user should be able to create a room and start quickly.
3. Encourage learning through in-game hints, rule explanations, and bot practice.
4. Avoid real-money gambling, betting, or wagering features.

## 4. Non-goals

The first version should not include:

- Real-money gambling or betting
- Crypto, tokens, wagering, or cash rewards
- Native mobile apps
- Complex tournaments
- Voice chat
- Full social network features
- Every regional rule variation at launch
- Offline peer-to-peer gameplay

## 5. Target users

### Persona A: Casual Sri Lankan player

- Already knows 304 from family or friends
- Wants to create a private room and invite others
- Cares about familiar rules and fast gameplay
- May use mobile browser

### Persona B: New learner

- Knows card games but not 304
- Wants to practice with bots
- Needs explanations for bidding, trump, and scoring
- Benefits from hints and visible rule summaries

### Persona C: Competitive player

- Wants accurate rules, fair shuffling, and no cheating
- Cares about ranked play, stats, and reconnect support
- May want advanced settings such as Caps enforcement

### Persona D: Small friend group

- Has 2, 3, or 5 available humans
- Wants bots to fill gaps
- Needs teams to be balanced automatically

## 6. Core user journeys

### Journey 1: Solo practice

1. User opens app.
2. Clicks **Practice with Bots**.
3. App creates a 4-seat Classic table.
4. User takes one seat; 3 bots fill the rest.
5. User plays a full hand with tutorial hints enabled.
6. User can rematch, change difficulty, or return to lobby.

### Journey 2: Private 4-player room

1. Host creates a Classic 304 room.
2. Host sends invite link to friends.
3. 1 to 4 humans join.
4. Host starts the table.
5. Any empty seats are filled by bots.
6. App deals cards, handles bidding, trump, trick play, scoring, and rematch.

### Journey 3: 5-player group

1. Host creates room with **Auto table size**.
2. Five humans join.
3. App recommends 6-seat 304.
4. One bot fills the sixth seat.
5. Teams are arranged alternately around the table.
6. Game starts with the 6-player rule configuration.

### Journey 4: Reconnect

1. User loses connection during a hand.
2. Server keeps their seat reserved for a grace period.
3. Bot temporarily auto-plays only if the timer expires.
4. User reconnects and resumes the same seat.
5. User sees a short summary of missed actions.

## 7. Game mode requirements

### 7.1 Classic 4-seat mode

- Seats: 4
- Teams: 2 teams of 2, partners opposite each other
- Deck: 32 cards, ranks 7, 8, 9, 10, J, Q, K, A in 4 suits
- Cards per player: 8
- Deal/play direction: counter-clockwise
- Primary target: implement exact Classic 304 rules as the default

### 7.2 Six-seat mode

- Seats: 6
- Teams: 2 teams of 3, players seated alternately by team
- Recommended deck: 36 cards, Classic 32 + four 6s
- Sixes: zero-point cards and lowest cards in their suits
- Cards per player: 6
- Rule configuration: should be labeled as a variant
- Product must clearly show that 6-player rules can vary by region

### 7.3 Auto-fill rules

| Human count | Default mode | Fill behavior |
|---:|---|---|
| 1 | 4-seat practice | Add 3 bots |
| 2 | 4-seat room | Add 2 bots |
| 3 | 4-seat room | Add 1 bot |
| 4 | 4-seat room | Add 0 bots |
| 5 | 6-seat room | Add 1 bot |
| 6 | 6-seat room | Add 0 bots |

The host can override the default table size where legal.

## 8. Functional requirements

### 8.1 Account and identity

**MVP:** guest accounts are allowed.  
**Recommended:** optional login for persistent stats.

Requirements:

- Users can enter a display name.
- Guest users get a temporary account/session.
- Logged-in users can preserve stats, preferences, and friends later.
- Bot users must be visibly labeled as bots.

### 8.2 Lobby and rooms

- Create room
- Join room by invite code or link
- Choose table mode: Auto, Classic 4-seat, Six-seat variant
- Choose bot difficulty
- Choose rule profile
- Lock seats before start
- Start game when at least 1 human is present
- Auto-fill empty seats with bots on start
- Support rematch with same players

### 8.3 Gameplay

- Shuffle and deal server-side
- Enforce legal bids
- Enforce trump selection rules
- Enforce legal trick play and follow-suit rules
- Hide private information from other clients
- Reveal cards only when legal
- Track tricks and points
- Calculate token movement after hand
- Detect hand/game completion
- Persist event log for replay/debugging

### 8.4 Bots

- Fill missing seats automatically
- Play at configurable difficulty
- Never access hidden information unavailable to the bot seat
- Act with realistic delays
- Support bidding, trump choice, trick play, and basic team awareness
- Allow host to replace a bot with a human before game starts
- Optionally allow replacement mid-match after hand ends

### 8.5 Tutorial and learning

- Rule summary panel
- Card values panel
- “Why can/can’t I play this?” explanation
- Bidding hints for beginners
- Trump explanation overlay
- Optional beginner move hints in practice mode

### 8.6 Reconnection

- Preserve seat for disconnected players
- Show connection status to table
- Use bot autopilot after timer expiration
- Return control to player on reconnect
- Prevent reconnect from exposing hidden cards

### 8.7 Settings

- Sound on/off
- Animation speed
- Card size
- Language: English first; Sinhala/Tamil later
- Bot difficulty
- Rule profile
- Private/public room setting

## 9. Non-functional requirements

### Performance

- First load should be optimized for mobile web.
- Gameplay actions should feel near-instant under normal network conditions.
- WebSocket messages should be small and state-diff based where practical.
- Bot decisions should complete quickly enough not to stall play.

### Reliability

- Server must be authoritative.
- Game state must be recoverable from snapshots and event logs.
- A server crash should not corrupt ongoing games.
- Completed hands should be stored for debugging.

### Scalability

- Architecture should support horizontal WebSocket scaling.
- Room state can be stored in memory with Redis-backed coordination for MVP.
- Long-term ranked games should persist state in PostgreSQL.

### Security

- Clients must never receive hidden cards they should not know.
- All player actions must be validated server-side.
- Rate limits must exist for room creation, joining, chat, and game actions.
- No real-money wagering features.

### Accessibility

- Keyboard playable card selection
- Screen-reader labels for cards and actions
- Color-blind-safe suit indicators
- Large card mode
- Reduced-motion mode

## 10. Rule profile requirements

The rules engine must load a `RuleProfile` object rather than hard-code every rule. This allows future regional variation without rewriting the core engine.

Example configuration fields:

```ts
interface RuleProfile {
  id: string;
  name: string;
  seatCount: 4 | 6;
  teamCount: 2;
  playersPerTeam: 2 | 3;
  deckRanks: string[];
  rankOrderHighToLow: string[];
  cardPoints: Record<string, number>;
  minFourCardBid: number;
  fourCardBidStep: number;
  minEightCardBid: number;
  eightCardBidStep: number;
  allowClosedTrump: boolean;
  allowOpenTrump: boolean;
  revealTrumpAfterFirstTrickAtBidAtLeast: number | null;
  enableCaps: boolean;
  enablePartnerCloseCaps: boolean;
  enableSpoiltTrump: boolean;
  scoringTokenProfileId: string;
}
```

## 11. Success metrics

### Activation

- Room creation completion rate
- Practice game start rate
- Invite link join rate
- Percentage of rooms that start a hand

### Engagement

- Hands played per user
- Rematch rate
- Bot practice retention
- Average session length
- Tutorial completion rate

### Quality

- Illegal action rejection rate
- Reconnect success rate
- Game crash rate
- Average action latency
- Player reports per 100 games

### Learning

- Beginner users completing first hand
- Hint usage rate
- Repeat play after tutorial

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Regional rule disagreements | Players may reject app rules | Provide rule profiles and clear labels |
| Hidden trump complexity | Bugs and confusion | Build rule tests and UI explanations |
| Bot mistakes feel unfair | Users lose trust | Label bots, tune difficulty, explain practice mode |
| Cheating through client state | Competitive mode fails | Server-authoritative state and private views |
| 6-player rules vary | Incorrect implementation | Start with explicitly labeled 36-card variant |
| Long games | Players abandon | Add rematch, token variants, and save/resume later |
| Network dropouts | Broken games | Reconnect and bot autopilot |

## 13. MVP acceptance criteria

The MVP is acceptable when:

1. A guest user can create a Classic 4-seat room.
2. The room can start with 1, 2, 3, or 4 humans.
3. Empty seats are filled by bots.
4. A complete hand can be played from deal to scoring.
5. Bidding, trump selection, following suit, cutting, and trick winning are validated server-side.
6. Hidden cards and hidden trump are not leaked to other clients.
7. Bots can bid, choose trump, and play legal cards.
8. A disconnected player can reconnect to the same seat.
9. The UI works on desktop and mobile browsers.
10. The app has no real-money betting or gambling mechanics.

## 14. Recommended build sequence

1. Build deterministic card/game engine in TypeScript.
2. Add Classic 4-seat rules and test fixtures.
3. Build simple local UI against the engine.
4. Add server-authoritative WebSocket room flow.
5. Add bot fill and beginner bot logic.
6. Add scoring, rematch, reconnect, and event log.
7. Add tutorial and mobile polish.
8. Add 6-seat variant once the engine abstraction is stable.
