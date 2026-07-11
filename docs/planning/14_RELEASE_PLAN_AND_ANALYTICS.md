# Release Plan and Analytics

## 1. Release strategy

304 Online should be released in stages because rules, UX, and bot quality will benefit from real player feedback.

Recommended stages:

1. Internal validation
2. Closed alpha with friends/testers
3. Private beta for Sri Lankan 304 players
4. Public casual launch
5. Six-player expansion
6. Ranked/competitive mode later

## 2. Stage 1: Internal validation

### Goal

Prove the engine can run a correct hand.

### Scope

- Local-only game table
- Classic 4-seat rules
- Scripted/bot players
- No accounts
- No production backend

### Exit criteria

- Full hand can complete.
- Scoring is correct.
- Engine tests pass.
- Major hidden-trump cases have fixtures.

## 3. Stage 2: Closed alpha

### Goal

Test real-time room flow with small group.

### Scope

- Private rooms
- Guest display names
- 1 to 4 humans
- Bot fill to 4 seats
- Classic rules
- Basic UI

### Exit criteria

- 20+ completed hands without game-breaking bug.
- Reconnect works in basic cases.
- No hidden-card leaks found in testing.
- Testers can understand bidding/trump flow.

## 4. Stage 3: Private beta

### Goal

Get rule feedback from actual 304 players.

### Scope

- Improved mobile UI
- Tutorial/rule drawer
- Bot difficulty setting
- Hand history summary
- Error reporting
- Analytics

### Exit criteria

- Rule disagreements documented.
- Clear decision on default scoring mode.
- Bot blunders reduced.
- Average hand completion rate acceptable.

## 5. Stage 4: Public casual launch

### Goal

Release stable casual web app.

### Scope

- Public landing page
- Private room sharing
- Practice with bots
- Classic 4-seat mode
- Reconnect
- Basic moderation/no chat or limited chat

### Exit criteria

- Production monitoring active.
- Rate limits active.
- Privacy policy and terms available.
- No real-money mechanics.

## 6. Stage 5: Six-player expansion

### Goal

Support 5 to 6 human users directly.

### Scope

- Six-seat 36-card variant
- 3v3 seating
- Bot fill for 1 to 5 missing seats
- Six-seat mobile layout
- Six-seat bot support

### Exit criteria

- Six-seat E2E passes.
- Five-human room adds exactly one bot.
- Six-human room starts without bots.
- Rule profile clearly labeled as a variant.

## 7. Stage 6: Ranked mode later

Ranked mode should wait until casual play is stable.

Required before ranked:

- Strong anti-cheat checks
- Reliable reconnect
- Stable rule profile
- No bots or separate bot-ranked queue
- Abuse/report tools
- Matchmaking fairness

## 8. Analytics plan

Analytics should answer product-quality questions, not collect unnecessary personal data.

### Activation metrics

| Metric | Why it matters |
|---|---|
| Landing to room create rate | Measures entry clarity |
| Practice start rate | Measures solo accessibility |
| Invite join success rate | Measures sharing flow |
| Room start rate | Measures lobby friction |

### Gameplay metrics

| Metric | Why it matters |
|---|---|
| Hands completed per room | Core engagement |
| Hand abandonment rate | Stability/UX issue indicator |
| Average hand duration | Pacing |
| Average action wait time | Timer/bot pacing |
| Bot fill rate | Importance of bot feature |
| Human count distribution | Validates 1-6 support needs |

### Rule metrics

| Metric | Why it matters |
|---|---|
| Average bid | Balancing/bot tuning |
| Bid success rate | Bot and player difficulty |
| High bid frequency | Rule pacing |
| Trump opened timing | Closed-trump UX understanding |
| Illegal action attempts | UI clarity |

### Reliability metrics

