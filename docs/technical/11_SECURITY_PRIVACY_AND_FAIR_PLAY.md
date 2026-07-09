# Security, Privacy, and Fair Play

## 1. Feature summary

304 Online is a hidden-information multiplayer game. Security is not only account protection; it is part of gameplay correctness. The app must prevent hidden card leaks, action tampering, impersonation, spam, and unfair bot behavior.

## 2. Security goals

- Keep hidden cards hidden.
- Prevent clients from making illegal moves.
- Prevent users from acting as another seat.
- Support reconnect without exposing extra information.
- Make shuffling fair and auditable enough for casual play.
- Avoid gambling, wagering, and real-money mechanics.
- Protect user data and guest sessions.

## 3. Threat model

| Threat | Example | Mitigation |
|---|---|---|
| Hidden-card leak | Client receives all hands in JSON | Private state projection tests |
| Action spoofing | User sends action for another seat | Server maps session to seat |
| Illegal move | User edits request to play invalid card | Server-side validation |
| Replay attack | User resends old valid action | Event version and phase checks |
| Room spam | User creates thousands of rooms | Rate limits and expiry |
| Bot unfairness | Bot sees all hidden hands | Bot information-state boundary |
| Collusion | Users share hidden info externally | Ranked detection later; cannot fully prevent in private rooms |
| Account abuse | Bad usernames/chat | Moderation, filters, reports if chat exists |

## 4. Hidden information policy

### Never send to a client

- Other players' hand card IDs
- Hidden trump suit/card before reveal
- Face-down card identities if not revealed
- Full deck order
- Bot hidden hands
- Server RNG seed before hand completion

### Safe to send

- Own hand
- Public bid history
- Public scores
- Public trick cards
- Card backs for hidden zones
- Revealed trump after legal reveal
- Hand summary after hand completion

## 5. Projection tests

Every game state projection should be tested.

Example test cases:

- Player A view contains Player A hand but not Player B hand.
- Hidden trump card shows only card back to non-trump maker.
- Face-down non-trump discard remains hidden after trick if not revealed.
- Spectator view never contains hidden hands.
- Reconnected user receives only their own private view.

## 6. Authentication and session security

### Guest sessions

- Use signed HTTP-only session cookies where possible.
- Store session ID server-side or use short-lived signed token.
- Bind WebSocket connection to session.
- Do not trust display name as identity.

### Registered accounts later

- Use OAuth or email magic link.
- Store passwords only if necessary, with modern password hashing.
- Provide account deletion/export if user accounts persist data.

## 7. Authorization rules

| Action | Required authorization |
|---|---|
| Change room settings | Host only before game start |
| Start game | Host only |
| Select seat | Room participant, seat empty or replaceable bot |
| Bid/play/select trump | Occupant of active seat |
| Bot action | Server bot controller only |
| View private hand | Occupant of that seat only |

## 8. Anti-cheat rules

### Server-authoritative validation

Never accept client-calculated results.

Reject:

- Out-of-turn actions
- Playing card not in hand
- Playing hidden trump indicator illegally
- Bids outside rules
- Fake reconnect as another user
- Invalid room setting changes after lock

### Version checks

Every action should include last known event version.

```ts
interface ClientActionEnvelope {
  roomId: string;
  action: GameAction;
  clientKnownVersion: number;
}
```

Server can reject or rebase stale actions.

## 9. Fair shuffle

### MVP

- Use server-side secure random shuffle.
- Store shuffle seed securely until hand completion.
- Do not expose deck order.

### P1 verifiable shuffle

After hand ends, reveal:

- Hand ID
- Shuffle seed commitment made before deal
- Final seed after hand
- Deterministic shuffle algorithm version

This allows advanced users to verify that the shuffle was not changed mid-hand.

## 10. Bot fairness

Bots must be constrained by a private view.

Security requirements:

- Bot policy function should not receive full `GameState`.
- Add tests that fail if hidden hand data is present in bot context.
- Bot logs should avoid dumping hidden data visible to client logs.
- Strong bots may simulate unknown cards, but not inspect actual hidden cards.

## 11. Rate limiting

Recommended limits:

| Action | Limit |
|---|---:|
| Create room | 10 per hour per IP/session |
| Join attempts | 30 per hour per IP/session |
| WebSocket actions | 5 per second per connection |
| Chat messages if enabled | 10 per minute |
| Display name changes | 10 per day |

