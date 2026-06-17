import Testing
@testable import RouteExplorer

@MainActor
struct RouteExplorerStoreTests {
    @Test func loadingRoutesFramesTheCorpus() async {
        let api = MockRouteAPI()
        api.routesResponse = CorpusRoutesResponse(features: [
            makeRoute(id: 4, coordinates: [[-74.0, 40.6], [-73.8, 40.8]])
        ])
        let store = RouteExplorerStore(api: api)

        await store.loadInitialData()

        #expect(store.routes.count == 1)
        #expect(store.cameraIntent?.reason == .initialLoad)
        #expect(store.cameraIntent?.bounds == RouteBounds(minLng: -74.0, minLat: 40.6, maxLng: -73.8, maxLat: 40.8))
    }

    @Test func searchResultsSupersedeManualFilters() async {
        let api = MockRouteAPI()
        api.routesResponse = CorpusRoutesResponse(features: [
            makeRoute(id: 4, source: "canon"),
            makeRoute(id: 9, source: "generated")
        ])
        api.searchResponse = RouteSearchResponse(results: [makeSearchResult(id: "9")], filtersRelaxed: true)
        let store = RouteExplorerStore(api: api)
        store.filters.sources = ["canon"]

        await store.loadInitialData()
        store.searchQuery = "waterfront route"
        await store.submitSearch()

        #expect(store.filtersRelaxed)
        #expect(store.visibleRoutes.map(\.properties.id) == [9])
        #expect(api.searchRequests == ["waterfront route"])
        #expect(store.cameraIntent?.reason == .searchResults)
    }

    @Test func selectionFetchesDetailOnlyAfterSelection() async {
        let api = MockRouteAPI()
        let store = RouteExplorerStore(api: api)
        await store.loadInitialData()

        #expect(api.detailRequests.isEmpty)
        store.selectRoute("4")
        await store.loadSelectedRouteDetail()

        #expect(api.detailRequests == [4])
        #expect(store.routeDetail?.properties.id == 4)
    }
}
