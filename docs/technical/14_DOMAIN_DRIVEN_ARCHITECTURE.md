# Domain-Driven Architecture

## Decision

304 Online uses pragmatic modular domain-driven design inside the existing
Next.js, Fastify, worker, PostgreSQL, and Redis deployment topology. The
dependency direction is always:

`adapters → application → domain`

Domain code contains the game language and invariants. Application code
coordinates use cases and ports. Adapters translate HTTP, WebSocket,
persistence, scheduling, and browser concerns at the system edge.

This is not a microservice split. Bounded contexts remain independently
testable modules until operational evidence justifies another deployable.

## Context map

### Gameplay

Gameplay is the core domain. It owns cards, profiles, bidding, trump, legal
plays, tricks, scoring, hand progression, match progression, legal actions,
and bot decisions.

Gameplay accepts typed commands and produces typed domain events. State
transitions are deterministic for explicit clock and entropy inputs. The
domain does not import transport schemas, Node randomness, databases, Redis,
frameworks, or UI code.

### Room Management

Room Management is a supporting domain. It owns invite references, hosts,
seats, membership, room settings, lobby/start policy, leaving, host transfer,
connection state, and room lifecycle.

Room Management coordinates a Gameplay state through application ports. It
does not implement card rules or expose private game state.

### Player Access

Player Access is a supporting context for guest players and sessions. It owns
display-name policy, session creation, authentication, expiry, last-seen
updates, and revocation. It knows player identity but not gameplay rules.

### Automation

Automation is an application capability rather than a separate game model. It
interprets room/game state, schedules durable jobs, and invokes the same
application commands used for human actions. Bot, timeout, disconnect, and
trick-advance jobs never mutate snapshots directly.

### Delivery and operations

HTTP, WebSocket, workers, PostgreSQL, Redis, metrics, logging, configuration,
and deployment are adapters. They may depend inward on applications and
domains. No inward layer may depend back on them.

The Next.js application is a projection consumer. It organizes code by player
access, room entry, lobby, gameplay, and preferences, but it does not import
the authoritative Gameplay or Room Management domains.

## Target modules

```text
packages/
  gameplay/                 strict TypeScript gameplay domain
  room-domain/              strict TypeScript room domain
  contracts/                versioned wire schemas only

apps/game-service/src/
  contexts/
    player-access/
    rooms/
    gameplay/
    automation/
  delivery/
    http/
    realtime/
    workers/
  platform/
  bootstrap/

apps/web/src/
  features/
    consent/
      model/
      ui/
    preferences/
      ui/
    room/
      api/
      application/
      hooks/
      model/
      ui/
    rules/
      ui/
  lib/                       stable browser infrastructure only
```

There is no generic shared-kernel package. Code is shared only after its owner
and stability are explicit.

### Frontend feature cores

The browser consumes server projections through feature-local layers. A feature
`model` may depend only on its own model code, wire contracts, and stable shared
utilities. It cannot import application, API, hooks, UI, React, or Next.js.
Feature `application` ports may depend on models and wire contracts, but not API,
hooks, UI, React, or Next.js. API adapters, hooks, and UI depend inward.

Generic `src/components` ownership is forbidden. Cross-feature UI imports are
allowed only when the imported feature owns the concept, such as the room table
using the rules feature's drawer.

## Command and persistence boundary

One accepted room command remains one atomic versioned commit:

1. A delivery adapter validates the current `/v1` or WebSocket DTO.
2. Player Access authenticates the actor.
3. An application use case acquires the room lease and begins a unit of work.
4. Persistence adapters rehydrate Room Management and Gameplay state.
5. The domains decide and evolve typed events.
6. One PostgreSQL transaction records room/seat changes, the accepted event,
   exact snapshot, deduplication result, outbox notice, and automation jobs.
7. A server-side projector returns only the viewer's private projection.

PostgreSQL is authoritative. Redis provides coordination, presence, rate
limits, and notifications, but never accepted history.

## Compatibility policy

The migration preserves current `/v1` routes, cookies, WebSocket payloads,
error codes, idempotency keys, room versions, database rows, event payloads,
snapshot schema, realtime resync, and hidden-information behavior.

Transport contracts form an anti-corruption layer. Domain code never imports
`@three-zero-four/contracts`; delivery mappers translate between wire DTOs and
domain commands/results. Legacy snapshot and event codecs remain until every
persisted state is readable through the new modules.

The root static runtime and old game-engine facade are migration scaffolding.
They are removed only after public behavior, persistence, browser, recovery,
and release-rehearsal parity is proven.

## Enforced rules

The architecture boundary test parses imports with the repository's existing
TypeScript compiler dependency and rejects:

- framework or infrastructure imports from pure domain packages;
- adapter, delivery, or platform imports from service domain/application code;
- imports from one bounded context's application layer into another context;
- authoritative domain package imports from the browser;
- outward framework or feature-layer imports from frontend model/application code;
- ownerless files in the browser's generic `src/components` directory;
- relative source dependency cycles in the guarded module roots.

Every new context starts inside these guarded roots. Exceptions require an
explicit architecture decision, not a suppression in application code.
