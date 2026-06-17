import Testing
@testable import RouteExplorer

struct GeoJSONParsingTests {
    @Test func decodesLongitudeLatitudeOrder() throws {
        let line = try GeoJSONRouteDecoder.line(
            from: LineStringGeometry(coordinates: [[-73.9, 40.7], [-73.8, 40.8]])
        )

        #expect(line[0] == LngLatCoordinate(longitude: -73.9, latitude: 40.7))
        #expect(line[1] == LngLatCoordinate(longitude: -73.8, latitude: 40.8))
    }

    @Test func rejectsInvalidCoordinates() {
        #expect(throws: GeoJSONParsingError.invalidCoordinate) {
            _ = try GeoJSONRouteDecoder.line(
                from: LineStringGeometry(coordinates: [[-73.9], [-73.8, 40.8]])
            )
        }
    }

    @Test func computesUnionBoundsAcrossRoutes() {
        let routes = [
            makeRoute(id: 1, coordinates: [[-74.0, 40.6], [-73.9, 40.7]]),
            makeRoute(id: 2, coordinates: [[-73.8, 40.8], [-73.7, 40.9]])
        ]

        #expect(GeoJSONRouteDecoder.bounds(for: routes) == RouteBounds(minLng: -74.0, minLat: 40.6, maxLng: -73.7, maxLat: 40.9))
    }
}
