import MapKit
import Testing
@testable import RouteExplorer

struct AppleMapsRouteLauncherTests {
    @Test func loopRouteStartsFromCurrentLocationToRouteStart() throws {
        let route = makeRouteDetail(
            isLoop: true,
            coordinates: [[-73.97, 40.67], [-73.95, 40.68], [-73.97, 40.67]]
        )

        let plan = try #require(AppleMapsRouteLauncher.launchPlan(for: route))

        #expect(plan.origin == .currentLocation)
        #expect(plan.destination == AppleMapsRoutePoint(
            title: "Harbor Loop start",
            coordinate: LngLatCoordinate(longitude: -73.97, latitude: 40.67)
        ))
        #expect(plan.directionsMode == MKLaunchOptionsDirectionsModeCycling)
    }

    @Test func pointToPointRouteUsesRouteStartAndFinish() throws {
        let route = makeRouteDetail(
            name: "Hudson Connector",
            isLoop: false,
            coordinates: [[-74.01, 40.71], [-73.99, 40.75], [-73.96, 40.78]]
        )

        let plan = try #require(AppleMapsRouteLauncher.launchPlan(for: route))

        #expect(plan.origin == .routePoint(AppleMapsRoutePoint(
            title: "Hudson Connector start",
            coordinate: LngLatCoordinate(longitude: -74.01, latitude: 40.71)
        )))
        #expect(plan.destination == AppleMapsRoutePoint(
            title: "Hudson Connector finish",
            coordinate: LngLatCoordinate(longitude: -73.96, latitude: 40.78)
        ))
        #expect(plan.directionsMode == MKLaunchOptionsDirectionsModeCycling)
    }

    @Test func invalidRouteGeometryDoesNotOfferLaunchPlan() {
        let route = makeRouteDetail(coordinates: [])

        #expect(AppleMapsRouteLauncher.launchPlan(for: route) == nil)
    }
}
