# Feature Doc: UI, UX, and Accessibility

## 1. Feature summary

304 Online must make a complex trick-taking game feel clear on desktop and mobile browsers. The interface should support experienced players who want speed and new players who need guidance.

## 2. UX principles

1. **Show the current required action clearly.**  
   Users should always know whose turn it is and what they can do.

2. **Prevent illegal moves before they happen.**  
   Disable illegal cards/buttons and explain why.

3. **Protect hidden information.**  
   Use card backs and private views correctly.

4. **Make teams obvious.**  
   Show team colors, labels, and seating layout.

5. **Design mobile-first.**  
   Many players will use phones.

6. **Respect local familiarity.**  
   Use terminology like call, cut, trump, bid, and Caps, with explanations.

## 3. Main screens

### 3.1 Landing page

Primary actions:

- Play Practice
- Create Room
- Join Room
- Learn Rules

Content:

- One-line product description
- “Start with 1 to 6 players; bots fill empty seats”
- No account required for casual play

### 3.2 Create room screen

Fields:

- Display name
- Room visibility: Private / Public later
- Table size: Auto / Classic 4 / Six-player 6
- Bot difficulty: Easy / Normal / Strong
- Rule profile
- Timer speed
- Tutorial hints on/off

### 3.3 Room lobby

Must show:

- Invite link/code
- Seats around table
- Humans and bots
- Team A and Team B
- Host controls
- Ready status
- Rule profile summary
- Start Game button

### 3.4 Game table

Core areas:

- Opponent/partner seat panels
- Current trick area
- Player hand area
- Trump indicator area
- Bid/status panel
- Score/token panel
- Action prompt
- Rule help button

### 3.5 Hand result screen

Show:

- Final bid
- Trump suit
- Team points
- Bid success/failure
- Token movement
- Updated match score
- Rematch / leave buttons

## 4. Table layout

### Desktop 4-seat layout

```text
             Seat 2 / Partner
                  [cards hidden]

Seat 1 / Opponent      Trick Area      Seat 3 / Opponent
[cards hidden]        [played cards]   [cards hidden]

               Your Hand / Seat 0
       [cards] [cards] [cards] [cards]
```

### Desktop 6-seat layout

```text
          Seat 3              Seat 4
       [opponent]          [teammate]

Seat 2                                      Seat 5
[teammate]             Trick Area          [opponent]

          Seat 1              Seat 0 / You
       [opponent]          [your hand]
```

### Mobile layout

Mobile should prioritize:

1. Current trick
2. Action prompt
3. Player hand
4. Compact seat carousel
5. Score/trump drawer

Use collapsible panels to avoid crowding.

## 5. Card UI

### Card states

| State | Visual behavior |
|---|---|
| Playable | Raised/active |
| Illegal | Dimmed, but still readable |
| Selected | Highlighted, confirmation shown |
| Trump indicator | Face-down card in trump zone |
| Face-down trick card | Card back in trick area |
| Revealed trump | Suit badge and revealed card |

### Card labels

Each card needs a text label:

```text
Jack of Spades, 30 points
Nine of Hearts, 20 points
Seven of Clubs, 0 points
```

### Sorting options

- By suit, then rank
- By point value
- Manual drag reorder later

## 6. Bidding UI

### Bid panel

Show:

- Current highest bid
- Current highest bidder
- Legal bid buttons
- Pass button
- Bid history
- Help icon

### Beginner explanation

> Your bid is the minimum number of card points your team promises to win. The full deck has 304 points.

### Bid button design

For Classic:

- Show next few legal bids, not every possible number.
- Include custom bid input for advanced players.
- Disable invalid values.

Example:

```text
Current bid: 170 by North
Your legal bids: [180] [190] [200] [210] [Custom] [Pass]
```

## 7. Trump UI

### Closed trump

Show:

- Face-down card in trump zone
- Label: “Trump hidden”
- Trump maker badge
- Tooltip: “Trump opens when someone cuts or by rule.”

### Open trump

Show:

- Trump suit icon
- Revealed indicator card if public
- Label: “Trump: Clubs”

### Trump selection

Prompt:

```text
Choose a card to set trump.
Only the suit matters, but this card may be restricted until trump opens.
```

## 8. Trick play UI

### Turn prompt examples

- “Your turn: lead any legal card.”
- “Your turn: follow Hearts.”
- “You do not have Hearts. You may cut or discard.”
- “Trump is closed. Your card will be played face down.”
- “Waiting for Bot Nimal.”

### Legal move explanation

When a user taps an illegal card:

```text
You cannot play this card because you have Hearts and must follow the led suit.
```

## 9. Scoring UI

### During hand

Show compact:

- Bid: 200 by Team A
- Trump: hidden/open
- Tokens: Team A 11, Team B 11
- Tricks won: A 3, B 2

Avoid showing running card points if it changes strategy too much for local play. Make this a room setting.

### After hand

Full score breakdown is allowed because hidden information is over.

## 10. Tutorial and help

### Rule drawer sections

- Card values
- How bidding works
- What trump means
- Closed trump and cutting
- Scoring tokens
- Caps
- Six-player variant note

### Contextual help

Examples:

- During bidding: “A bid of 160 means your team needs at least 160 card points.”
- During trump selection: “The suit of this card becomes trump.”
- During trick play: “Jacks are highest, then Nines, then Aces.”

## 11. Accessibility requirements

### Keyboard controls

- Tab through playable cards and buttons.
- Enter/Space selects card.
- Arrow keys move through hand.
- Escape cancels selection.

### Screen reader

Use ARIA labels:

```html
<button aria-label="Play Jack of Spades, 30 points">
```

Announce major events:

- “North bid 180.”
- “Trump opened: Diamonds.”
- “Team B won the trick.”
- “Your turn.”

### Color and suit accessibility

Do not rely on red/black alone.

Use:

- Suit symbols
- Suit names
- Shape icons
- Optional high-contrast mode

### Motion

- Reduced-motion setting disables card animations.
- Timers should not rely on animation only.

## 12. Responsive breakpoints

| Breakpoint | Behavior |
|---|---|
| < 480px | Mobile stacked layout, large hand, bottom action bar |
| 480-768px | Compact table with scrollable hand |
| 768-1024px | Tablet layout |
| > 1024px | Full table layout |

## 13. Visual style direction

Suggested style:

- Clean modern web app
- Sri Lankan-inspired accent patterns used subtly
- Green or dark table surface option
- Large readable cards
- Minimal clutter during active turns

Avoid:

- Casino-style gambling visuals
- Chips, cash, betting tables, or wagering language
- Overly flashy animations that slow play

## 14. Error and empty states

| Scenario | Message |
|---|---|
| Room not found | “This room does not exist or has expired.” |
| Lost connection | “Trying to reconnect. Your seat is reserved.” |
| Bot taking over | “Autopilot will play for you until you return.” |
| Illegal move | “That move is not allowed.” |
| All pass | “Everyone passed. No score this hand.” |

## 15. UX acceptance criteria

The UI/UX feature is complete when:

- A new user can start practice in under a minute.
- A user can understand what action is required at all times.
- Illegal moves are visibly disabled or explained.
- Mobile users can play a full hand comfortably.
- Screen-reader labels exist for cards and major actions.
- Bot seats, human seats, teams, bid, trump, and score are clearly visible.
