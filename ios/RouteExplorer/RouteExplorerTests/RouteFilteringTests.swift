import Testing
@testable import RouteExplorer

struct RouteFilteringTests {
    @Test func emptySourceSelectionMatchesAllSources() {
        let route = makeRoute(source: "generated")

        #expect(RouteFiltering.matches(route.properties, filters: RouteFilterState()))
    }

    @Test func filtersByDistanceLoopAndQuality() {
        let route = makeRoute(distanceKm: 32, isLoop: true, qualityScore: 0.7)
        var filters = RouteFilterState()
        filters.minKm = 25
        filters.maxKm = 50
        filters.loopOnly = true
        filters.minQuality = 0.6

        #expect(RouteFiltering.matches(route.properties, filters: filters))
    }

    @Test func searchIdsNormalizeNumericCorpusIds() {
        let routes = [makeRoute(id: 4), makeRoute(id: 286)]

        let visible = RouteFiltering.visibleRoutes(
            from: routes,
            filters: RouteFilterState(),
            searchResultIDs: ["286"]
        )

        #expect(visible.map(\.properties.id) == [286])
    }
}
