# Seat-Positioned Trick Cards Design

## Goal

Replace the Current trick text tiles with visual playing cards positioned according to the seat that played each card.

## User experience

- Each play appears as a compact card face inside the Current trick area.
- The card occupies the side of the trick area nearest its player's seat. On four-player tables, seats map to south, west, north, and east. Six-player tables use six distinct positions around the same center.
- A face-up play shows its rank and suit using the same visual language as cards in the player's hand.
- A face-down play shows the existing patterned 304 card back.
- Card names and point values are not displayed as text in the trick area.
- The empty trick continues to show “Waiting for the lead card.”

## Components and data flow

`GameTable` already receives each trick play with `seatIndex` and projected card data. It will pass the card to a new display-only `CardFace` component and expose the `seatIndex` as a data attribute for CSS placement.

`CardFace` will live in `apps/web/src/components/card.tsx` beside `CardButton`. It will own the shared rank, suit, face-down pattern, and accessible card label markup. `CardButton` will reuse `CardFace`, so hand cards and trick cards cannot drift into different visual representations.

The layout remains CSS-driven. The trick container reads the table's seat count, and each trick card reads its seat index. No new game state, network fields, image downloads, or dependencies are required.

## Accessibility

- Each trick card is exposed as an image with an accessible label such as “Jack of Clubs, 30 points, played by Seat 3.”
- Visible rank and suit symbols are hidden from assistive technology to prevent duplicate announcements.
- Hidden cards are labelled as hidden and never leak rank, suit, or points.
- Existing live-region trick-count announcements remain unchanged.
- High-contrast and large-card preferences continue to apply to the shared card visuals.

## Responsive behavior

Desktop layouts position cards around the center according to seat. Cards use a bounded responsive size so four or six plays remain inside the trick area without overlapping the table metrics.

On narrow screens, the same seat-relative arrangement is preserved within a smaller grid. Card dimensions reduce before the layout overflows, and the trick area gains enough minimum height for the visual arrangement.

## Error handling

Malformed projection data remains handled by the existing safe table fallback. A projected hidden card always renders the card back. Valid visible cards render rank and suit; the component does not construct filesystem asset paths or depend on optional network resources.

## Testing

Component tests will verify that:

- visible trick cards render as labelled images without visible card-name text;
- each play exposes its seat index for position styling;
- hidden trick cards render as hidden card backs without leaking private details;
- the existing playable hand-card interactions still work after extracting `CardFace`.

The focused web test suite, typecheck, and browser flow will be run after implementation.
