# Ceylon 304 Card Asset Pack

Original card artwork generated for a Sri Lankan 304 game project. No external card art, photos, icons, or font files are included.

## What is included

- `standard_304/png/` — 32 PNG cards for the normal 4-player 304 deck.
- `standard_304/svg/` — matching scalable SVG files.
- `variant_extras/png/` and `variant_extras/svg/` — optional extra ranks for house-rule/extended-player variants.
- `backs/` — card-back artwork for closed trump cards or face-down cards.
- `spritesheets/` — small game-ready sprite sheets plus JSON frame maps.
- `previews/` — visual contact sheets.
- `card_manifest.json` — rank, suit, point value, and file-path metadata.

## Standard 304 deck covered

Standard four-player 304 uses 32 cards: 7, 8, 9, 10, J, Q, K, A in each of the four suits.

304 rank order, high to low:

`J > 9 > A > 10 > K > Q > 8 > 7`

304 point values:

| Rank | Points |
|---|---:|
| J | 30 |
| 9 | 20 |
| A | 11 |
| 10 | 10 |
| K | 3 |
| Q | 2 |
| 8 | 0 |
| 7 | 0 |

## File naming

Each card is named like:

`S_J_spades_jack.png`

Meaning:

- `S` = spades, `C` = clubs, `D` = diamonds, `H` = hearts
- `J` = rank
- then readable suit/rank names

## Suggested use in a game

Use `card_manifest.json` as your source of truth. It has each card ID, rank, suit, point value, and paths to the PNG/SVG files.

For a standard 304 deck, filter cards where:

`standard_304 === true`

For closed-trump or face-down cards, use:

`backs/png/card_back_304_ceylon.png`

## Notes about variants

The standard deck is kept separate from optional extras so your app does not accidentally deal variant cards in the normal 304 mode.

Optional extras included:

- 3s: sometimes used in extended variants with 50 points.
- 2s: sometimes used in larger variants with 100 points.
- 6s: sometimes used as an extra zero-point low card in a six-player variant.

## License note

These generated artwork files are intended for your own game project. You may use, modify, recolor, resize, and ship them in your project.
