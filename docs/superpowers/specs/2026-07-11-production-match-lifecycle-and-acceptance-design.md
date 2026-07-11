# Production Match Lifecycle and Acceptance Design

**Goal:** Make the public-casual 304 release behave like a durable game product
at the end of a hand or match, retain data safely, and prove real player flows
through browser acceptance rather than only unit simulations.

## Release boundary

This work covers the public casual game: guest sessions, private Classic and
six-seat tables, bot fill, reconnect, durable hand/match progression, and
operational retention. It intentionally does not add accounts, rankings,
public matchmaking, chat, payments, wagering, social features, or custom rule
editing.

## Current evidence and gaps

The engine can complete Classic and six-seat hands, and `ACK_RESULT` can begin
the next hand or a new match. The durable service persists those actions and
the existing release rehearsal proves entry, private hands, reconnect, mobile
layout, and the first legal action. That is not enough production evidence:

- the browser does not display a structured hand/match result or label the
  next-hand/rematch action accurately;
- a seated guest cannot deliberately leave a lobby or completed table;
- stale lobbies and closed-room data have no durable cleanup lifecycle; and
- browser acceptance does not yet drive a full Classic or six-seat hand to its
  result, or prove a five-human six-seat table gets exactly one bot.

## Product behavior

### Result and rematch

`ACK_RESULT` remains the single idempotent game action for advancing a table.
The UI labels it according to the projected phase: **Next hand** after a hand
result and **Play another match** after match completion. The game table shows
the resolved bid, winning team, point result, token movement, and resulting
team tokens from the server projection; no result is calculated in the
browser.

Only the room host may advance a completed hand or match. This prevents a
non-host from unexpectedly advancing a private table while people are reading
the result. The worker may progress legal automation only during an active
hand. It never acknowledges `hand_result` or `match_complete`; those terminal
states pause for a reconnecting human host and are later bounded by
terminal-room retention.

### Leaving a table

Add a versioned `leave` room command with an idempotency key. A human can leave
only while a room is in `lobby` or `hand_result`; during an active hand the
player reconnects/disconnects normally and the existing grace/autopilot path
protects play continuity.

Leaving a lobby clears that human seat. If the host leaves and another human
remains, ownership transfers to the lowest occupied human seat; if no humans
remain, the room closes. Leaving a completed table replaces that player with a
bot at the room's configured difficulty, so a host can start the next hand
without a stale human seat. A departing host transfers ownership to the lowest
remaining human in either allowed state. If the departing player is the last
human, the room closes instead. Each lifecycle change appends a durable event, advances
the room version, cancels obsolete automation jobs, and emits an outbox update.
The leave endpoint returns only a `RoomExitResponse` (`roomId`, `eventVersion`,
and `status` of `left` or `closed`); it never returns a room projection after
the caller has relinquished their seat. The client closes its realtime socket
and returns to the play lobby.

### Retention and cleanup

Add a maintenance pass to the existing worker process. It must only close
inactive lobbies and terminal rooms; it must never close an in-hand room or
alter active game state. Configuration defines conservative bounded values for
lobby inactivity, terminal-room retention, and expired-session cleanup.

The pass first revokes expired sessions, closes stale lobbies/terminal rooms
with an auditable `ROOM_CLOSED` event, cancels their pending automation jobs,
and later purges only long-retained closed rooms through database foreign-key
cascades. It reports bounded counters through the existing metrics surface so
operators can see closures and purges without exposing player, room, card, or
invite data.

## Interfaces

- Contracts add `LeaveRoomRequestSchema` and a `RoomLifecycleAction` endpoint
  shape containing `commandId` and `expectedVersion`, plus a
  `RoomExitResponseSchema` with no game or player data.
- `GameClient.leaveRoom(roomId, expectedVersion)` uses the authenticated,
  cookie-bearing `/v1/rooms/:roomId/leave` boundary.
- `RoomCoordinator.leaveRoom(session, roomId, request)` owns authorization,
  host transfer, bot replacement, closure, snapshots, and outbox scheduling.
- `RoomMaintenance.runOnce(now)` is called by the worker after normal
  automation polling and depends only on a narrow store interface.
- Projected game views include a validated, public `handResult` summary; the
  browser never receives shuffle seeds, full snapshots, hidden cards, or any
  other seat's private result data.

## Acceptance evidence

The release gate must add direct evidence for these flows:

1. A completed hand exposes a server-projected result and only the host can
   advance it; the next hand has a rotated dealer and valid private hands.
2. A host can rematch after match completion; a departing human at a result is
   replaced by a configured bot, while the last human closes the room.
3. Stale lobbies and aged closed rooms are cleaned by maintenance without
   touching an in-hand room; metrics record only aggregate counters.
4. Playwright drives a real Classic and six-seat practice hand to the result
   using only visible legal controls and server automation, then validates the
   result and next-hand UI.
5. Five independent browser sessions join a six-seat room, the host starts it,
   and the private table contains five humans plus exactly one bot with six
   cards allocated per seat; a closed trump maker's normal hand shows five
   cards while the sixth remains in the face-down indicator zone.

All unit, integration, browser, load, security, image, migration, and
backup/restore gates continue to run. External legal approval, alert delivery,
and production backup ownership remain operator prerequisites and are not
represented as completed merely because source checks pass.
