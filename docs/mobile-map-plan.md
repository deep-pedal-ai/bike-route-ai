# Mobile Map View — Responsive Redesign Plan

Goal: make `/map` genuinely usable on a phone. Today three desktop-first overlays
fight the map on small screens. We fix each by **adapting** the experience to
touch + small viewport, not by shrinking or amputating it.

Breakpoint: mobile = below Tailwind `sm` (640px). Mobile-first defaults, desktop
behind `sm:`. The 640px value is shared between CSS (`sm:`) and the one JS
`matchMedia` consumer (camera padding) via a single constant so they can't drift.

## Confirmed decisions
- **Filters:** hidden by default on mobile; reachable via one compact filter/layers
  icon that opens the existing `FilterBar` (+ legend + overlay/color toggles) in a
  bottom sheet on demand.
- **Results dock:** one bottom surface, two states — a short swipeable **peek
  carousel** of compact cards that expands (drag up / tap "details") into the full
  detail panel. Apple/Google-Maps pattern. This unifies the results strip and the
  detail panel so they never collide.

---

## Issue 1 — Top nav too crowded (`components/Header.tsx`)

The row packs: logo icon · "VeloMindAI" wordmark · "MVP Preview" pill · Generate ·
Map · Saved-Routes button. On a ~360px phone that overflows visually.

Changes:
- Hide the **"MVP Preview"** badge on mobile (`hidden sm:inline-flex`). It is pure
  non-essential chrome — the first thing to go.
- Tighten nav spacing on mobile (`gap-4 sm:gap-6`).
- Keep the wordmark, both nav links, and the Saved-Routes control (icon-only on
  mobile already via `hidden sm:inline`). No functionality removed.

Net: a calm, single-line header that fits ~320px.

---

## Issue 2 — Filter panel covers the map (`MapExplorer.tsx`, `FilterBar.tsx`)

The always-on panel is `top-48 left-3 w-[min(27rem,calc(100vw-1.5rem))]` — near
full-width and tall on mobile (sources grid, min/max km, loops, quality slider,
color toggle, overlay toggle, legend, status chips).

Changes:
- Wrap the always-on panel in `hidden sm:block` so it never auto-shows on mobile.
- Add a compact **filter/layers icon button** (floating, e.g. top-left under the
  search bar, `sm:hidden`) that toggles a **bottom-sheet** hosting the existing
  `FilterBar`, legend, and overlay/color toggles — reused verbatim, just re-homed.
- Bump touch targets inside the sheet to ≥44px (source buttons are `h-8`/32px today;
  use `h-11 sm:h-8`). Same for sheet close button.
- Status chips (loading/error) move to a small unobtrusive inline indicator on
  mobile (they don't belong on top of the map).

Default mobile view = map + search bar only. ✔

---

## Issue 3 — Results fill the screen (`SearchResultsPanel.tsx` + new pieces)

Today the panel is `top-48 → bottom-3`, near full-width: it owns the whole screen.

### 3a. Bottom dock surface (mobile only)
- Desktop keeps the current left-sliding panel unchanged.
- Mobile renders a **bottom dock**: `fixed inset-x-0 bottom-0`, two states:
  - **Peek (default):** ~`30vh` (uses `dvh`, see gotchas). A horizontally
    scrolling, snap-aligned carousel of **compact** cards
    (`flex overflow-x-auto snap-x snap-mandatory`, each card
    `snap-center shrink-0 w-[82vw]` so the next card peeks). Native swipe = the
    user's "drag side to side between them."
  - **Expanded:** drag up (or tap a card's "details") expands the SAME surface into
    the `RouteDetailPanel` content. Collapse / close returns to the peek carousel.
    Because detail and carousel are one surface, the old strip-vs-detail-sheet
    collision disappears.
- A small grabber + result count + close button form the dock header on mobile.
- Loading skeleton / empty / error states get a compact horizontal form.

### 3b. Compact card
The current `RouteResultCard` is far too tall for a peek strip. Add a compact
mobile card (name + distance + difficulty + quality; no blurb/surface bar). Reuse
the existing formatting helpers (`formatDistance`, `deriveDifficulty`, etc.) so
numbers stay single-sourced. (Prop-vs-new-component is an implementation detail —
I'll pick whichever keeps the desktop card untouched.)

### 3c. Centered card drives the map highlight (the point of the feature)
Desktop highlights a route on **hover**; touch has no hover. The carousel replaces
it: as it snaps, the **centered card's id** is fed to the existing
`setHoveredId` path (and optionally gently re-frames that route). Without this,
dragging cards does nothing on the map. This is the core mobile interaction.

---

## Issue 4 — Camera framing (`MapExplorer.tsx` `framePadding` + fit effect)

`framePadding` reserves space for left/right/top panels. On mobile the panels live
at the **bottom**, so:
- Add a mobile branch: reserve `bottom` = dock height (peek, or expanded height
  when open) + gutter; `top` = search-bar height; `left/right` = plain gutter.
- The fit-to-results effect's `framePadding({ left: true, top: true })` becomes
  `{ bottom: true, top: true }` on mobile so framed routes land in the visible
  map strip above the dock. (`{ left, top }` stays on desktop.)
- Existing clamp-to-container logic is kept (already prevents over-asking).

---

## Cross-cutting gotchas (must-do, not polish)
1. **`100vh` → `100dvh`.** `main` is `h-[calc(100vh-4rem)]`; a `bottom-0` dock under
   mobile browser chrome gets clipped and jumps with the address bar. Switch the map
   container and dock to dynamic viewport units.
2. **`matchMedia` test mock.** A new `useIsMobile` hook breaks `MapExplorer.test.tsx`
   and `SearchResultsPanel.test.tsx` — jsdom has no `window.matchMedia`. Add a mock
   to `src/test-setup.ts` **first** (confirmed: not present today; no existing media
   hook to reuse).
3. **Single breakpoint source.** Tailwind `sm:` for visibility/layout; the
   `matchMedia` hook only for the camera-padding branch; both read the same 640px
   constant.
4. **Touch targets ≥44px** for all new/relocated mobile controls.

---

## Files touched
- `components/Header.tsx` — hide badge, tighten nav on mobile.
- `pages/MapExplorer.tsx` — `useIsMobile`, mobile `framePadding` branch, fit-effect
  padding swap, render dock vs panel, filter-sheet toggle, `dvh` container.
- `components/SearchResultsPanel.tsx` — desktop panel unchanged; mobile bottom dock
  (peek carousel + expand-to-detail). Likely a new `SearchResultsDock` for mobile.
- new compact result card (component or `compact` prop on `RouteResultCard`).
- new mobile filter bottom-sheet wrapper (reuses `FilterBar`, `Legend`).
- `components/RouteDetailPanel.tsx` — used as the dock's expanded state on mobile;
  desktop container unchanged.
- new `hooks/use-is-mobile.ts`.
- `src/test-setup.ts` — `matchMedia` mock.
- `index.css` — dock slide-up motion (transform/opacity only).

## Testing
- Update `MapExplorer.test.tsx` / `SearchResultsPanel.test.tsx` for the new mobile
  structure; add assertions for: badge hidden < sm, filter sheet toggle, carousel
  renders compact cards, centered-card → highlight wiring, fit padding swap.
- Keep all desktop behavior tests green (desktop layout is unchanged).
- During implementation: one 375px screenshot to pin exact dock height and capture
  a before/after.

## Out of scope
Search relevance / corpus data work (tracked separately in
`docs/search-quality-tasks.md`). This plan is layout + interaction only.
