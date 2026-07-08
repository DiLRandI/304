# Data Model and API Specification

## 1. Purpose

This document defines the core database entities, REST endpoints, and WebSocket messages for 304 Online.

## 2. Core entities

### User

```ts
interface User {
  id: string;
  displayName: string;
  type: 'guest' | 'registered' | 'bot';
  createdAt: string;
  lastSeenAt?: string;
}
```

### Room

```ts
interface Room {
  id: string;
  inviteCode: string;
  hostUserId: string;
  visibility: 'private' | 'public';
  status: 'lobby' | 'in_hand' | 'scoring' | 'closed' | 'abandoned';
  tableSizeMode: 'auto' | 'classic_4' | 'six_6';
  activeSeatCount?: 4 | 6;
  ruleProfileId: string;
  botDifficulty: 'easy' | 'normal' | 'strong';
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
```

### Seat

```ts
interface Seat {
  id: string;
  roomId: string;
  seatIndex: number;
  teamId: 'A' | 'B';
  occupantType: 'empty' | 'human' | 'bot';
  userId?: string;
  botId?: string;
  displayName: string;
  connectionStatus: 'online' | 'disconnected' | 'autopilot';
  isReady: boolean;
}
```

### GameSession

```ts
interface GameSession {
  id: string;
  roomId: string;
  ruleProfileId: string;
  status: 'active' | 'complete' | 'abandoned';
  startedAt: string;
  endedAt?: string;
  winningTeamId?: 'A' | 'B';
}
```

### Hand

```ts
interface Hand {
  id: string;
  gameSessionId: string;
  handNumber: number;
  dealerSeatId: string;
  finalBid?: number;
  trumpMakerSeatId?: string;
  trumpSuit?: Suit;
  status: 'active' | 'cancelled' | 'scored';
  teamAPoints?: number;
  teamBPoints?: number;
  tokenDelta?: Record<'A' | 'B', number>;
  startedAt: string;
  endedAt?: string;
}
```

### GameEvent

```ts
interface GameEvent {
  id: string;
  gameSessionId: string;
  handId?: string;
  version: number;
  actorSeatId?: string;
  type: string;
  payload: unknown;
  createdAt: string;
}
```

### GameSnapshot

```ts
interface GameSnapshot {
  id: string;
  gameSessionId: string;
  handId?: string;
  version: number;
  stateJson: unknown;
  createdAt: string;
}
```

## 3. Prisma-style schema sketch

```prisma
model User {
  id           String   @id @default(cuid())
  displayName String
  type         String
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime?
}

model Room {
  id              String   @id @default(cuid())
  inviteCode      String   @unique
  hostUserId      String
  visibility      String
  status          String
  tableSizeMode   String
  activeSeatCount Int?
  ruleProfileId   String
  botDifficulty   String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  expiresAt       DateTime?
}

model GameEvent {
  id            String   @id @default(cuid())
  gameSessionId String
  handId        String?
  version       Int
  actorSeatId   String?
  type          String
  payloadJson   Json
  createdAt     DateTime @default(now())

  @@unique([gameSessionId, version])
}
```

## 4. REST API endpoints

### Create guest session

```http
POST /api/guest-session
```

Request:

```json
{
  "displayName": "Deleema"
}
```

Response:

```json
{
  "userId": "usr_123",
  "sessionToken": "...",
  "displayName": "Deleema"
}
```

### Create room

```http
POST /api/rooms
```

Request:

```json
{
  "visibility": "private",
  "tableSizeMode": "auto",
  "ruleProfileId": "classic_304_4p",
  "botDifficulty": "normal",
  "allowGuests": true
}
```

Response:

```json
{
  "roomId": "room_123",
  "inviteCode": "304-LK7M",
  "joinUrl": "/room/room_123?code=304-LK7M"
}
```

### Get room summary

```http
GET /api/rooms/{roomId}
```

Returns public-safe room data only.

### Join room

```http
POST /api/rooms/{roomId}/join
```

Request:

```json
{
  "inviteCode": "304-LK7M"
}
```

### Get rule profiles

```http
GET /api/rule-profiles
```

Response:

```json
{
  "profiles": [
    {
      "id": "classic_304_4p",
      "name": "Classic 304",
      "seatCount": 4,
      "description": "4-player 2v2 Sri Lankan 304"
    },
    {
      "id": "six_304_36",
      "name": "Six-player 304, 36-card variant",
      "seatCount": 6,
      "description": "6-player 3v3 variant with sixes included"
    }
  ]
}
```

## 5. WebSocket connection

### Connect

Client connects with:

```json
{
  "roomId": "room_123",
  "sessionToken": "..."
}
```

Server responds:

