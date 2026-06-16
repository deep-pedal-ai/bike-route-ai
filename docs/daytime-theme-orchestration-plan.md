# Daytime / Fresh Theme Rework — Orchestration Plan

**Decision:** Option **C** — cycling-tuned light map + full daytime app palette + light/dark toggle (dark mode kept, **light is the default**). Basemap: **CARTO Voyager** (no API key, drop-in).

**Goal:** The product should feel daytime, fresh, and impeccable — not a dark-forest dashboard. The map is the centre of gravity; the app chrome follows it into daylight.

---

## 0. Spike results (validated before planning — do not re-litigate)

- **Voyager cycling-tune is a layer-patch, not a fork.** `voyager-gl-style/style.json` has 93 named layers: `road_*` (19, with `_case` casing variants), `park_*`/`poi_park`/`landcover`/`landuse`, `water`/`waterway`, `background`. We mutate them in `onLoad` via `map.setPaintProperty` / `setLayoutProperty`.
- **No bike-lane layer exists in Voyager.** Bike-infrastructure emphasis therefore comes from **our existing facility overlay** (`facilities` source: protected / lane / sharrow / greenway), *not* the basemap. Cycling-tune of the basemap = mute car roads + lift parks/water/background.
- **Tests are low-churn:**
  - `--color-leaf` is asserted by name (`App.test.tsx`, `Header.test.tsx`) → **must survive as the accent token.**
  - `route-color.test.ts` / `facility-color.test.ts` assert hex **format + distinctness only** → palette values are free to re-tune.
  - `Legend.test.tsx` uses mock color props → unaffected by theme.

## 1. Architecture

### Token layer (the lever)
Most components already read color through `var(--color-*)`. We make the token layer the single source of truth:

- Define a **semantic token set** with **light and dark values**, keyed off `<html data-theme="...">`.
- Keep the existing token *names* where tests depend on them (`--color-leaf`), but each token gets a per-theme value. Add role-named tokens where the hue names are misleading (a "forest" background can't be cream).
- Light = default. Dark values move into `[data-theme="dark"]`.

### Theme runtime
- `ThemeProvider` + `useTheme()` hook, persisted to `localStorage`, defaults to **light**, honors `prefers-color-scheme` only on first visit.
- **No-flash inline script** in `index.html` sets `data-theme` on `<html>` *before* React paints.
- Toggle control lives in the `Header`.

### Map theming
- `mapStyle` becomes theme-reactive: **Voyager** (light) / **Dark Matter** (dark).
- `onLoad` + a theme-change effect apply the **cycling-tune**: mute `road_*` toward neutral, lift `park_*`/`landcover`/`water`, calm `background`.
- **Casing inverts on light tiles:** today a dark `#223020` halo sits under bright lines on a dark map. On cream Voyager the convention (Strava/Google) is a **light/white halo** under a saturated line. Re-derive the casing↔line relationship per theme — this is not a tweak, it's an inversion.
- Re-tune `route-color.ts` (source + quality) and `facility-color.ts` for contrast on cream tiles; mid-tones (`#86a85e` leaf, `#d8aa52` trail) risk washing out.
- Attribution box + any map UI follow tokens.

### Component migration
Convert stray hardcoded Tailwind colors (`zinc-*`, `red-*`, `amber-*`, `emerald-*`, `sky-*`) to semantic tokens so they flip with the theme. Affected: `App.tsx`, `Header.tsx`, `Legend.tsx`, `SearchResultsPanel.tsx`, `SearchBar.tsx`, `SurfaceBar.tsx`, `RouteResultCard.tsx`, `RouteDetailPanel.tsx`, `LoadingSkeleton.tsx`, `FilterBar.tsx`.

## 2. Frozen token contract (finalized in Phase 1, passed to all fan-out agents)

Foundation phase produces the authoritative map; fan-out agents consume it verbatim (prevents `--text-muted` vs `--muted-text` drift). Indicative set:

| Role | Token | Notes |
|---|---|---|
| Page background | `--color-forest` (re-valued) | cream in light, dark green in dark |
| Panel surface | `--color-forest-panel` | translucent cream / dark |
| Soft surface | `--color-bark-soft` | |
| Border | `--color-bark-border` | |
| Primary text | (new) `--color-ink` | bark-dark in light, cream in dark |
| Muted text | `--color-sage-text` | |
| Accent (brand) | `--color-leaf` (**name locked by tests**) | |
| Accent hover | `--color-leaf-hover` | |
| Info | `--color-river` / `--color-sky-wash` | |
| Danger | (new) `--color-danger*` | replaces raw `red-*` |
| Warning | (new) `--color-warn*` | replaces raw `amber-*` |

## 3. Orchestration

Shape: **mostly sequential with one fan-out stage.** Foundation absorbs *all* shared-file edits so the fan-out is contention-free (no worktrees needed — every fan-out agent owns disjoint files + their tests).

### Phase 1 — Foundation (1 agent, sequential; owns all shared files)
Owns: `index.html`, `index.css`, `App.tsx`, `App.test.tsx`, `Header.tsx`, `Header.test.tsx`, new `ThemeProvider`/`useTheme`, toggle component.
- Design the light + dark semantic palettes (**consult `/impeccable` for the daytime palette** — cream canvas, leaf-green accents, sky routes; must feel fresh, not flat).
- Implement token sets under `[data-theme]`, no-flash script, provider, persistence, toggle in header.
- **Output: the frozen token contract** (exact names + light/dark values) handed to Phase 2.
- Gate: `npm run typecheck` + `App.test`/`Header.test` green before fan-out.

### Phase 2 — Fan-out (parallel, file-isolated)
Each agent receives the frozen token contract. No agent touches Phase-1 files.
- **Agent MAP** — `MapExplorer.tsx`, `MapExplorer.test.tsx`, `route-color.ts`, `facility-color.ts` (+ their tests). Theme-reactive basemap, cycling-tune in `onLoad`, casing inversion, palette legibility on cream.
- **Agent UI-A** (generate flow) — `RouteResultCard.tsx`, `RouteResults.tsx`, `LoadingSkeleton.tsx`, `SurfaceBar.tsx`, `QuickQueries.tsx` (+ tests).
- **Agent UI-B** (map panels) — `FilterBar.tsx`, `Legend.tsx`, `RouteDetailPanel.tsx`, `SearchBar.tsx`, `SearchResultsPanel.tsx` (+ tests).
- **Agent UI-C** — `GeneratePage.tsx` (+ test).

### Phase 3 — QA & polish (sequential)
- Run `npm run ci` (lint + typecheck + test) across packages; fix fallout.
- **Visual verification** via Playwright: screenshot Generate + Map in **both** themes, exercise the toggle, check no FOUC. **Consult `/impeccable` (or `/audit`) for contrast + polish.**
- Accessibility: WCAG AA contrast on text/tokens in both themes.

### Phase 4 — Cycling-tune polish (droppable)
If the basemap tune needs iteration (layer-by-layer color matching to the route palette), do it here. Voyager out-of-the-box is already fresh/daytime, so this is upside, not a blocker — it can ship in a follow-up without holding the core deliverable.

## 4. Risks & mitigations
- **FOUC / theme flash** → no-flash inline script owned by Phase 1, verified in Phase 3.
- **Parallel file collisions** → eliminated by file-ownership partition; shared files all in Phase 1.
- **Token-name drift across agents** → frozen contract passed verbatim.
- **Route lines wash out on cream** → casing inversion + palette re-tune owned by Agent MAP; verified visually.
- **Test breakage** → co-own each test with its component; `--color-leaf` name preserved.
