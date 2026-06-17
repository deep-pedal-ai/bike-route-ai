# PRD: Native iOS MapKit Route App

> Status: ready-for-agent - Produced locally (not published to the issue tracker, per request)
> Source: grilling session 2026-06-16 for a native iOS app that matches the React Map frontend.

## Problem Statement

A rider can explore and search the route corpus in the React frontend, but there is no native iOS experience. The web map is useful for desktop and browser testing, yet it does not feel like a first-class iPhone app: it cannot use native iOS map interactions, native sheets, safe-area-aware controls, or platform-standard route selection. Riders need the same corpus map, search, filters, and route details in a Swift app that uses Apple MapKit on device.

## Solution

Build a new map-first iOS app in Swift. The app launches directly into a native MapKit route explorer, loads the existing corpus APIs, draws stored GeoJSON route geometry on the map, and lets riders search in natural language, filter visible routes, tap route lines, inspect details, and toggle facility overlays.

The app uses a SwiftUI shell for screen composition, sheets, controls, search, and details, with an `MKMapView` bridge for the map surface so v1 can support direct polyline tapping and precise overlay rendering. It does not compute turn-by-turn directions, request user location, or cache route data offline in v1.

## User Stories

1. As a rider, I want to open a native iOS app directly into the route map, so that I can start exploring without navigating through a landing page.
2. As a rider, I want the app to show the same real corpus routes as the React map, so that the native app and web app agree on available rides.
3. As a rider, I want route geometry drawn with Apple MapKit, so that map gestures and rendering feel native on iPhone.
4. As a rider, I want the app to frame all loaded routes on first launch, so that I immediately understand the corpus coverage area.
5. As a rider, I want to search in natural language, so that I can describe the ride I want instead of learning filters first.
6. As a rider, I want search results ranked with route names, blurbs, distance, elevation, loop status, quality, and surface breakdown, so that I can compare routes quickly.
7. As a rider, I want search results to filter the map to only matching route IDs, so that the map focuses on the search outcome.
8. As a rider, I want search loading, empty, relaxed-filter, and error states, so that I know what happened after submitting a query.
9. As a rider, I want tapping a search result to zoom the map to that route and open its details, so that I can inspect it in context.
10. As a rider, I want routes with no mappable geometry to be shown as informational results, so that the app is honest about why it cannot preview them.
11. As a rider, I want to tap a visible route line directly on the map, so that I can select a route without using the search list.
12. As a rider, I want the selected route to be visually emphasized while other routes are de-emphasized, so that I can keep my place on the map.
13. As a rider, I want a route detail sheet with distance, loop status, ascent, descent, quality, match quality, protected-lane fraction, greenway fraction, facility coverage, surface breakdown, and attribution, so that I can judge whether the route fits.
14. As a rider, I want the route detail sheet to fetch full route details only after selection, so that initial map load stays lightweight.
15. As a rider, I want source, distance, loop-only, minimum quality, and color-mode controls, so that I can browse the corpus without a search query.
16. As a rider, I want a facility overlay toggle, so that I can compare corpus routes against bike facilities when needed.
17. As a rider, I want facility overlay data loaded from the existing bbox endpoint, so that map facility rendering stays bounded and responsive.
18. As a rider, I want the app to hide normal filters while active search results are shown, so that search clearly supersedes manual filters.
19. As a rider, I want closing search results to restore all routes and the normal filter controls, so that I can return to browsing.
20. As a rider, I want responsive iPhone and iPad layouts, so that the map, search panel, and detail sheet do not collide on different screen sizes.
21. As a rider using accessibility features, I want Dynamic Type, VoiceOver labels, sufficient touch targets, and contrast-aware colors, so that the app is usable without relying on precise vision or gestures.
22. As a developer, I want the iOS app to consume the existing HTTP API contracts, so that the backend remains the single source of corpus and search truth.
23. As a developer, I want the API base URL to be configurable per build configuration, so that simulator, physical device, and production builds can target the right backend.
24. As a developer, I want route ID joins to normalize search string IDs and corpus numeric IDs, so that search results reliably match map overlays.
25. As a developer, I want a reproducible Xcode project definition, so that agents and humans can regenerate project structure without manual Xcode edits.
26. As a developer, I want pure parsing, filtering, geometry, formatting, and state logic tested outside MapKit, so that the app can evolve without brittle UI-only coverage.

## Implementation Decisions

**App scope.** v1 is a map-first native app, not a literal two-tab clone of the React app. The Generate page is not recreated as a separate tab because natural-language search is integrated into the map experience.

**Project shape.** Add a new standalone iOS app under the repository's iOS area. Use XcodeGen as the project source of truth and commit the generated Xcode project for normal Xcode workflows. The minimum deployment target is iOS 17.

**Platform architecture.** Use SwiftUI for the app shell, navigation, search controls, filters, cards, sheets, and detail UI. Use an `MKMapView` bridge for the map surface because v1 requires direct route-line tapping, selected-route highlighting, overlay ordering, and edge-padded camera framing.

**Backend integration.** Reuse the existing serving app API contracts:

