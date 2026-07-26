# UI/UX Playability Refresh Design

## Decision

Refresh the existing Next.js player client without changing routes, service
contracts, projections, commands, scoring, bidding, trump behavior, storage
keys, or consent behavior. The green-and-gold table identity remains; the
first viewport becomes a playable HUD instead of a long document.

## Player flow

The `/play` screen uses one display name and three pressed-state modes:
Practice, Create, and Join. Practice is the default. Only settings relevant to
the selected mode are shown, while the established guest, room creation,
start, and navigation call order remains unchanged.

The lobby places the invite and host start action before the seat inventory.
Projected bot names are used when present; unnamed bots receive deterministic
seat-based labels.

## Table hierarchy

The active table orders content by play urgency:

1. profile and connection status;
2. bid, trump, token, and hand status;
3. server-projected prompt;
4. legal command controls and the private hand;
5. bounded trick playfield and seat chips;
6. rules, preferences, and exit information.

This order keeps the prompt, at least one legal action, and the hand rail in
the initial 1440x900 and 390x844 view. The hand owns its horizontal scrolling,
so large cards and narrow viewports do not widen the page.

## Artwork and privacy

The repository `assets/` pack is authoritative. A deterministic pre-development
and pre-build script copies only the SVG deck and Ceylon back into ignored
generated public assets. Every Classic and six-seat card ID resolves through a
typed presentation helper. Hidden projections always resolve to the shared
back without using their private ID; unknown visible cards retain text/symbol
fallback rendering.

## Accessibility

Existing accessible card labels, announcements, legal action semantics,
display preferences, and focus-on-validation behavior remain intact. Rules use
a native modal dialog bounded to the viewport, with internal scrolling,
Escape/button close behavior, initial dialog focus, and trigger focus
restoration. High contrast and reduced motion continue to use the existing
stored preferences.

This design improves tested interaction behavior but is not a claim of full
WCAG conformance. Screen-reader and device testing beyond the automated and
manual acceptance set remains appropriate before a public release.

## Verification

Unit tests cover artwork resolution and privacy, mode call sequences, bot name
fallbacks, unchanged legal-action payloads, table hierarchy, and modal focus.
Playwright covers initial-viewport playability, narrow-screen overflow,
keyboard operation, display preferences, private rooms, both game profiles,
results, reconnect, and storage failure. The repository release gates remain
the final acceptance authority.
