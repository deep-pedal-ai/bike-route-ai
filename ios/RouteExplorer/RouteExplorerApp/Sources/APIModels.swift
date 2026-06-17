import Foundation

typealias CorpusRoutesResponse = FeatureCollection<LineStringGeometry, CorpusRouteProperties>
typealias CorpusRouteDetailResponse = GeoJSONFeature<LineStringGeometry, CorpusRouteDetailProperties>
typealias FacilitiesResponse = FeatureCollection<MultiLineStringGeometry, FacilityProperties>

struct FeatureCollection<Geometry: Codable & Equatable, Properties: Codable & Equatable>: Codable, Equatable {
    let type: String
    var features: [GeoJSONFeature<Geometry, Properties>]
    var truncated: Bool?
    var count: Int?

    init(type: String = "FeatureCollection", features: [GeoJSONFeature<Geometry, Properties>], truncated: Bool? = nil, count: Int? = nil) {
        self.type = type
        self.features = features
        self.truncated = truncated
        self.count = count
    }
}

struct GeoJSONFeature<Geometry: Codable & Equatable, Properties: Codable & Equatable>: Codable, Equatable {
    let type: String
    let geometry: Geometry
    let properties: Properties

    init(type: String = "Feature", geometry: Geometry, properties: Properties) {
        self.type = type
        self.geometry = geometry
        self.properties = properties
    }
}

struct LineStringGeometry: Codable, Equatable {
    let type: String
    let coordinates: [[Double]]

    init(type: String = "LineString", coordinates: [[Double]]) {
        self.type = type
        self.coordinates = coordinates
    }
}

struct MultiLineStringGeometry: Codable, Equatable {
    let type: String
    let coordinates: [[[Double]]]

    init(type: String = "MultiLineString", coordinates: [[[Double]]]) {
        self.type = type
        self.coordinates = coordinates
    }
}

struct CorpusRouteProperties: Codable, Equatable, Identifiable {
    let id: Int
    let name: String?
    let source: String
    let distanceKm: Double?
    let isLoop: Bool?
    let qualityScore: Double?
    let ascentM: Double?
    let descentM: Double?
    let network: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case source
        case distanceKm = "distance_km"
        case isLoop = "is_loop"
        case qualityScore = "quality_score"
        case ascentM = "ascent_m"
        case descentM = "descent_m"
        case network
    }
}

struct CorpusRouteDetailProperties: Codable, Equatable, Identifiable {
    let id: Int
    let name: String?
    let source: String
    let distanceKm: Double?
    let isLoop: Bool?
    let qualityScore: Double?
    let ascentM: Double?
    let descentM: Double?
    let network: String?
    let sourceId: String
    let matchQuality: Double?
    let surfaceBreakdown: [String: Double]?
    let waytypeBreakdown: [String: Double]?
    let steepnessBreakdown: [String: Double]?
    let protectedLaneFraction: Double?
    let greenwayFraction: Double?
    let facilityCoverageFraction: Double?
    let attribution: String?
    let osmWayIdCount: Int
    let tags: [String: JSONValue]

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case source
        case distanceKm = "distance_km"
        case isLoop = "is_loop"
        case qualityScore = "quality_score"
        case ascentM = "ascent_m"
        case descentM = "descent_m"
        case network
        case sourceId = "source_id"
        case matchQuality = "match_quality"
        case surfaceBreakdown = "surface_breakdown"
        case waytypeBreakdown = "waytype_breakdown"
        case steepnessBreakdown = "steepness_breakdown"
        case protectedLaneFraction = "protected_lane_fraction"
        case greenwayFraction = "greenway_fraction"
        case facilityCoverageFraction = "facility_coverage_fraction"
        case attribution
        case osmWayIdCount = "osm_way_id_count"
        case tags
    }
}

struct FacilityProperties: Codable, Equatable, Identifiable {
    let id: Int
    let facilityClass: String
    let borough: String?

    enum CodingKeys: String, CodingKey {
        case id
        case facilityClass = "facility_class"
        case borough
    }
}

struct CorpusStats: Codable, Equatable {
    let routesBySource: [String: Int]
    let facilitiesByClass: [String: Int]
    let bbox: [Double]

    enum CodingKeys: String, CodingKey {
        case routesBySource = "routes_by_source"
        case facilitiesByClass = "facilities_by_class"
        case bbox
    }
}

struct RouteSearchResponse: Codable, Equatable {
    let results: [RouteSearchResult]
    let filtersRelaxed: Bool
}

struct RouteSearchResult: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let distanceKm: Double
    let ascentM: Double?
    let isLoop: Bool
    let qualityScore: Double?
    let surfaceBreakdown: [String: Double]?
    let blurb: String
}

struct ErrorResponse: Codable, Equatable {
    let error: String
    let statusCode: Int
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}