```ts
GET  /api/corpus/routes
GET  /api/corpus/routes/:id
GET  /api/corpus/facilities?bbox=minLng,minLat,maxLng,maxLat&classes=a,b
GET  /api/corpus/stats
POST /api/routes/search
```

The iOS app does not talk directly to Neon, OpenAI, or the corpus pipeline. It treats the TypeScript server as the API boundary.

**Configuration.** The API base URL is build-configurable, not hard-coded to the web dev proxy. Debug builds can point at a local development server; physical-device and production builds can point at reachable deployed URLs.

**Data model.** Define Swift `Codable` models for corpus route overview, route detail, facilities, stats, search results, and API errors. GeoJSON decoding must preserve server coordinate order as `[lng, lat]` and convert only at the MapKit boundary to `CLLocationCoordinate2D(latitude: lat, longitude: lng)`.

**Deep modules.**
- API client: a small async interface for corpus routes, route detail, facilities, stats, and search.
- GeoJSON decoder: converts LineString and MultiLineString payloads into domain geometry while validating coordinate shape.
- Geometry utilities: compute route and route-union map rects, source/quality colors, visible-route filters, and route ID membership.
- Route explorer state: owns loading, error, search, filtering, selected route, visible routes, facility overlay, and camera intents behind a testable interface.
- Map bridge coordinator: translates explorer state into `MKMapView` overlays, renderers, tap hit-testing, selection, and visible rect changes.

**Map behavior.** On launch, fetch corpus routes and frame all mappable routes. Manual filters apply to visible route overlays unless search results are active. Search results replace manual filters with an ID-membership filter, frame the union of mappable result routes, and dim non-selected routes. Selecting a route from a card or map tap fetches full detail and opens a native detail sheet.

**Facility overlay.** Keep the facility overlay off by default. When enabled, fetch facilities for the visible or NY-wide bbox with known classes (`protected`, `lane`, `sharrow`, `greenway`, `other`) and render them below route overlays.

**Visual design.** Use native iOS layout, sheets, lists, safe areas, Dynamic Type, and SF Symbols while carrying over the React app's forest/leaf brand direction. Do not copy the web panel layout pixel-for-pixel where it conflicts with native iPhone ergonomics.

**Permissions and privacy.** v1 does not request location permission. The app frames corpus geometry from the server and does not show the user's blue dot.

**Route semantics.** "Show the route" means draw the stored corpus geometry exactly. v1 does not compute MapKit turn-by-turn directions, infer street-level instructions, or open Apple Maps handoff.

**Caching.** v1 is network-only with in-memory state. Offline corpus persistence, Core Data/SwiftData, and tile caching are out of scope.

## Testing Decisions

**Philosophy.** Test external behavior at module boundaries. Keep MapKit itself thin and verify most behavior through pure modules and state transitions. Do not assert private implementation details such as exact renderer call order when a public state/output assertion is enough.

**Unit tests.** Use Swift Testing for models, API decoding, GeoJSON coordinate conversion, map-rect geometry, route ID normalization, route filtering, formatting, and route explorer state. Tests should include numeric corpus IDs, string search IDs, empty results, no-geometry results, invalid GeoJSON, API errors, and relaxed-filter search responses.

**Map bridge tests.** Unit-test the coordinator decisions that can be separated from `MKMapView`: overlay descriptors, color/opacity decisions, selected-route changes, and camera-intent generation. Use direct simulator smoke verification for the actual MapKit rendering surface.

**Networking tests.** Use a mocked URL loading layer or injected API transport. Validate successful response decoding, server error decoding, non-JSON error fallback, cancellation, and configurable base URL behavior.

**UI tests.** Add a small XCTest UI smoke suite for launch, search submission, result selection, detail presentation, closing search, filter controls, and route detail dismissal. Do not attempt to exhaustively pixel-test MapKit tiles.

**Build verification.** The acceptance gate is: generated Xcode project opens, app builds for an available iOS simulator, Swift Testing unit suite passes, UI smoke suite passes, and existing TypeScript `npm run ci` remains green.

## Out of Scope

- A separate Generate tab that mirrors the React home page.
- Turn-by-turn navigation, directions, cue sheets, or street-by-street instructions.
- Apple Maps handoff.
- User location permission, user tracking, or location-aware search.
- Offline route persistence or offline map tiles.
- Direct database, OpenAI, or corpus-pipeline access from iOS.
- Authentication, saved routes, accounts, push notifications, widgets, watchOS, CarPlay, and App Clips.
- Backend API redesigns beyond any small compatibility fixes needed for the native client.

## Further Notes

- Apple documentation confirms SwiftUI MapKit has `MapPolyline` and camera rect framing on iOS 17, but direct app-defined polyline selection is safer through `MKMapView` at this target.
- The current server detail route expects numeric route IDs; search results expose string IDs. The native app must normalize IDs for joins and only request detail for parseable route IDs.
- The current React map uses MapLibre and a Carto basemap. The native app intentionally uses Apple MapKit basemaps instead.
- The local environment has Xcode 26.5 and XcodeGen installed, so project generation and simulator verification are feasible in this workspace.
