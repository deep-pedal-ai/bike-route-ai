import Foundation

struct LngLatCoordinate: Equatable, Hashable {
    let longitude: Double
    let latitude: Double
}

struct RouteBounds: Equatable, Hashable {
    let minLng: Double
    let minLat: Double
    let maxLng: Double
    let maxLat: Double

    var isValid: Bool {
        minLng <= maxLng && minLat <= maxLat
    }

    func union(_ other: RouteBounds) -> RouteBounds {
        RouteBounds(
            minLng: min(minLng, other.minLng),
            minLat: min(minLat, other.minLat),
            maxLng: max(maxLng, other.maxLng),
            maxLat: max(maxLat, other.maxLat)
        )
    }
}

enum GeoJSONParsingError: Error, Equatable {
    case unsupportedGeometry(String)
    case invalidCoordinate
    case emptyGeometry
}

enum GeoJSONRouteDecoder {
    static func line(from geometry: LineStringGeometry) throws -> [LngLatCoordinate] {
        guard geometry.type == "LineString" else {
            throw GeoJSONParsingError.unsupportedGeometry(geometry.type)
        }
        let points = try geometry.coordinates.map(parseCoordinate)
        guard points.isEmpty == false else {
            throw GeoJSONParsingError.emptyGeometry
        }
        return points
    }

    static func lines(from geometry: MultiLineStringGeometry) throws -> [[LngLatCoordinate]] {
        guard geometry.type == "MultiLineString" else {
            throw GeoJSONParsingError.unsupportedGeometry(geometry.type)
        }
        let lines = try geometry.coordinates.map { coordinates in
            let points = try coordinates.map(parseCoordinate)
            guard points.isEmpty == false else {
                throw GeoJSONParsingError.emptyGeometry
            }
            return points
        }
        guard lines.isEmpty == false else {
            throw GeoJSONParsingError.emptyGeometry
        }
        return lines
    }

    static func bounds(for line: [LngLatCoordinate]) -> RouteBounds? {
        guard let first = line.first else {
            return nil
        }
        return line.dropFirst().reduce(
            RouteBounds(
                minLng: first.longitude,
                minLat: first.latitude,
                maxLng: first.longitude,
                maxLat: first.latitude
            )
        ) { partial, coordinate in
            partial.union(
                RouteBounds(
                    minLng: coordinate.longitude,
                    minLat: coordinate.latitude,
                    maxLng: coordinate.longitude,
                    maxLat: coordinate.latitude
                )
            )
        }
    }

    static func bounds<Properties>(for features: [GeoJSONFeature<LineStringGeometry, Properties>]) -> RouteBounds? where Properties: Codable & Equatable {
        features.compactMap { feature -> RouteBounds? in
            guard let line = try? line(from: feature.geometry) else {
                return nil
            }
            return bounds(for: line)
        }
        .reduce(nil) { partial, bounds in
            guard let partial else {
                return bounds
            }
            return partial.union(bounds)
        }
    }

    private static func parseCoordinate(_ coordinate: [Double]) throws -> LngLatCoordinate {
        guard coordinate.count >= 2 else {
            throw GeoJSONParsingError.invalidCoordinate
        }
        let longitude = coordinate[0]
        let latitude = coordinate[1]
        guard longitude.isFinite, latitude.isFinite else {
            throw GeoJSONParsingError.invalidCoordinate
        }
        return LngLatCoordinate(longitude: longitude, latitude: latitude)
    }
}
