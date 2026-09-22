# UI

**Direction: "Archival Cinema."** A well-made film reference book — generous whitespace, editorial
typography, restrained color, artwork as the hero — with a technical undercurrent that surfaces in
the data areas.

Not Letterboxd (no green, no social density), not Netflix (no wall-to-wall carousels, no red), not
Apple TV (no glassmorphic chrome).

**The Domo design playbook does not apply to this project.** It governs `~/work/`. Do not push this
palette toward Domo Blue or Open Sans.

## Typography

| Role    | Face                 | Usage                                                 |
| ------- | -------------------- | ----------------------------------------------------- |
| Display | **Instrument Serif** | Title headers, share cards, section heads             |
| UI      | **Inter** (variable) | Everything functional; `tabular-nums` for all counts  |
| Data    | **Geist Mono**       | The Universe, IDs, predicate labels, provenance lines |

The serif/mono pairing carries the whole brief: the tracker is serif-and-sans, the Universe shifts
to mono. Same product, different register.

Scale (1.25, clamped): 12 / 14 / 16 / 20 / 25 / 31 / 39 / 49. **Body 16px minimum on mobile**
(prevents iOS zoom-on-focus). Line height 1.5 body, 1.15 display. `text-wrap: balance` on titles.

## Color

Source of truth is `src/lib/design/tokens.ts`, mirrored into CSS variables in
`src/styles/globals.css`. Dark is the default; light is fully supported.

Aged gold as the single accent: cinematic (marquee bulbs, award statuary, film leader), distinct
from every competitor, and it works as a star fill without looking like a 2009 rating widget. Used
sparingly.

**Per-title accent.** At ingest, extract the dominant chroma-weighted color from the poster, clamp
for contrast, store as `core.title.accent_color`. It tints the detail-page backdrop gradient, the
Universe focus ring for that node, and the OG card. One column, computed once, and every detail page
feels bespoke. **Never used for text.**

### Contrast rules — tested, not asserted

`tests/unit/contrast.test.ts` computes real WCAG ratios for every entry in `USAGE_MATRIX` and fails
the build on a shortfall. Three rules came out of actually running the math:

1. **`faint` is a decorative token only** — hairline dividers. It does not meet 4.5:1 and must never
   carry text. `textFaint` exists for a genuine third text tier.
2. **Light-mode `accent` is a non-text UI token only** (3.35:1). Star fills, focus rings, and
   indicator bars are fine at the 3:1 non-text bar. **Active nav labels use `text` plus an accent
   indicator bar, never accent-colored text.**
3. **Text on a FILLED accent surface uses `accentInk`, never `bg`.** The primary buttons put a label
   on the accent, which is a different question from the accent on a ground — and it was the one
   combination the usage matrix never declared. In dark mode `bg` and `accentInk` happen to be the
   same near-black, so five buttons used `bg` and looked correct; in light mode `bg` is near-white,
   and near-white on gold is **3.35:1**. It shipped that way and was caught only when axe-core was
   first pointed at light mode. The matrix now declares both pairings, so the unit test measures them
   (light is 5.09:1) rather than the whole thing resting on the two schemes coincidentally agreeing.

Rule 3 is the general lesson, and it is the same one this codebase keeps relearning: **a rule is only
as good as the cases enumerated for it.** The matrix was not wrong, it was incomplete, and an
incomplete matrix passes.

`decorative` carries a 1.0 threshold on purpose: SC 1.4.11 explicitly exempts purely decorative
elements. The moment a border indicates state, focus, or a field boundary it is `nonText` and must
clear 3:1 — that is what `borderStrong` and `focus` are for. Blanket-darkening every rule to 3:1
would over-apply the criterion for no accessibility gain.

Graph node color is **supplementary only**: every node carries a text label and a `borderStrong`
stroke, so type is never conveyed by hue alone (1.4.1) and the shape is always perceivable. Derived
edges render dashed — provenance is in the visual language itself.

## Space, shape, elevation

