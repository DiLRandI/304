# 304 Online Web App Documentation Bundle

**Document version:** 1.0  
**Date:** 2026-07-07  
**Product name used in these docs:** **304 Online**  
**Requested platform:** Web application  
**Requested player support:** 1 to 6 human users, with bot users filling empty seats

This bundle contains product, feature, architecture, and implementation planning documents for building a web-based version of the Sri Lankan card game **304**.

## Important product assumptions

304 has several regional rule sets. The recommended MVP supports two table modes:

1. **Classic 304, 4 seats**  
   Uses the common Sri Lankan 4-player partnership game: 2 teams of 2, 32 cards, 8 cards per player.

2. **Six-player 304, 6 seats**  
   Uses a configurable 6-seat variant. The recommended implementation is the 36-card variant with 6s added as zero-point cards, 2 teams of 3, and 6 cards per player. A second 24-card compact variant can be added as a table rule later.

For human counts below the selected table size, the server fills empty seats with bot users. Examples:

| Human users | Recommended table | Bot users added | Result |
|---:|---|---:|---|
| 1 | 4-seat Classic Practice | 3 | 1 human + 3 bots |
| 2 | 4-seat Classic | 2 | 2 humans + 2 bots |
| 3 | 4-seat Classic | 1 | 3 humans + 1 bot |
| 4 | 4-seat Classic | 0 | 4 humans |
| 5 | 6-seat Variant | 1 | 5 humans + 1 bot |
| 6 | 6-seat Variant | 0 | 6 humans |

The host may also manually choose 6-seat mode for 1 to 4 humans if they want to practice that variant with bots.

## Source note

Rule details are primarily based on public 304 rules from Pagat, which documents the standard Sri Lankan 4-player game, card ranks, point values, bidding, trump behavior, scoring, and six-player variants. Wikipedia is used only as a secondary orientation source. Where public sources describe variants as incomplete or inconsistent, these docs make explicit product assumptions instead of pretending there is one universal rule.

## Document map

| File | Purpose |
|---|---|
| `01_PRD.md` | Full product requirements document |
| `02_FULL_FEATURE_LIST.md` | Detailed feature list grouped by product area |
| `03_GAME_RULES_AND_VARIANTS.md` | Game rules, table modes, and variant assumptions |
| `feature_docs/04_ROOM_MATCHMAKING_AND_BOT_FILL.md` | Room creation, seats, teams, invites, and bot fill |
| `feature_docs/05_GAMEPLAY_ENGINE.md` | Game engine behavior, state machine, actions, validation |
| `feature_docs/06_BIDDING_TRUMP_AND_SCORING.md` | Bidding, trump selection, closed/open trump, scoring tokens |
| `feature_docs/07_BOT_AI.md` | Bot users, bot decision logic, difficulty, pacing |
| `feature_docs/08_UI_UX_ACCESSIBILITY.md` | Web UI, screens, card interactions, accessibility |
| `technical_docs/09_ARCHITECTURE.md` | System architecture, components, deployment model |
| `technical_docs/10_DATA_MODEL_AND_API.md` | Data model, REST endpoints, WebSocket events |
| `technical_docs/11_SECURITY_PRIVACY_AND_FAIR_PLAY.md` | Security, privacy, anti-cheat, fair play |
| `technical_docs/12_QA_TEST_PLAN.md` | Testing strategy and acceptance tests |
| `planning/13_TODO_IMPLEMENTATION_ROADMAP.md` | Build roadmap and task checklist |
| `planning/14_RELEASE_PLAN_AND_ANALYTICS.md` | MVP/beta/release plan and analytics |
| `15_GLOSSARY.md` | Glossary of 304 and app terminology |
| `16_REFERENCES.md` | External references and rule source notes |

## Recommended MVP cut

A realistic MVP should include:

- Browser-based lobby and private rooms
- Classic 4-seat 304
- 1 to 4 humans with bot fill
- Server-authoritative gameplay engine
- Closed trump, open trump, bidding, trick play, scoring tokens
- Beginner bots
- Reconnect support
- Basic mobile responsive UI
- Tutorial overlay and rule summary

The 6-seat variant can be included in MVP if the team has time, but it is safer to build the engine with seat-count configuration first and launch ranked/casual play around the 4-seat mode.
