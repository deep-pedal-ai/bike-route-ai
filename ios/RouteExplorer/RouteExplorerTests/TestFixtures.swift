import Foundation
@testable import RouteExplorer

func makeRoute(
    id: Int = 4,
    name: String? = "Harbor Loop",
    source: String = "canon",
    distanceKm: Double? = 12,
    isLoop: Bool? = true,
    qualityScore: Double? = 0.82,
    coordinates: [[Double]] = [[-73.9, 40.7], [-73.8, 40.8]]
) -> GeoJSONFeature<LineStringGeometry, CorpusRouteProperties> {
    GeoJSONFeature(
        geometry: LineStringGeometry(coordinates: coordinates),
        properties: CorpusRouteProperties(
            id: id,
            name: name,
            source: source,
            distanceKm: distanceKm,
            isLoop: isLoop,
            qualityScore: qualityScore,
            ascentM: 120,
            descentM: 118,
            network: "test"
        )
    )
}

func makeRouteDetail(
    id: Int = 4,
    name: String? = "Harbor Loop",
    isLoop: Bool? = true,
    coordinates: [[Double]] = [[-73.9, 40.7], [-73.8, 40.8]],
    pois: [PoiSummary]? = nil
) -> CorpusRouteDetailResponse {
    GeoJSONFeature(
        geometry: LineStringGeometry(coordinates: coordinates),
        properties: CorpusRouteDetailProperties(
            id: id,
            name: name,
            source: "canon",
            distanceKm: 12,
            isLoop: isLoop,
            qualityScore: 0.82,
            ascentM: 120,
            descentM: 118,
            network: "test",
            sourceId: "canon-4",
            matchQuality: 0.91,
            surfaceBreakdown: ["paved": 0.7, "gravel": 0.3],
            waytypeBreakdown: ["cycleway": 0.6],
            steepnessBreakdown: nil,
            protectedLaneFraction: 0.2,
            greenwayFraction: 0.3,
            facilityCoverageFraction: 0.5,
            attribution: "Test attribution",
            osmWayIdCount: 8,
            tags: [:],
            pois: pois
        )
    )
}

func makePoi(
    id: Int = 1,
    name: String? = "Balboa Coffee",
    bucket: String = "coffee_food",
    lat: Double = 40.71,
    lng: Double = -73.98,
    distanceM: Double = 120,
    positionFraction: Double? = 0.25
) -> PoiSummary {
    PoiSummary(
        id: id,
        name: name,
        bucket: bucket,
        lat: lat,
        lng: lng,
        distanceM: distanceM,
        positionFraction: positionFraction,
        imageURL: nil,
        imageLicense: nil,
        imageAttribution: nil
    )
}

func makeSearchResult(id: String = "4") -> RouteSearchResult {
    RouteSearchResult(
        id: id,
        name: "Harbor Loop",
        distanceKm: 12,
        ascentM: 120,
        isLoop: true,
        qualityScore: 0.82,
        surfaceBreakdown: ["paved": 0.7],
        blurb: "A protected loop with a waterfront section."
    )
}

final class MockRouteAPI: RouteAPI {
    var routesResponse = CorpusRoutesResponse(features: [makeRoute()])
    var detailResponse = makeRouteDetail()
    var facilitiesResponse = FacilitiesResponse(features: [], truncated: false, count: 0)
    var statsResponse = CorpusStats(routesBySource: [:], facilitiesByClass: [:], bbox: [])
    var searchResponse = RouteSearchResponse(results: [makeSearchResult()], filtersRelaxed: false)
    var detailRequests: [Int] = []
    var searchRequests: [String] = []

    func fetchRoutes() async throws -> CorpusRoutesResponse {
        routesResponse
    }

    func fetchRouteDetail(id: Int) async throws -> CorpusRouteDetailResponse {
        detailRequests.append(id)
        return detailResponse
    }

    func fetchFacilities(bbox: [Double], classes: [String]) async throws -> FacilitiesResponse {
        facilitiesResponse
    }

    func fetchStats() async throws -> CorpusStats {
        statsResponse
    }

    func searchRoutes(query: String) async throws -> RouteSearchResponse {
        searchRequests.append(query)
        return searchResponse
    }
}