## 12. Privacy

### Data collected in MVP

- Display name
- Guest session ID
- Room/game IDs
- Gameplay events
- Basic analytics
- Error logs

### Data to avoid collecting

- Precise location
- Contact lists
- Unnecessary personal details
- Payment information
- Real names unless user chooses them

### Retention

Recommended:

- Guest sessions expire after a reasonable period.
- Abandoned room logs are deleted or anonymized after a set retention window.
- Aggregated analytics can be kept longer.

## 13. Chat safety

Chat is not required for MVP.

If added:

- Add profanity/abuse filters.
- Allow mute/report.
- Do not allow image/file upload in table chat for MVP.
- Rate limit messages.
- Provide block controls.

## 14. No gambling or wagering

The app should explicitly avoid:

- Real-money bets
- Cash prizes
- Chips that imply cash value
- Crypto/token rewards
- Betting leaderboards
- Links to gambling services

Use neutral language:

- “tokens” only as in-game scoring counters
- “score”
- “match points”

Avoid casino visual language.

## 15. Incident response

For production:

1. Detect suspicious errors or leaks.
2. Disable affected rule profile if needed.
3. Preserve event logs for investigation.
4. Patch engine tests.
5. Publish clear release note.

## 16. Security acceptance criteria

Security/fair play is acceptable when:

- Clients never receive hidden hands in normal or reconnect flows.
- Server rejects illegal actions.
- Bots operate from private views.
- Room settings cannot be maliciously changed mid-hand.
- Guest sessions cannot control another user's seat.
- Basic rate limits are active.
- App has no real-money gambling mechanics.

## 17. Supply-chain and install security

Product and deployment security now includes dependency integrity checks and reproducible installs.

### Package manager policy

- The project uses **pnpm** for deterministic dependency resolution.
- Never use `npm install`/`yarn install` for this repository.
- Keep `pnpm-lock.yaml` in VCS and make lockfile changes part of code review.

### CI and release hardening

For every release candidate:

- Run `pnpm install --frozen-lockfile`.
- Run `pnpm audit --audit-level=high`.
- Run `pnpm audit signatures` to verify package registry signatures.
- Block release if either command fails.
- Use `corepack use pnpm@11.10.0` before dependency-sensitive checks.
- For security incident rehearsals, run `pnpm install --ignore-scripts --frozen-lockfile`.

### Recommended pnpm supply-chain controls (Next.js migration track)

When migrating to managed frontend tooling, keep these controls in `pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
blockExoticSubdeps: true
trustPolicy: no-downgrade
```

Operational guardrails:

- `minimumReleaseAge` delays newly published versions from being accepted immediately.
- `minimumReleaseAgeStrict` ensures delayed installs fail if the requested range cannot satisfy the age gate.
- `blockExoticSubdeps` prevents transitive dependencies from using git/tarball URL sources.
- `trustPolicy` rejects trust regression for packages that publish lower-trust provenance.

### Secure dependency policy addendum

- Keep all dependency changes behind a lockfile review gate in PR/release flow.
- Require immutable lockfile installs for release:
  - `pnpm install --frozen-lockfile`.
- Require explicit vulnerability thresholds:
  - `pnpm audit --audit-level=high`.
- Require signature verification for any dependency drift:
  - `pnpm audit signatures`.
- Treat findings as blockers for production release approval.

### Supply-chain attack defense profile

| Threat | Preventive control |
|---|---|
| Lockfile drift attack | Require review of every `pnpm-lock.yaml` delta before release |
| Typosquat / dependency substitution | Keep dependency graph review in release branch signoff |
| Malicious lifecycle scripts | Use `--ignore-scripts` for incident verification runs |
| Registry poisoning or unexpected source changes | Verify package source policy and maintain registry restrictions |
| Hidden transitive supply-chain risk | Prefer direct dependency visibility in reviews and avoid large transitive changes |

### Vercel + backend posture

- For Vercel-hosted frontend, keep game stateful processing on a long-running backend service.
- Use a runtime-only secret and API token policy that is scoped per environment.
- Do not bundle server-only secrets into the frontend bundle.
- Record and retain deployment checks for `security` and `hosting` items in release notes.
