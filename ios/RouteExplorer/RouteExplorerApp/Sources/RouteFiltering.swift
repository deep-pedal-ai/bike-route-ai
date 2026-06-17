import Foundation

enum ColorMode: String, CaseIterable, Identifiable {
    case source
    case quality

    var id: String { rawValue }

    var title: String {
        switch self {
        case .source:
            "Source"
        case .quality:
            "Quality"
        }
    }
}

struct RouteFilterState: Equatable {
    var sources: Set<String> = []
    var minKm: Double?
    var maxKm: Double?
    var loopOnly = false
    var minQuality: Double?
}

enum RouteID {
    static func normalized(_ id: Int) -> String {
        String(id)
    }

    static func normalized(_ id: String) -> String {
        id.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func numeric(_ id: String) -> Int? {
        Int(normalized(id))
    }
}

enum RouteFiltering {
    static func visibleRoutes(
        from routes: [GeoJSONFeature<LineStringGeometry, CorpusRouteProperties>],
        filters: RouteFilterState,
        searchResultIDs: Set<String>?
    ) -> [GeoJSONFeature<LineStringGeometry, CorpusRouteProperties>] {
        if let searchResultIDs {
            return routes.filter { searchResultIDs.contains(RouteID.normalized($0.properties.id)) }
        }
        return routes.filter { matches($0.properties, filters: filters) }
    }

    static func matches(_ properties: CorpusRouteProperties, filters: RouteFilterState) -> Bool {
        if filters.sources.isEmpty == false && filters.sources.contains(properties.source) == false {
            return false
        }
        if let minKm = filters.minKm {
            guard let distance = properties.distanceKm, distance >= minKm else {
                return false
            }
        }
        if let maxKm = filters.maxKm {
            guard let distance = properties.distanceKm, distance <= maxKm else {
                return false
            }
        }
        if filters.loopOnly && properties.isLoop != true {
            return false
        }
        if let minQuality = filters.minQuality {
            guard let quality = properties.qualityScore, quality >= minQuality else {
                return false
            }
        }
        return true
    }
}
