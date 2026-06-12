# Map-Tab Search — Phase-by-Phase Orchestrator Plan

> **Deliverable type:** an orchestrator-runnable plan. Each phase is a self-contained
> subagent task with explicit inputs, TDD red→green→refactor steps, done-criteria, and
> dependencies. Waves mark what may run in parallel.
>
> **Workflow:** TDD (`/tdd`) — write the failing test first, make it pass, refactor.
> **Design bar:** `/impeccable /craft` — match the existing forest/leaf design system,
> no generic AI aesthetics, motion is purposeful and respects `prefers-reduced-motion`.

---

## 1. Feature summary

On the **Map** tab, a user can search routes in natural language (the same search that
powers the Generate page). Returned results populate a **panel that slides in from the
left**. While results are shown:

- The map **hides every route except the returned ones** (id-membership filter).
- The existing **FilterBar/Legend panel is hidden** and returns when search is closed.
- **Hovering a card highlights** its route on the map (brighten hovered, **dim the others**).
- **Clicking a card** animates the camera to **pan + zoom to frame that route**
  (`fitBounds`, ~600 ms ease, with padding) **and opens the existing RouteDetailPanel**.
- A result whose route has **no geometry** renders as an **informational card** with a
  "no map preview" hint — no hover-highlight, no click-to-zoom, no detail (the detail
  endpoint requires `geom`).

---

## 2. Locked decisions (from grilling)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Layout | Search bar floats **top-center**; results **slide in from the left**; FilterBar/Legend **hidden while search active**, restored on close. |
| D2 | Search bar UI | **Reuse the existing `SearchBar` as-is** in a floating card (no compact variant). |
| D3 | Filter interaction | Search **supersedes** FilterBar — id-membership filter replaces source/distance/quality filters while active. |
| D4 | Hover | **Highlight** the route: brighten hovered + **dim the other result routes**. (Not zoom.) |
| D5 | Click | **Animated `fitBounds`** (~600 ms ease, padded) + **open RouteDetailPanel** (`?route=id`). |
| D6 | No-geometry result | Render card, **informational only**, "no map preview" hint; no zoom/detail. |
| D7 | Shared logic | Extract a shared **`useRouteSearch`** hook from `GeneratePage`; both pages use it. |
| D8 | Close behavior | Closing the panel **clears search**, restores all paths + FilterBar + full filter. |

---

## 3. Architecture findings (verified against the code)

- **The id-join is pure-client.** `/api/routes/search` (cards) and `/api/corpus/routes`
  (map geometry) read the **same `routes` table / same `id` column**. Search-result ids
  are guaranteed present in the map's feature set **iff the route has `geom`**
  (search filters on `embedding`, map on `geom is not null`).
- **⚠️ Representation hazard.** Fixtures/tests use **numeric** `properties.id` (`4`, `286`),
  the search contract types `id` as **string**, the DB column is **`text`**. The membership
  filter and all id comparisons **must normalize both sides** (`['to-string', ['get','id']]`
  vs `String(result.id)`) or it silently matches nothing. This is the single highest-risk
  detail — it lives in Phase 0 with explicit tests.
- **No geometry in the search payload.** Search returns metadata only; the map already
  holds all geometry via `useCorpusRoutes()`. "Show only results" = **filter the loaded
  layer**, never re-fetch.
- **Imperative camera is required and risky.** `MapExplorer` currently uses a
  `<Map key={`${lng}:${lat}:${zoom}`}>` **remount hack** with `initialViewState`. That
  throws away the camera and cannot animate. `fitBounds` needs a **`useMap`/ref**. This is
  its own early phase (Phase 2) with regression coverage. Note: selecting a route today
  does **not** move the camera (`viewFromRoutes` fits *all* routes), so click-to-zoom is
  **new** behavior — the only regression risk is preserving the initial fit-to-all.
- **Reusable primitives already exist:** `fitBoundsFromFeatures` (bounds), `buildFilter`
  (filter composition), `RouteResultCard` (card UI), `RouteDetailPanel` (`?route=`),
  CSS keyframes `mapPanelIn` / `detailPanelIn`, design tokens `--color-forest|leaf|bark|sage`.

