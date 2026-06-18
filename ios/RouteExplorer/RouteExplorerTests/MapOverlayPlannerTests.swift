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

    @Test func poiDescriptorsDropInvalidCoordinatesAndFormatCalloutSubtitle() {
        let descriptors = MapOverlayPlanner.poiDescriptors(pois: [
            makePoi(id: 1, name: "Balboa Coffee", bucket: "coffee_food", lat: 40.71, lng: -73.98, distanceM: 120),
            makePoi(id: 2, lat: .nan, lng: -73.96)
        ])

        #expect(descriptors.count == 1)
        #expect(descriptors.first?.id == "poi-1")
        #expect(descriptors.first?.title == "Balboa Coffee")
        #expect(descriptors.first?.subtitle == "394 ft")
        #expect(descriptors.first?.coordinate == LngLatCoordinate(longitude: -73.98, latitude: 40.71))
    }
}
