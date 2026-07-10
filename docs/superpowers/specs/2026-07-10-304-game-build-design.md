# 304 Game Build Design

## Context

The repository is a custom Node.js server with a static HTML/CSS/JavaScript client. It already contains a server-authoritative game engine, room and session APIs, bot filling, rule profiles, card artwork, and product documentation for Sri Lankan 304. The current runtime has a boot defect: the static-file path guard rejects `/`, so the browser receives a 404 instead of `index.html`.

This build will complete and harden the existing game rather than migrate the runtime to Next.js, introduce a canvas engine, or replace the current room model.

## Product outcome

Players can open the app and complete a playable 304 match in quick practice mode with bots. The same engine and API remain usable for private/public rooms and human players. At every phase the player can identify the required action, see the relevant public state, and submit only legal actions.

The acceptance journey is:

1. Load `/` and see the setup screen without browser or server errors.
2. Start quick practice with one human seat and bot fill.
3. See a lobby with seats, room information, and a start action.
4. Start a hand and progress through four-card bidding, trump selection, optional second bidding, and trick play.
5. Finish the hand, see the scoring/token result, and start the next hand or rematch.
6. Repeat the flow at a narrow mobile viewport without losing the action prompt or playable hand.

## Architecture

### Simulation boundary

`src/engine/engine.js` owns serializable game state and transitions. It remains the source of truth for:

- profile and seat configuration;
- dealing and seeded shuffle metadata;
- bidding rounds and legal bid validation;
- trump selection/open/closed state;
- trick legality, face-down behavior, and winner resolution;
- hand scoring, token movement, and match completion;
- bot action selection and action logs.

Gameplay rules stay in engine functions and are not duplicated in DOM event handlers. Any new rule helper must accept explicit state/input arguments and return a deterministic result or a structured rejection reason.

### Room boundary

`server.js` owns sessions, room lifecycle, seat ownership, presence, API validation, bot scheduling, and per-seat state sanitization. The server continues to call the engine for every action and never trusts a client-provided state snapshot. Hidden hands and closed trump remain excluded from each viewer's public response.

### Client boundary

`src/ui/app.js` owns API orchestration, rendering, input mapping, announcements, local preferences, and reconnect behavior. The DOM remains the default surface for HUD, menus, form controls, labels, and accessibility. Card actions are rendered from `legalActions` supplied by the server, with ARIA labels describing rank, suit, points, and face-down state.

`styles.css` owns responsive layout, interaction states, contrast, reduced motion, and card sizing. Card presentation may use the existing asset manifest, but gameplay continues to use card IDs and metadata as the stable contract.

### Static serving

The static-file guard will treat `/` as the known index route before rejecting traversal or absolute filesystem paths. Other paths remain constrained to the repository root and unknown files return 404. This preserves the current security posture while making the app bootable.

## Gameplay behavior

The build will preserve the documented profiles and phase names:

- `classic_304_4p` for four seats and the standard 32-card deck;
- `six_304_36` for six seats and the 36-card variant;
- `four_bidding` with legal bid increments and passes;
- `trump_selection` and `trump_choice` with viewer-safe trump visibility;
- `second_bidding` when enabled by the room and profile;
- `trick_play` with follow-suit enforcement and legal cutting/face-down actions;
- `hand_result` and `match_complete` with transparent scoring output.

Bots will only receive their own hand plus public state and legal actions. They must return a legal action or pass control back to the server without mutating hidden state. Bot pacing remains server-controlled so the client cannot accelerate or reorder turns.

## UI and interaction

The game screen will maintain a clear hierarchy:

1. phase/status prompt;
2. scoreboard, trump state, and current trick;
3. seat/team state;
4. the player's hand and legal actions;
5. expandable bid history, previous trick, and audit details.

The first actionable control in each state will be keyboard reachable. Playable cards will have readable text labels and focus styling. Illegal moves will be prevented by the engine and explained by the returned reason. Motion is controlled by the existing speed setting and can be reduced to zero.

## Verification strategy

Verification is layered:

- syntax and import checks for server, engine, bot, and client modules;
- direct engine checks for deck size, legal action generation, follow-suit enforcement, phase progression, and score transitions;
- API smoke checks for health, root static serving, guest session, room creation, room start, state sanitization, and action submission;
- browser checks for boot, quick practice, lobby, first turn, responsive layout, and console errors;
- screenshot evidence for setup, lobby, and in-hand states at desktop and mobile widths.

The final handoff will report any unresolved constraints separately. The game is complete only when the acceptance journey can be exercised from the browser and the relevant checks pass against the current worktree.

## Non-goals for this build

- migrating the current app to Next.js or Vercel;
- adding persistent database-backed rooms;
- implementing ranked matchmaking, accounts, payments, or chat;
- adding a new renderer or replacing the supplied card artwork;
- expanding Caps beyond the documented profile flags unless the existing engine requires it for the acceptance journey.