---

## 4. State design (the "neat for DX" abstraction)

Two clean seams keep the map readable:

**(a) `useRouteSearch()` — shared search state machine** (extracted from GeneratePage):
```
{ query, setQuery, isLoading, results, filtersRelaxed, error, search(q), clear() }
```

**(b) Pure, map-side derivations** (all in `utils/`, all unit-testable):
- `buildIdFilter(ids: string[]): FilterSpecification` — id-membership, string-normalized.
- `boundsForRouteId(features, id): [[w,s],[e,n]] | null` — null ⇒ route has no geometry.
- `routeOpacityExpression(hoveredId: string | null): ExpressionSpecification` — uniform
  when null; otherwise hovered → full opacity, others → dimmed.

In `MapExplorer`, view state ties them together. **Do not collapse this into one
`searchActive` flag** — `useRouteSearch` sets `results: null` during loading and on error
(the lifted GeneratePage pattern, see `GeneratePage.tsx:72`), so a single flag would unmount
the panel exactly when the loading skeleton / error state need to render inside it. Track the
three things the flag is really controlling, separately:
```
const search = useRouteSearch();
const [hoveredId, setHoveredId] = useState<string | null>(null);

const resultIds   = search.results?.map(r => String(r.id)) ?? null;
const panelOpen   = search.isLoading || search.results !== null || search.error !== null;
const mapFiltered = search.results !== null;            // only filter once results exist
const layerFilter = mapFiltered ? buildIdFilter(resultIds!) : buildFilter(filterState);
// FilterBar hidden ⇔ panelOpen.
```
- `panelOpen` drives the slide-in panel (and hides FilterBar/Legend) — loading + error
  states live here.
- `mapFiltered` (`results !== null`) is the single source of truth for "hide all but results."
- `resultIds === null` ⇒ map shows everything.

---

## 5. Phase plan (orchestrator waves)

Dependency graph:
```
Wave 1 (parallel):   P0 ─┐   P1 ─┐   P2 (isolated) ─┐   P3 ─┐
                         │       │                   │       │
Wave 2:              P4 (needs P0 + P2) ─────────────┘       │
Wave 3:              P5 keystone (needs P0,P1,P2,P3,P4) ─────┘
Wave 4:              P6 polish (needs P5)
Wave 5:              P7 verification gate (needs P6)
```

Each subagent must end its phase **green** (`npm run lint && npm run typecheck &&
npm test -w packages/client`) and touch only the files in its scope.

---

### Phase 0 — Pure map-side utils + the id-normalization landmine  · Wave 1
**Goal:** ship the three pure functions in §4(b), fully tested, no UI.
**Files:** `utils/maplibre-filter.ts` (extend), `utils/route-search-view.ts` (new),
`utils/route-search-view.test.ts` (new). `utils/bounds.ts` is reused, not modified.
**TDD (red first):**
- `buildIdFilter([])` ⇒ a filter that matches **nothing**.
- `buildIdFilter(['4','286'])` matches features whose `id` is the **number** `4` or the
  **string** `'4'` (assert `to-string` normalization both ways).
- `boundsForRouteId(fc, 286)` and `boundsForRouteId(fc, '286')` both return the feature's
  bounds; unknown id ⇒ `null`.
- `routeOpacityExpression(null)` ⇒ constant; `routeOpacityExpression('4')` ⇒ `case` expr
  giving `4` full opacity, others dimmed.
**Done:** all new tests green; exported types clean; no `any`.
**Verify (one line, before relying on it):** the filter is robust to any text id, but the
click-to-open-detail path inherits the existing `selectedId = Number(routeParam)` assumption
in `MapExplorer`. Confirm actual `routes.id` values are numeric-looking (fixtures show `286`,
but the DB column is `text` and `jsonb_build_object('id', id)` over text emits a JSON string).
If ids are ever non-numeric text, the filter still works but **detail-open silently breaks** —
in that case normalize the detail path off `Number()` too. Likely fine; just confirm.

