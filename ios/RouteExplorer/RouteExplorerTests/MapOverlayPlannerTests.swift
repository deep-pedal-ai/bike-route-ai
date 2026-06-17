import Testing
@testable import RouteExplorer

struct MapOverlayPlannerTests {
    @Test func selectedRouteKeepsFullOpacityAndDimsOthers() {
        let descriptors = MapOverlayPlanner.routeDescriptors(
            routes: [makeRoute(id: 4), makeRoute(id: 9)],
            filters: RouteFilterState(),
            searchResultIDs: nil,
            selectedRouteID: "4",
            colorMode: .source
        )

        let routeLines = descriptors.filter { $0.kind == .routeLine }
        #expect(routeLines.first { $0.routeID == "4" }?.opacity == 0.95)
        #expect(routeLines.first { $0.routeID == "9" }?.opacity == 0.18)
    }

    @Test func qualityColorModeUsesQualityGradient() {
        let descriptors = MapOverlayPlanner.routeDescriptors(
            routes: [makeRoute(qualityScore: 1)],
            filters: RouteFilterState(),
            searchResultIDs: nil,
            selectedRouteID: nil,
            colorMode: .quality
        )

        #expect(descriptors.first { $0.kind == .routeLine }?.hexColor == "#86a85e")
    }
}