```json
{
  "type": "ROOM_STATE",
  "room": {},
  "seatId": "seat_0",
  "gameView": {}
}
```

## 6. Client-to-server WebSocket events

### Room events

| Event | Payload |
|---|---|
| `ROOM_JOIN` | `{ roomId, inviteCode }` |
| `ROOM_LEAVE` | `{ roomId }` |
| `SEAT_SELECT` | `{ roomId, seatIndex }` |
| `SEAT_READY_SET` | `{ roomId, isReady }` |
| `ROOM_SETTINGS_UPDATE` | `{ roomId, settingsPatch }` |
| `ROOM_START_GAME` | `{ roomId }` |

### Game events

| Event | Payload |
|---|---|
| `GAME_BID` | `{ roomId, amount }` |
| `GAME_PASS_BID` | `{ roomId }` |
| `GAME_SELECT_TRUMP` | `{ roomId, cardId }` |
| `GAME_CHOOSE_OPEN_TRUMP` | `{ roomId }` |
| `GAME_CHOOSE_CLOSED_TRUMP` | `{ roomId }` |
| `GAME_PLAY_CARD` | `{ roomId, cardId }` |
| `GAME_DECLARE_CAPS` | `{ roomId, playOrder }` |
| `GAME_ACK_SCORE` | `{ roomId }` |

## 7. Server-to-client WebSocket events

| Event | Payload |
|---|---|
| `ROOM_STATE_UPDATE` | Public lobby/room update |
| `GAME_STATE_UPDATE` | Private projected game view |
| `ACTION_REJECTED` | Error code and explanation |
| `TIMER_UPDATE` | Active timer state |
| `BOT_THINKING` | Bot seat and action type |
| `PLAYER_DISCONNECTED` | Seat status update |
| `PLAYER_RECONNECTED` | Seat status update |
| `HAND_RESULT` | Public hand result |
| `MATCH_COMPLETE` | Final match result |

## 8. Client game view

```ts
interface ClientGameView {
  roomId: string;
  gameId: string;
  viewerSeatId?: string;
  phase: GamePhase;
  eventVersion: number;
  seats: PublicSeatView[];
  teams: PublicTeamView[];
  myHand?: CardView[];
  currentTrick?: TrickView;
  bidding: PublicBiddingView;
  trump: PublicTrumpView;
  scoring: PublicScoringView;
  legalActions: LegalActionView[];
  prompt: string;
}
```

## 9. Card view

```ts
interface CardView {
  cardId?: string;
  suit?: Suit;
  rank?: Rank;
  points?: number;
  face: 'up' | 'down';
  ownerSeatId?: string;
  isPlayable?: boolean;
  disabledReason?: string;
}
```

For hidden cards, omit rank/suit/cardId if the viewer should not know it.

## 10. Error codes

| Code | Meaning |
|---|---|
| `ROOM_NOT_FOUND` | Room does not exist |
| `ROOM_FULL` | No available seat |
| `NOT_HOST` | Action requires host |
| `NOT_YOUR_TURN` | Player acted out of turn |
| `INVALID_PHASE` | Action not allowed now |
| `ILLEGAL_BID` | Bid violates rules |
| `ILLEGAL_CARD` | Card cannot be played |
| `MUST_FOLLOW_SUIT` | Player must play led suit |
| `TRUMP_NOT_OPEN` | Action requires revealed trump |
| `STALE_VERSION` | Client acted on old state |

## 11. Persistence strategy

### MVP

- Active game state in memory.
- Event log stored in PostgreSQL.
- Snapshot every hand start and hand end.
- Redis for room presence and reconnect mapping.

### Production

- Snapshot every N events.
- Room ownership lock in Redis.
- Crash recovery from latest snapshot + later events.
- Background cleanup for abandoned rooms.

## 12. Analytics events

| Event | Properties |
|---|---|
| `room_created` | tableSizeMode, ruleProfileId |
| `room_started` | humanCount, botCount, activeSeatCount |
| `hand_started` | ruleProfileId, handNumber |
| `bid_made` | amount, phase, seatTeam |
| `trump_selected` | closed/open later, bidAmount |
| `card_played` | phase, legal=true, faceDown |
| `hand_completed` | bid, success, points, duration |
| `bot_filled` | count, difficulty |
| `reconnect_success` | secondsDisconnected |

Avoid storing full card data in analytics unless needed for debugging and covered by privacy policy.

## 13. API acceptance criteria

The data/API layer is complete when:

- Rooms can be created, joined, started, and closed.
- WebSocket clients receive correct private views.
- All game actions have typed messages.
- Invalid actions return useful errors.
- Event log preserves accepted actions.
- Reconnect can restore a player's seat and state.