### Phase 1 — Extract shared `useRouteSearch` hook  · Wave 1
**Goal:** lift GeneratePage's search state machine into `hooks/use-route-search.ts`;
refactor GeneratePage to consume it (behavior-preserving).
**Files:** `hooks/use-route-search.ts` (new) + test (new); `pages/GeneratePage.tsx` (refactor).
**TDD (red first):** hook tests for success, `filtersRelaxed`, error, and `clear()`
resetting to `results: null`. Mock `searchRoutes`.
**Regression guard:** the **existing `GeneratePage.test.tsx` must stay green** unchanged —
that is the proof the refactor preserved behavior.
**Done:** hook tested; GeneratePage visually/behaviorally identical; all green.

### Phase 2 — Imperative camera refactor (highest risk → run isolated)  · Wave 1
**Goal:** replace the `<Map key=…>` remount with a **`useMap`/ref**; preserve the initial
fit-to-all-routes; expose `focusBounds(bounds, opts)` calling
`map.fitBounds(bounds, { padding: 64, duration: 600, maxZoom: 15 })`.
**Files:** `pages/MapExplorer.tsx` (camera plumbing only — no search features yet).
**TDD / regression:** map is mocked, so assert against the mock —
- existing MapExplorer tests (deep-link `?route=286`, source filter click, color-mode
  toggle, facility overlay) **stay green**;
- new test: calling the exposed focus path invokes `fitBounds` with expected bounds + padding;
- initial load still frames all routes (no remount-on-select).
**Done:** no `key` remount remains; all existing tests green; `fitBounds` wired but dormant.
**Isolation:** run in a worktree — it rewrites working code other phases don't touch.

### Phase 3 — `SearchResultsPanel` slide-in component  · Wave 1
**Goal:** new left-sliding panel rendering result cards with hover/select/close callbacks.
**Files:** `components/SearchResultsPanel.tsx` (new) + test; `index.css` (add
`searchPanelIn` keyframe: `translateX(-16px)→0` + fade, with `@media (prefers-reduced-motion:
reduce)` disabling transform). Reuse `RouteResultCard`; add a thin map-context wrapper that
adds the hover/click affordances + "no map preview" badge.
**Props:** `results, mappableIds: Set<string>, filtersRelaxed, onHover(id|null),
onSelect(id), onClose`.
**TDD (red first):** renders one card per result; hovering a card fires `onHover(id)` and
mouse-out fires `onHover(null)`; clicking fires `onSelect(id)`; a result **not** in
`mappableIds` shows the hint and does **not** fire select/hover-zoom; close button fires
`onClose`; relaxed-filter notice renders when `filtersRelaxed`.
**Design (craft):** forest/leaf tokens, `--color-forest-panel` bg, `backdrop-blur`,
shadow matching existing panels; cards lift on hover; clear focus-visible rings.
**Done:** component tested in isolation; matches the existing panel visual language.

### Phase 4 — Map highlight + dim layer  · Wave 2 (needs P0, P2)
**Goal:** drive the routes layer's `line-opacity` from `routeOpacityExpression(hoveredId)`;
optionally add a thin highlight casing for the hovered route.
**Files:** `pages/MapExplorer.tsx` (paint wiring only).
**TDD:** with the mocked map, assert the `routes` layer receives the opacity expression for
a given `hoveredId`, and the uniform expression when `null`.
**Done:** hovered route brightens, others dim; green.

### Phase 5 — Keystone integration in `MapExplorer`  · Wave 3 (needs P0,P1,P2,P3,P4)
**Goal:** wire it all together.
**Files:** `pages/MapExplorer.tsx`.
**Steps:**
1. Mount the reused `SearchBar` in a floating **top-center** card, bound to `useRouteSearch`.
2. `panelOpen` (loading **or** results **or** error): animate out FilterBar/Legend, slide in
   `SearchResultsPanel`; once `results !== null`, apply `buildIdFilter(resultIds)` to **both**
   `routes` and `routes-casing` layers (supersede FilterBar — D3). The panel hosts the
   loading skeleton / empty / error states (see §4 — do not gate it on `results` alone).