4px base; 4/8/12/16/24/32/48/64. Gutter 16px mobile, 24px >= 768. Radii 6 (posters/chips), 10
(cards), 16 (sheets), 999 (pills). Elevation is a hairline border plus a soft large-radius shadow —
never a hard drop shadow.

**Poster treatment** — the most-repeated element, worth getting exactly right: 2:3, 6px radius,
`box-shadow: inset 0 0 0 1px var(--tl-poster-inset)`. That inset hairline separates artwork from the
background without a visible frame, and it is why professional media UIs look crisp.

## Motion

120 (micro) / 200 (standard) / 320 (sheet, page) ms. `cubic-bezier(0.2,0,0,1)` enter,
`(0.4,0,1,1)` exit. Graph re-centering uses a spring (stiffness 170, damping 26). Poster-to-detail
uses the View Transitions API.

`prefers-reduced-motion` disables the spring, the shared-element morph, and all parallax. **It never
disables feedback.**

## Mobile rules

- `viewport-fit=cover` + `env(safe-area-inset-*)` on the bottom nav.
- `interactive-widget=resizes-content` so the keyboard does not cover search results.
- `scroll-padding-bottom` accounts for nav height — SC 2.4.11, the bottom nav must never obscure a
  focused element.
- Minimum tap target 44x44pt (exceeds SC 2.5.8's 24x24).
- `overscroll-behavior-y: contain` so pull-to-refresh does not fight a horizontal carousel.
- **No hover-dependent affordances anywhere.**
- Breakpoints 360 / 390 (design target) / 768 / 1024 / 1440. Bottom nav becomes a left sidebar at
  > = 1024px; poster grid 3 -> 4 -> 6 columns.

## Accessibility acceptance criteria (WCAG 2.2 AA)

- **AC-31 Contrast** — every declared usage meets its threshold; axe-core clean on five routes.
- **AC-32 Keyboard** — everything reachable and operable, visible focus meeting SC 2.4.11, no traps,
  sheets trap and restore focus, skip link to `#main`. **Swipe is never the only path to an
  action** — every swipe has a button equivalent.
- **AC-33 Screen reader** — VoiceOver and NVDA complete the capture, resume, and share flows. Star
  ratings expose `role="slider"` with `aria-valuetext` ("4 and a half out of 5 stars"), not a row of
  unlabeled buttons. Live regions announce optimistic changes.
- **AC-34 Structure** — one `h1` per route, no skipped levels, labeled inputs, errors associated via
  `aria-describedby`, unique page titles.
- **AC-35 Motion, targets, 2.2-specific** — reduced motion honored; 44pt targets; SC 2.4.11 Focus
  Not Obscured; SC 3.2.6 Consistent Help; SC 3.3.7 Redundant Entry; SC 2.5.7 no dragging-only
  interaction (the star drag has a tap fallback).
- **AC-36 Graph** — Focus and Path are DOM/SVG with list-equivalent views; Constellation offers a
  one-tap switch to Focus as its conforming alternative.

## Component inventory

`PosterCard` (3 densities) · `PosterGrid` · `HorizontalStrip` · `StatusPill` · `StarRating` ·
`Chip` (neutral / theme / provenance) · `ProgressRing` · `EpisodeRow` · `PersonAvatar` ·
`SectionHeader` · `Sheet` · `Toast` · `SegmentedControl` · `SearchField` · `EmptyState` ·
`Skeleton` · `NodeCard` · `PathChain` · `OrbitGraph` · `StatTile` · `MiniChart` ·
`AttributionFooter`.

Implemented in Phase 0: `BottomNav`, `PosterCard`, `Chip`, `Skeleton`/`PosterSkeleton`.

## Empty and loading states

Every empty state is designed: a short serif line, one sentence, one action. Watchlist:
_"Nothing waiting."_ / "Things you add will collect here." / `Find something`. Universe with nothing
watched: _"Your universe is dark."_ / "Track a few things and the constellation starts to form."

**Loading never uses a spinner above the fold.** Skeletons match final dimensions exactly. Spinners
are permitted only inside buttons for in-flight mutations.
