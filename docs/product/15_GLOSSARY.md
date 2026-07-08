# Glossary

## 304 terms

| Term | Meaning |
|---|---|
| 304 | Sri Lankan trick-taking card game named for the 304 total card points in the Classic deck |
| Bid | A promise that the bidder's team will win at least a certain number of card points |
| Trump | The suit that beats non-trump suits in tricks |
| Trump maker | The player who wins bidding and chooses trump |
| Trump indicator | The face-down card selected by trump maker to determine trump |
| Closed trump | Trump is hidden at the start of play |
| Open trump | Trump is revealed before play starts or after a rule-triggered reveal |
| Trick | One round of cards, one card from each active player |
| Lead / Call | Play the first card to a trick; in Sri Lankan English, leading is often called “calling” |
| Follow suit | Play a card of the same suit as the led card when able |
| Cut | Trump a trick when unable to follow the led suit |
| Card points | Points printed by game rules on cards, such as J=30 and 9=20 |
| Token | Match scoring unit won/lost after a hand |
| Caps | Winning every trick in the hand |
| Wrong Caps | Calling Caps too early, too late, or incorrectly under strict rules |
| Spoilt trumps | Variant situation where trump maker's opponents hold no trumps |
| Partner Close Caps | High bid where bidder attempts to win all tricks without partner participation |

## Card terms

| Term | Meaning |
|---|---|
| Suit | Spades, Clubs, Diamonds, Hearts |
| Rank | Card label such as J, 9, A, 10, K, Q, 8, 7 |
| Jack | Highest rank in Classic 304, worth 30 points |
| Nine | Second-highest rank in Classic 304, worth 20 points |
| Zero-point card | A card worth 0 points, such as 8 or 7 in Classic |

## App terms

| Term | Meaning |
|---|---|
| Human user | A real person connected to the web app |
| Bot user | Server-controlled player that fills an empty seat |
| Autopilot | Temporary bot control for a disconnected human player's seat |
| Room | A private or public game lobby/table |
| Seat | A player position at the table |
| Team A / Team B | The two competing teams |
| Rule profile | A named set of configurable game rules |
| Classic 4-seat | Standard 4-player 2v2 304 mode |
| Six-seat variant | 6-player 3v3 304 mode |
| Private state projection | The safe game view sent to a specific player |
| Event log | Append-only record of accepted game actions |
| Reconnect grace period | Time during which a disconnected user can return before autopilot acts |

## Developer terms

| Term | Meaning |
|---|---|
| Reducer | Pure function that applies an action to game state |
| Legal action | An action allowed by current phase, turn, and rules |
| State snapshot | Stored copy of game state at a point in time |
| WebSocket | Persistent connection used for real-time gameplay |
| Server-authoritative | Server, not client, is source of truth |
| Hidden-information leak | Bug where a user can see data they should not know |