3. **Camera follows the results.** The moment results arrive, `fitBounds` to the **union of
   all mappable result geometries** (reuse `fitBoundsFromFeatures` over the matched features
   + P2's `focusBounds`, same padding/duration). Otherwise the map would show *nothing* —
   the result routes are filtered in but off-screen, and hover-highlight has nothing visible
   to act on. **Skip the fit if zero results are mappable.**
4. Hover card → `setHoveredId` → opacity expression (D4).
5. Click card → `focusBounds(boundsForRouteId(features, id))` + `selectRoute(id)` to open
   `RouteDetailPanel` (D5). Guard: if `boundsForRouteId` is `null` (no geom), do nothing
   (card already shows the hint, D6).
6. Close panel → `search.clear()` + `setHoveredId(null)` → FilterBar/Legend return, full
   filter restored (D8).
**TDD (red first):**
- while loading, the panel is open (skeleton) and FilterBar is hidden, **before** any
  results exist (proves `panelOpen` ≠ `results !== null`);
- on error, the panel shows the error state (still mounted);
- resolved search renders the cards and the routes layer filter equals `buildIdFilter(resultIds)`;
- **results arrival calls `fitBounds` (mock) with the union bounds of the mappable results**;
  with zero mappable results, `fitBounds` is **not** called;
- FilterBar is unmounted/hidden while the panel is open and back after close;
- hover on a card sets the opacity expression on the layer;
- click on a mappable card calls `fitBounds` (mock) **and** sets `?route=id`;
- click on a no-geom card does neither;
- close restores `buildFilter(filterState)` and removes the panel.
**Done:** full flow green; no regressions in prior phases' tests.

### Phase 6 — Impeccable polish pass  · Wave 4 (needs P5)
**Goal:** production-grade finish. Scope:
- **Motion:** slide-in/out easing symmetry; `prefers-reduced-motion` honored everywhere;
  camera `fitBounds` duration consistent with panel timing.
- **A11y:** `Esc` closes the panel; focus moves into the panel on open and restores on
  close; cards are keyboard-focusable and Enter/Space = select; `aria-current` on the
  selected card; the floating search bar has an accessible label.
- **States:** loading skeleton inside the panel; empty-results state ("no routes matched");
  error state mirrored from `useRouteSearch`.
- **Layering / responsive:** z-index of search bar vs results panel vs `RouteDetailPanel`
  (right) never collide; on mobile the left panel becomes full-width / bottom-sheet and the
  search bar stays reachable.
- Run a `/polish` + `/critique` pass against the design tokens; remove any generic AI look.
**Done:** audit clean; all green; screenshots captured to `docs/`.

### Phase 7 — Verification gate  · Wave 5 (needs P6)
**Goal:** prove it end-to-end.
- `npm run ci` (lint + typecheck + all tests) green.
- Manual / Playwright walk-through: search → panel slides in → map shows only results →
  hover dims others → click pans+zooms and opens detail → no-geom card shows hint →
  close restores FilterBar + all paths.
- Update `docs/map-tab-build-log.md` with the new capability.

---

## 6. Orchestrator dispatch notes

- **Spawn Wave 1 as four concurrent subagents** (P0, P1, P3 in the main tree; **P2 in a
  worktree** because it rewrites `MapExplorer.tsx`). P0/P1/P3 don't touch `MapExplorer`, so
  they won't conflict with each other.
- **Merge P2's worktree before Wave 2.** P4 and P5 both edit `MapExplorer.tsx` and must
  build on P2's camera refactor — run them **sequentially**, not in parallel, to avoid
  clobbering the same file.
- **Gate each wave on green** (`lint && typecheck && test -w packages/client`) before
  advancing. A red phase blocks its dependents.
- **Shared-type freeze:** no changes to `@bike-route-ai/shared` are required — do not edit
  it. The whole feature is client-only.
- **The one invariant to assert in every id-touching test:** numbers and strings compare
  equal after normalization. If any phase's filter "matches nothing," suspect the
  number/string seam first.
