# Full Feature List

This file lists the complete feature surface for **304 Online**. Features are grouped by product area and labeled by priority.

Priority labels:

- **P0:** Required for MVP
- **P1:** Should ship soon after MVP
- **P2:** Useful later
- **P3:** Long-term or experimental

## 1. Entry and onboarding

| Priority | Feature | Description |
|---|---|---|
| P0 | Landing page | Explain the app, show Play Now, Create Room, Join Room, Practice |
| P0 | Guest display name | Allow users to play without account creation |
| P0 | Practice with bots | Start immediately with 1 human and bot-filled seats |
| P0 | Basic tutorial | Explain ranks, points, bidding, trump, and tricks |
| P1 | Optional account | Persist stats, name, settings, and match history |
| P1 | Returning user flow | Restore recent rooms and preferences |
| P2 | Sinhala/Tamil onboarding | Localized introduction and rule terms |
| P2 | Guided first hand | Interactive coaching during first full hand |

## 2. Lobby and room management

| Priority | Feature | Description |
|---|---|---|
| P0 | Create private room | Host creates room with invite code/link |
| P0 | Join by code/link | Users join a room directly |
| P0 | Auto table size | Choose 4-seat or 6-seat mode based on human count |
| P0 | Manual table mode | Host can choose Classic 4-seat or Six-seat variant |
| P0 | Bot fill on start | Empty seats fill with bot users |
| P0 | Seat selection | Humans can choose open seats before start |
| P0 | Team display | Show teams and seating order clearly |
| P0 | Ready/start controls | Host can start when at least 1 human is present |
| P1 | Public casual queue | Match users into available rooms |
| P1 | Rematch room | Continue with same players and bots |
| P1 | Room settings lock | Prevent setting changes after ready phase |
| P2 | Friend invites | Invite saved contacts/friends |
| P2 | Spectator mode | Watch table with hidden information protected |
| P2 | Room chat | Limited text/chat reactions with moderation controls |

## 3. Rule profiles

| Priority | Feature | Description |
|---|---|---|
| P0 | Classic 4-seat profile | Standard Sri Lankan 304 baseline |
| P0 | Rule engine config | Game rules loaded through a profile object |
| P0 | Card rank config | Define rank order and point values per profile |
| P0 | Scoring token config | Define bid success/failure token movement |
| P1 | Six-seat 36-card profile | 6 players, two teams of three, 6s included as zero-point cards |
| P1 | Caps toggle | Enable/disable strict Caps enforcement |
| P1 | Spoilt trump toggle | Enable/disable spoilt trump variant |
| P2 | Six-seat 24-card profile | Compact 6-player mode without 7s and 8s |
| P2 | Regional profiles | Named rule sets such as Jaffna-style, casual family rules, custom |
| P3 | Custom rule editor | Host can create saved rule profiles |

## 4. Dealing and shuffling

| Priority | Feature | Description |
|---|---|---|
| P0 | Server shuffle | Server generates shuffled deck; client cannot manipulate deal |
| P0 | Cryptographic random seed | Use secure randomness for fairness |
| P0 | Deal phases | Support first deal batch, bidding, then final deal batch |
| P0 | Private hands | Only each player sees their own cards |
| P1 | Verifiable shuffle log | Reveal hand seed after hand completion for auditability |
| P2 | Casual legacy shuffle | Optional mode mimicking local minimal shuffle tradition, if wanted |

## 5. Bidding

| Priority | Feature | Description |
|---|---|---|
| P0 | Four-card bidding | Bidding after first batch of cards |
| P0 | Pass | Player may pass when allowed |
| P0 | Bid validation | Enforce minimums, increments, partner constraints, turn order |
| P0 | All-pass hand cancel | End hand with no score if all pass |
| P0 | Highest bidder selection | Determine trump maker |
| P1 | Ask partner to bid | Add partner-bid mechanic after baseline is stable |
| P1 | Eight-card bidding | Second bidding round after all cards are dealt |
| P1 | Bid history UI | Show bid log and current winning bid |
| P2 | Advanced bid hints | Suggest safe/ambitious bids in practice mode |

## 6. Trump system

| Priority | Feature | Description |
|---|---|---|
| P0 | Trump indicator card | Trump maker places selected card face down |
| P0 | Closed trump game | Default hidden trump mode |
| P0 | Open trump game | Trump maker can reveal before first trick where allowed |
| P0 | Hidden trump UI | Show face-down indicator and legal states |
| P0 | Trump reveal rules | Reveal when legal, including cutting behavior |
| P1 | 250+ bid reveal rule | Reveal trump after first trick for high bids |
| P1 | Exhausted trump rule | Enforce where enabled |
| P2 | Spoilt trump flow | Optional declare/validate/redeal flow |

## 7. Trick play

