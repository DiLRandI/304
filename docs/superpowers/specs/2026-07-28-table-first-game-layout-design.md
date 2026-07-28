# Table-First Game Layout Design

## Goal

Rearrange the active game screen so play is understood from top to bottom:

1. the game table,
2. the player's cards,
3. all supporting information and controls.

The layout must preserve existing game behavior, accessibility, and the current
green table visual direction.

## Layout

### Table zone

The bounded playfield is the first substantial element in the active game
screen. It contains the opponent seat panels and the current trick. The
player's own seat remains represented around the table so turn and team state
stay visible, but the playable hand does not appear inside this zone.

### Hand zone

The player's hand appears immediately after the table. It remains horizontally
scrollable where necessary and retains legal-card highlighting, disabled-card
behavior, accessible labels, and card selection behavior.

### Information zone

Everything else follows the hand:

- contextual command buttons,
- turn and connection prompts,
- completed-hand results,
- hand, bid, trump, token, and trick-point metrics,
- rules help,
- leave-table guidance and controls.

Within this zone, urgent interactive controls appear before informational
summaries. Existing live-region behavior remains intact even though its visual
position changes.

## Responsive Behavior

Desktop and mobile use the same semantic and visual order: table, hand, then
information. Responsive CSS may compact the seat arrangement, card sizes, and
information grid, but it must not move supporting information above the table
or hand.

On narrow screens, the table retains the existing two-column seat layout and
the hand retains horizontal scrolling rather than shrinking cards below their
usable size.

## Component Changes

`GameTable` will expose three explicit layout containers:

- `table-board` for seats and the current trick,
- `table-action-dock` for the player's hand only,
- a new information container for commands and supporting panels.

The existing child components and data flow remain unchanged. This is a
presentation hierarchy change, not a gameplay or API change.

## Accessibility

- DOM order matches the requested visual order so keyboard and screen-reader
  navigation follow table, hand, then information.
- The hand remains a named region.
- Existing live regions, button labels, disabled states, and legality messages
  remain unchanged.
- Focus is not automatically moved when the table updates.

## Verification

Component tests will assert that:

- the table board precedes the player's hand,
- the player's hand precedes the information container,
- action buttons remain functional after relocation,
- existing accessible regions and labels remain available.

File-scoped formatting, type checks, and the web component test suite will be
run after implementation.

## Out of Scope

- gameplay rule changes,
- card artwork changes,
- new animations,
- redesigning the table theme,
- changing the information content,
- changing backend or realtime behavior.
