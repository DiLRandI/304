# Classic Card Art and Asset Cleanup Design

## Goal

Replace the ornate Ceylon 304 card artwork with clear, familiar playing-card faces and remove asset formats that the application does not use.

The redesign must look like a conventional casino or Bicycle-style deck. Card faces must not display point values, 304 branding, explanatory labels, gradients, medallions, gold ornament, or other artificial decoration.

## Scope

The supported deck remains unchanged:

- Standard 304 ranks: `J`, `9`, `A`, `10`, `K`, `Q`, `8`, and `7`
- Six-player variant ranks: `2`, `3`, and `6`
- Suits: spades, clubs, diamonds, and hearts
- One shared hidden-card back

Gameplay rules, scoring, rank order, accessibility behavior, and card identifiers are not changed.

## Card Face Design

Each face is a deterministic SVG built from a shared classic-card design:

- a plain white or subtly off-white background;
- a thin neutral border with modest rounded corners;
- black spades and clubs;
- red hearts and diamonds;
- mirrored top-left and bottom-right rank-and-suit indices;
- conventional, balanced suit-pip layouts for number cards;
- restrained, recognizable mirrored court-card figures for jacks, queens, and kings;
- a conventional ace treatment with a prominent central suit;
- no visible point values or game-specific instructional copy.

Cards must remain identifiable when rendered in the player hand, current trick, trump selector, and compact mobile layouts. Rank and suit recognition takes priority over ornamental detail.

## Card Back Design

The shared hidden-card back uses a restrained, symmetrical classic pattern with a clear border. It must not expose rank, suit, points, trump, or other gameplay information. It may use a traditional limited red, blue, white, or neutral palette, but it must not include promotional or explanatory text.

## Implementation Architecture

The repository will keep SVG as the single shipped source format for card artwork. A deterministic repository script will generate or update every supported face and the shared back from reusable SVG primitives and card metadata.

The existing application-facing paths and `resolveCardArtwork` contract will remain stable where practical. The web asset synchronization step will continue to copy only the SVG files needed by the runtime into the generated public directory.

The generator will encode:

- suit colors and symbols;
- corner indices;
- number-card pip positions;
- mirrored court-card composition;
- ace composition;
- shared face and back geometry.

This avoids hand-edited drift across 44 faces and keeps the output reviewable and reproducible.

## Asset Cleanup

The audit will classify a tracked file as removable only when it has no runtime, build, manifest, documentation, or verification role.

The current runtime consumes SVG card faces and the SVG back. Subject to a final reference and build audit, the cleanup will remove:

- PNG duplicates under `assets/cards`;
- the PNG card-back duplicate;
- preview PNG files;
- spritesheet PNG files.

`assets/card_manifest.json`, `docs/resources/card_list.csv`, and relevant documentation will be updated together so they describe only retained assets and contain no stale paths.

Checked-in Playwright tests, integration fixtures, Compose configuration, backup/restore rehearsal, load smoke tests, CI scripts, and other release-gate files are explicitly preserved.

## Accessibility

Visual artwork contains no point labels. Application accessibility labels remain semantic and may continue to announce the card name and its gameplay point value where that information assists non-visual users.

The image remains decorative in the DOM because the surrounding card control or display supplies the accessible name. Fallback rank-and-suit markup remains available if an artwork path cannot be resolved.

## Verification

Verification must cover:

- all 44 supported visible card identifiers resolve to retained SVG files;
- hidden cards resolve only to the shared back;
- manifest JSON is valid;
- every manifest and CSV path exists;
- removed PNG, preview, and spritesheet paths are absent from code and documentation;
- generated SVG files contain no point labels, `304` branding, instructional copy, gradients, or ornate medallion elements;
- card artwork unit and accessibility tests pass;
- repository lint, type checking, unit tests, and production build pass;
- desktop and mobile browser checks confirm clear rank and suit recognition without clipping or unreadable scaling.

## Non-Goals

- Changing gameplay rank order, scoring, dealing, bidding, or trump behavior
- Replacing application accessibility labels with text embedded in artwork
- Adding animations, collectible themes, alternate skins, or a theme selector
- Removing test or operational assets merely because they are not loaded by the browser runtime
