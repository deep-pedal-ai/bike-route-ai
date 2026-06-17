import Foundation

struct FixtureRouteAPI: RouteAPI {
    private let route = GeoJSONFeature(
        geometry: LineStringGeometry(coordinates: [[-117.94, 33.62], [-117.9, 33.61], [-117.86, 33.63]]),
        properties: CorpusRouteProperties(
            id: 4,
            name: "Harbor Loop",
            source: "canon",
            distanceKm: 18.2,
            isLoop: true,
            qualityScore: 0.84,
            ascentM: 96,
            descentM: 94,
            network: "fixture"
        )
    )

    func fetchRoutes() async throws -> CorpusRoutesResponse {
        CorpusRoutesResponse(features: [route])
    }

    func fetchRouteDetail(id: Int) async throws -> CorpusRouteDetailResponse {
        GeoJSONFeature(
            geometry: route.geometry,
            properties: CorpusRouteDetailProperties(
                id: id,
                name: "Harbor Loop",
                source: "canon",
                distanceKm: 18.2,
                isLoop: true,
                qualityScore: 0.84,
                ascentM: 96,
                descentM: 94,
                network: "fixture",
                sourceId: "fixture-\(id)",
                matchQuality: 0.92,
                surfaceBreakdown: ["paved": 0.76, "path": 0.24],
                waytypeBreakdown: ["cycleway": 0.61, "residential": 0.39],
                steepnessBreakdown: ["flat": 1],
                protectedLaneFraction: 0.31,
                greenwayFraction: 0.22,
                facilityCoverageFraction: 0.66,
                attribution: "Fixture route data for UI smoke tests.",
                osmWayIdCount: 3,
                tags: [:]
            )
        )
    }

    func fetchFacilities(bbox: [Double], classes: [String]) async throws -> FacilitiesResponse {
        let facility = GeoJSONFeature(
            geometry: MultiLineStringGeometry(coordinates: [[[-117.945, 33.618], [-117.91, 33.616]]]),
            properties: FacilityProperties(id: 11, facilityClass: "protected", borough: nil)
        )
        return FacilitiesResponse(features: [facility], truncated: false, count: 1)
    }

    func fetchStats() async throws -> CorpusStats {
        CorpusStats(
            routesBySource: ["canon": 1],
            facilitiesByClass: ["protected": 1],
            bbox: [-117.95, 33.6, -117.85, 33.64]
        )
    }

    func searchRoutes(query: String) async throws -> RouteSearchResponse {
        RouteSearchResponse(
            results: [
                RouteSearchResult(
                    id: "4",
                    name: "Harbor Loop",
                    distanceKm: 18.2,
                    ascentM: 96,
                    isLoop: true,
                    qualityScore: 0.84,
                    surfaceBreakdown: ["paved": 0.76, "path": 0.24],
                    blurb: "A coastal loop with protected stretches and low climbing."
                )
            ],
            filtersRelaxed: false
        )
    }
}
