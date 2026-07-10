# Production Game Platform Design

**Date:** 2026-07-10  
**Status:** Approved implementation direction  
**Release target:** Public casual web launch for 304 Online

## 1. Purpose and release boundary

304 Online must be a recoverable, server-authoritative multiplayer game service rather than a browser demo or a single-process room server. The public-release product supports private room sharing and bot practice for the Classic four-seat and six-seat rule profiles already present in the game engine.

The release boundary includes:

- durable rooms, seats, accepted actions, and game snapshots;
- reconnect to the same seat with a correct private view after process restart;
- real-time state delivery with HTTP snapshot recovery;
- authoritative validation, private-card protection, fair server shuffle, and auditable actions;
- bot fill, disconnect grace periods, and server-side autopilot;
- accessible responsive UI, rules/help, and safe guest identity;
- repeatable local production-like deployment, health/readiness probes, structured logs, metrics, backups, and CI release gates.

The release does **not** introduce real-money play, wagering, ranked play, player chat, spectator mode, custom rules, or social/friend features. Those are separately documented future product work and must not be implied to exist.

## 2. Current-state constraints

The existing engine is a useful pure JavaScript rules core and must remain independently executable. The current `server.js`, however, owns rooms, sessions, rate limits, and timers in process-local `Map` instances. That design loses active games on restart, cannot safely coordinate multiple instances, and does not create a durable audit/recovery trail.

The migration must preserve accepted gameplay semantics while replacing process-local authority. Existing browser routes may stay available during migration, but no new production behavior may depend on in-memory room state.

## 3. Options considered

### Option A: harden the current single process

Add more retries, cleanup, and deployment scripts around the current server. This is fast but cannot provide restart recovery, safe horizontal scaling, durable audit history, or reliable timers. It is rejected.

### Option B: durable Node game service with a component web client

Use a Node/TypeScript game service, PostgreSQL event/snapshot storage, Redis coordination, and a Next.js/TypeScript web client. This preserves the existing engine while satisfying the authoritative-state and recovery requirements. It is the selected approach.

### Option C: frontend migration first

Move immediately to a Next.js-only implementation and defer the game-service split. This improves UI organization but leaves the highest-risk state-loss problem unresolved. It is rejected as the first production milestone; a Next.js client may be introduced behind the durable game-service contract.

## 4. Target architecture

```text
Next.js browser web client
  | HTTPS commands + WebSocket state updates
  v
Game API and realtime service
  |-- game-engine package: deterministic validation/reduction/projection
  |-- room coordinator: per-room ordered command execution
  |-- bot/timer worker: delayed legal actions and reconnect grace handling
  |-- PostgreSQL: accounts/guests, rooms, seats, events, snapshots, hand history
  '-- Redis: rate limits, presence, room leases, timer jobs, pub/sub fanout
```

### 4.1 Repository boundaries

The implementation will converge on these independently testable boundaries:

```text
apps/
  web/                 Next.js browser-facing application
  game-service/        HTTPS/WebSocket API and room coordinator
  worker/              durable timer and bot-action consumer
packages/
  game-engine/         rules, reducer, projection, deterministic fixtures
  contracts/           versioned API/WebSocket schemas and error codes
  bot-ai/              legal-action policies with bounded execution time
infra/
  compose/             production-like local stack
  migrations/          database migration source and migration checks
```

The existing engine moves incrementally into `packages/game-engine`; behavior is characterized by tests before each move. `apps/web` is a Next.js/TypeScript client deployed independently from the stateful service and communicates only through `packages/contracts`. The browser never imports authoritative server state or deal/shuffle internals. The existing static client remains available only until behavior-parity browser tests pass, then is removed rather than becoming a second production client.

### 4.2 Durable state and recovery

PostgreSQL is the source of truth for a room's lifecycle, seats, immutable accepted events, and versioned snapshots. Every accepted command has a client-generated idempotency key, a room event version, actor identity, timestamp, and sanitized payload. The service rejects duplicate commands safely and returns the already-recorded result.

The room coordinator obtains a short Redis lease before applying a command. It serializes actions per room, writes the event and derived snapshot in one database transaction, then publishes a versioned update. On a restart, a new coordinator loads the latest snapshot and replays later events through the same engine reducer. A failed recovery marks the room unavailable and emits an operator-visible error rather than guessing game state.

Snapshots are taken at hand start, hand completion, and after a bounded number of accepted actions. Snapshot schema and rule-profile versions are recorded so migrations cannot silently reinterpret old games.

### 4.3 Realtime delivery and reconnect

The initial page load and every reconnect request a private HTTP snapshot. A WebSocket session then receives versioned private projections only. Clients ignore stale versions, request a fresh snapshot after a version gap, and never optimistically commit a game action.