| Metric | Why it matters |
|---|---|
| Reconnect success rate | Multiplayer quality |
| WebSocket disconnects per hand | Network experience |
| Server action latency | Responsiveness |
| Bot decision latency | Game pacing |
| Game crash rate | Launch readiness |

## 9. Suggested analytics events

```ts
type AnalyticsEvent =
  | 'landing_viewed'
  | 'practice_started'
  | 'room_created'
  | 'room_joined'
  | 'room_started'
  | 'bot_fill_completed'
  | 'hand_started'
  | 'bid_made'
  | 'bid_passed'
  | 'trump_selected'
  | 'trump_opened'
  | 'card_played'
  | 'illegal_action_rejected'
  | 'hand_completed'
  | 'match_completed'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'room_abandoned';
```

## 10. Event property examples

### `room_started`

```json
{
  "ruleProfileId": "classic_304_4p",
  "activeSeatCount": 4,
  "humanCount": 2,
  "botCount": 2,
  "botDifficulty": "normal"
}
```

### `hand_completed`

```json
{
  "ruleProfileId": "classic_304_4p",
  "finalBid": 200,
  "bidSucceeded": true,
  "trumpOpenedTrickIndex": 2,
  "durationSeconds": 420,
  "botCount": 2
}
```

Avoid storing raw hidden hand data in analytics.

## 11. Feedback plan

### In-app feedback

After hand result:

```text
How was this hand?
[Rules felt correct] [Bot made strange move] [UI was confusing] [Report bug]
```

### Rule feedback form

Collect:

- Region/local rule style
- Which rule differed
- Expected behavior
- Optional screenshot/replay ID

## 12. Beta tester checklist

Ask testers to try:

- 1-human practice
- 2-human room with bots
- 4-human full room
- Reconnect during bidding
- Reconnect during trick play
- Closed trump cutting
- High bid hand
- Mobile browser play

## 13. Launch risks

| Risk | Launch mitigation |
|---|---|
| Players disagree with rules | Rule profile labels and feedback form |
| Bot play too weak | Difficulty tuning and practice framing |
| Mobile UI cramped | Mobile-first beta testing |
| Reconnect bugs | Conservative timers and autopilot |
| Long game length | Short scoring mode option |

## 14. Release acceptance criteria

Public casual launch is ready when:

- Classic private rooms are stable.
- Practice with bots works.
- Hidden state projection tests pass.
- Reconnect works in common cases.
- Error monitoring is live.
- User-facing rules page exists.
- No gambling or real-money mechanics are present.

## 15. Production launch checklist (Vercel + pnpm)

### Infrastructure and hosting

- Keep the documented hosting architecture current:
  - The target topology hosts the release-facing Next.js frontend on Vercel.
  - The Fastify API and worker remain long-running services backed by
    PostgreSQL and Redis.
- Keep deployment manifests and health checks for frontend/backend parity.
- Record rollback plan per component boundary.
- Keep `server.js` as a compatibility baseline, not the release-facing source
  of game authority.
- The Vercel frontend calls only the documented game-service contracts and
  never owns room state.
- Verify the game service `/livez` and `/readyz` probes before frontend
  promotion.

### Framework decision alignment

- Keep the implemented Next.js, Fastify, PostgreSQL, and Redis boundaries
  aligned with `docs/technical/13_PLATFORM_AND_SUPPLY_CHAIN.md`.
- Do not move authoritative game state into the browser or request-scoped
  frontend functions.
- Migration owners:
  - Product:
  - Engineering:
  - Release QA:
- Triggered migration approval requires migration plan signed by all owners.

### Supply-chain and dependency checks

- pnpm-only installs.
- `pnpm install --frozen-lockfile` in CI and release jobs.
- `pnpm audit --audit-level=high` before publish.
- Treat lockfile and dependency graph changes as production-impacting items requiring review.
- Require `corepack prepare pnpm@11.10.0 --activate` in runners.
- Use `pnpm install --ignore-scripts --frozen-lockfile` for dependency review reproductions.
