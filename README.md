# 304 Game Project

This repository is arranged for rapid development with documentation and art assets separated.

## Development layout

- `docs/` — project documentation.
  - `docs/product/` — product requirements, feature list, rules, glossary, references.
  - `docs/features/` — implementation feature docs.
  - `docs/technical/` — architecture, data model, security, QA.
  - `docs/planning/` — roadmap and release plan.
  - `docs/resources/` — generated data resources.
- `assets/` — all game assets.
  - `assets/cards/` — `standard_304` and `variant_extras` PNG/SVG packs.
  - `assets/backs/` — card back artwork.
  - `assets/spritesheets/` — sprite-sheet image + frame JSON.
  - `assets/previews/` — preview contact sheets.
  - `assets/card_manifest.json` — source metadata for all card assets.
- `docs/README.md` — quick document map and onboarding reference.

## Source references

- For standard deck card metadata: `assets/card_manifest.json`
- For CSV export of card IDs and values: `docs/resources/card_list.csv`
- For rule/spec baseline: `docs/product/01_PRD.md`

## Usage notes

- `standard_304` and `variant_extras` are separated intentionally to keep normal 304 flow isolated.
- 3s/2s/6s are optional extras and can be enabled per table rule logic.
- Generated assets are intended for game-project use and can be modified for your implementation.