Guest identity uses a high-entropy, HTTP-only, secure, same-site session cookie backed by a server-side session record. A guest can reconnect to its active seat during the configured grace period. Future account linking may preserve the same durable player identity but is not required to join a casual private room.

Presence is an expiring Redis record. After the grace period, the worker schedules bot autopilot through the normal command pipeline. A human reconnection cancels autopilot at the next safe action boundary and receives the current private projection.

### 4.4 Fairness, privacy, and abuse controls

- Shuffle randomness comes from the server cryptographic RNG. A per-hand encrypted/auditable shuffle record is retained; any player-facing reveal is only after hand completion and only if the rule profile enables it.
- The engine validates every intent and produces a viewer-specific projection. Tests assert that a player cannot receive another hand, hidden trump information, or unplayed card data.
- Mutating endpoints require an authenticated guest/session identity, origin enforcement, CSRF-safe cookie behavior, payload limits, per-IP and per-identity rate limits, and idempotency keys.
- Command, security, and recovery logs are structured and redact session tokens, cards not visible to the viewer, and raw credentials.
- There is no wallet, credit, wager, cash-out, or prize model in the public release.

### 4.5 Operations and deployment

The repository provides a production-like Docker Compose stack for the web client, game service, worker, PostgreSQL, and Redis. Production deployment uses separately configurable managed PostgreSQL and Redis; secrets enter only through environment variables or the target platform's secret manager.

Required operational surfaces are `/livez`, `/readyz`, metrics, JSON logs with correlation ids, error tracking adapters, database migration checks, backup/restore documentation, and a rollback-safe deployment manifest. The service exposes no engine dump or administrative mutator without explicit operator authorization.

CI must run immutable dependency installation, lint/type checks, unit/contract/integration tests, dependency audit, secret scan, container/image scan, database migration validation, and browser E2E smoke tests. A release cannot be marked ready without a clean run of these gates.

## 5. Delivery milestones

### M1: production foundation

- Establish workspace boundaries, typed contracts, environment validation, Compose stack, schema migrations, and CI gates.
- Characterize and migrate the existing engine into an isolated testable package.
- Deliver structured logging, health/readiness, metrics, and safe configuration handling.

**Exit evidence:** a clean checkout starts the local multi-service stack; migrations apply; the engine test suite runs independently; CI-equivalent checks pass.

### M2: durable authoritative rooms

- Implement durable guest sessions, rooms/seats, event storage, snapshots, idempotent commands, private projections, and HTTP room snapshots.
- Implement Redis leases, presence, rate limits, and recovery replay.

**Exit evidence:** integration tests create/join/play/reconnect a multi-user hand; a service restart preserves the room and private hands; duplicate and stale commands are rejected safely.

### M3: realtime game and resilience

- Add versioned WebSocket delivery, reconnect state resync, timer worker, bot autopilot, bot action durability, and both rule profiles.
- Add deterministic simulations for classic and six-seat games plus leak and recovery fuzz cases.

**Exit evidence:** multi-browser E2E tests complete classic and six-seat hands; a fault-injection test recovers a hand from snapshot plus events; long-running simulations preserve engine invariants.

### M4: public-release product and operations

- Build production web flows, landing/help/rules pages, accessible keyboard/mobile behavior, privacy policy, terms, analytics consent, operational dashboards, alerts, backups, and deployment runbook.
- Complete load, security, accessibility, and manual experienced-player rule review.

**Exit evidence:** release checklist is fully evidenced, monitoring and backup restore are tested, legal pages are available, and a public-release rehearsal passes with no P0 defects.

## 6. Verification strategy

Every milestone adds executable tests before implementation changes:

- engine: deterministic rule, score, legal-action, projection, and full-hand fixtures;
- service: API, authentication/session, idempotency, database transaction, Redis lease, recovery, and rate-limit integration tests;
- realtime: multiple independent clients, version gaps, reconnect, duplicate delivery, and private-view tests;
- browser: practice, invite room, reconnect, classic and six-seat full-hand paths, keyboard navigation, mobile layout, and error states;
- security/reliability: dependency/secret/container scans, fuzzed invalid input, fault injection, migration rollback checks, load thresholds, and backup restore rehearsal.

The release is complete only when every public-launch requirement has direct test or rehearsal evidence; documentation alone is not evidence of production readiness.

## 7. Explicit decisions

- PostgreSQL is authoritative durable storage; Redis is coordination/cache, never the sole source of game history.
- The engine remains deterministic and storage-independent.
- Private projections, not full game state, are the default read model.
- Commands are idempotent and ordered per room.
- Production deployment remains portable and does not require a particular cloud account in source control.
- Optional accounts, ranked play, chat, social features, and custom rule editing remain out of the public casual release boundary until their own security and moderation designs are approved.
