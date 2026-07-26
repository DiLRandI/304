# Private Live Tournaments Design

**Status:** Approved for implementation  
**Date:** 2026-07-26

## Product boundary

A tournament coordinates existing authoritative 304 rooms. It does not change
cards, bidding, trump, trick legality, token scoring, or the normal practice and
private-room contracts.

V1 is a private live event for 6–32 teams using existing 30-day guest sessions.
It has no accounts, substitutes, public directory, chat, logos, game
spectators, cross-tournament rankings, payments, wagering, or betting.

The organizer selects one fixed profile:

- Classic: two-player teams and four alternating seats.
- Six-seat 304-36: three-player teams and six alternating seats.

The remaining immutable-at-lock settings are tournament name, an even team
count, BO1 or BO3 fixtures, bot permission and difficulty, and whether to play a
third-place fixture. Tournament hands always use early outcome settlement.

## Registration and authority

The organizer creates team slots and receives a secret link per slot. The raw
invite token is carried only in the URL fragment. The browser removes it from
the address immediately and exchanges it in a protected request body. Only an
HMAC digest is persisted; rotation invalidates the previous token.

The first human to redeem a team link becomes captain and selects a unique,
Unicode-normalized team name containing 2–32 characters. A guest may belong to
only one team in the tournament, including an organizer who also plays.
Rosters contain exactly two or three positions for the selected profile.

Before lock, captains may rename their team and remove teammates. Organizers
may moderate names, rotate invites, and transfer captaincy. After lock,
settings, names, and membership are immutable. Captaincy may still transfer
between existing members, but only between fixtures.

Without bots, every roster and fixture check-in must be complete. With bots,
each team still needs at least one human. A captain may lock missing positions
to the selected difficulty for the entire fixture.

## Draw and group stage

The draw creates `max(2, floor(teamCount / 4))` groups. Group sizes differ by
at most one and must be between three and five. A published random seed drives
a deterministic shuffle. Redraw is allowed only before lock, produces a new
published seed, and remains in the activity audit.

Each group plays a single round robin. The deterministic circle scheduler
places every pairing exactly once and never schedules a team twice in a round.
The organizer opens rounds; fixtures in an open round may run concurrently.

Group ranking is:

1. underlying 304 match wins;
2. a recursively ranked head-to-head mini-table among tied teams;
3. overall match differential;
4. final-token differential from played matches;
5. deterministic draw order derived from the published seed.

Double forfeits count as a corresponding loss for both teams but award no match
wins. Token margin is absent, rather than zero, for any forfeit result.

## Knockout

The top two teams in each group qualify. Group winners seed above runners-up.
When group sizes differ, match-win rate and differential-per-played-match
provide normalized comparison within each tier before the seeded draw fallback.

The bracket expands to the next power of two. Byes go to the highest seeds.
First-round pairings avoid same-group rematches whenever a valid swap can do so
without changing which seeds receive byes. Later rounds are single elimination.
An optional third-place fixture is generated from the semifinal losers.

BO1 fixtures require one win. BO3 fixtures stop immediately when a team reaches
two wins. A one-team forfeit records 1–0 or 2–0 for the opponent. A double
forfeit records 0–0. No further room action or rematch is accepted after a
series is clinched.

## Room integration

A normal fixture owns one reserved authoritative room for its entire series.
Team A and B map to tournament team IDs and their members occupy alternating
seats. The room projection adds team names, series score, match number,
required wins, completion state, and tournament-board navigation.

Only the two locked lineups may occupy tournament seats. Either seated captain
may advance a completed hand or start the next match. Exceptional recovery may
attach a replacement room while preserving already recorded match wins and the
full room history.

Human and bot/autopilot transitions use one match-completion recorder. The
terminal gameplay snapshot, fixture-game result, updated fixture, audited
tournament event, and outbox notice commit in one PostgreSQL transaction.
Uniqueness on fixture, match index, and terminal room event makes retries safe.

## Context and contracts

`@three-zero-four/tournament-domain` is a pure package containing tournament
states, permission rules, registration invariants, grouping, scheduling,
standings, BO1/BO3 series, forfeits, and bracket generation.

The Fastify tournament context follows the existing application-port and
PostgreSQL-adapter pattern. Contract schemas define:

- `TournamentStatus`: `registration | group_stage | knockout | completed |
  cancelled`;
- profile, series, bot, draw, team, roster, round, fixture, standing, bracket,
  forfeit, activity, private projection, and public-board values;
- a versioned command union for team naming, roster removal, invite rotation,
  captain transfer, draw/redraw, lock, round opening, check-in, lineup lock,
  postponement, forfeit, room recovery, and cancellation.

The HTTP surface provides tournament creation, authenticated private
projections, invite admission, versioned commands, fixture navigation, and
public boards. Authenticated participant/organizer and unauthenticated
public-board streams consume tournament outbox notices.

## Public board and privacy

The shareable board exposes the tournament name and profile, team names,
published draw seed, schedule, results, standings, bracket, champion, and
sanitized administrative activity. It never exposes player/session identities,
invite or action links, room access, spectators, IP addresses, card data, or
private projections.

Completed and cancelled tournament boards are retained for 90 days by default.
Authoritative fixture summaries remain independent of shorter room retention.
Cleanup is bounded, observable, and does not select active tournaments.

## Acceptance

- Property tests cover every even team count from 6 through 32 for balanced
  groups, deterministic draws, unique pairings, collision-free rounds,
  qualification, byes, and first-round rematch avoidance.
- Unit tests cover multi-team ties, series clinching, forfeits, third place,
  permissions, Unicode team names, and roster/lineup locks.
- Integration tests cover migration, startup compatibility, invite rotation,
  idempotency, optimistic conflicts, concurrent completion, atomic human/bot
  results, room recovery, retention, and public-projection privacy.
- Browser acceptance covers organizer, captain, human-only, bot-assisted,
  Classic, six-seat, group, knockout, forfeit, public-board, and champion paths.
- Capacity rehearsal covers 32 teams, 96 six-seat humans, and 16 concurrent
  fixture rooms.
- Release gates include `pnpm check`, production build, integration and
  Playwright suites, Compose health, backup/restore, load smoke, dependency,
  signature, secret/config, and image scans.