| Priority | Feature | Description |
|---|---|---|
| P0 | Turn order | Counter-clockwise order from leader |
| P0 | Legal card selection | Must follow suit if possible |
| P0 | Cutting | Play trump when unable to follow suit |
| P0 | Face-down play | In closed trump before trump opens, unable-to-follow cards played face down |
| P0 | Trick winner calculation | Highest trump or highest led-suit card |
| P0 | Trick pile ownership | Assign each trick to winning team |
| P0 | Next trick leader | Winner leads next trick |
| P1 | Previous trick review | Allow latest trick review only, respecting hidden cards |
| P1 | Animation | Smooth card play and trick collection |
| P2 | Replay viewer | Watch completed hands from known-information perspective |

## 8. Scoring and match progression

| Priority | Feature | Description |
|---|---|---|
| P0 | Card point counting | Sum points won by trump maker's team |
| P0 | Bid success/failure | Determine whether bidder team reached bid |
| P0 | Token scoring | Move tokens according to bid tier |
| P0 | Game-over condition | First team to collect all tokens or opponent loses all tokens, depending profile |
| P1 | Caps scoring | Extra or penalty tokens for Caps behavior |
| P1 | Scoreboard | Persistent room scoreboard and hand history |
| P2 | Stats | Per-player hands won, bids made, bid success rate |
| P2 | Ranked scoring | Separate rating system from table tokens |

## 9. Bot users

| Priority | Feature | Description |
|---|---|---|
| P0 | Auto-fill bots | Fill every empty seat at game start |
| P0 | Bot label | Clearly show bot seats |
| P0 | Legal move bot | Bot always makes legal actions |
| P0 | Beginner heuristics | Basic bidding/trump/trick strategy |
| P0 | Bot delay | Simulate natural thinking delay |
| P1 | Difficulty levels | Easy, Normal, Strong |
| P1 | Team-aware play | Bot avoids wasting partner winners when obvious |
| P1 | Card memory | Bot tracks public cards played |
| P2 | Monte Carlo bot | Simulate hidden hands to choose stronger actions |
| P2 | Bot personalities | Conservative, aggressive, learner-friendly |
| P3 | Training mode bot explanations | Bot explains why it made a move after hand ends |

## 10. Web UI

| Priority | Feature | Description |
|---|---|---|
| P0 | Responsive table | Works on desktop and mobile browser |
| P0 | Player hand | Sort, select, and play cards |
| P0 | Current trick area | Show played cards and turn indicator |
| P0 | Bid panel | Show legal bids and pass button |
| P0 | Trump panel | Show face-down/open trump indicator |
| P0 | Score panel | Show token counts, bid, team points |
| P0 | Action prompts | Clear text such as “Your turn: follow Hearts” |
| P1 | Drag-and-drop cards | Desktop-friendly interaction |
| P1 | Tap-to-play confirmation | Prevent accidental plays on mobile |
| P1 | Theme options | Light/dark/table-felt styles |
| P1 | Sound effects | Optional card and trick sounds |
| P2 | Local language UI | Sinhala and Tamil translations |
| P2 | Custom card assets | Select card backs or custom themes |

## 11. Accessibility

| Priority | Feature | Description |
|---|---|---|
| P0 | Keyboard navigation | Select and play cards without mouse |
| P0 | Card screen-reader labels | “Jack of Spades, 30 points” |
| P0 | Color-independent suits | Use suit icons and labels, not color alone |
| P0 | Reduced motion | Disable animations |
| P1 | Large card mode | Bigger cards for small screens/low vision |
| P1 | High contrast mode | Improve readability |
| P2 | Voice guidance | Read current prompt and trick summary |

## 12. Reconnect and resilience

| Priority | Feature | Description |
|---|---|---|
| P0 | Reconnect same seat | User returns to table after network loss |
| P0 | Grace period | Preserve seat temporarily |
| P0 | Bot autopilot | Bot acts for disconnected user after timer |
| P0 | State resync | Client receives correct private game view on reconnect |
| P1 | Pause private room | Host can pause between hands |
| P1 | Leave after hand | Replace leaving player with bot between hands |
| P2 | Save long match | Resume later from room history |

## 13. Fair play and security

| Priority | Feature | Description |
|---|---|---|
| P0 | Server-authoritative game | Client sends intents only |
| P0 | Private state projection | Each client receives only what they are allowed to know |
| P0 | Action validation | Server rejects invalid bids/cards/actions |
| P0 | Rate limiting | Prevent spam and abuse |
| P0 | No wagering | No gambling or real-money betting features |
| P1 | Audit log | Debug disputes and crashes |
| P1 | Abuse reporting | Report usernames/chat if chat is enabled |
| P2 | Ranked anti-collusion | Detect suspicious repeat partnerships later |

## 14. Admin and operations

| Priority | Feature | Description |
|---|---|---|
| P1 | Admin dashboard | Monitor rooms, crashes, active users |
| P1 | Rule profile toggles | Enable/disable experimental variants |
| P1 | Bot tuning flags | Adjust bot behavior without deploy |
| P1 | Error monitoring | Track client/server errors |
| P2 | Replay inspection | Review problematic hands |
| P2 | Tournament management | Scheduled events after ranked mode |
