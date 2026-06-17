import Foundation

enum OverlayKind: Hashable {
    case routeCasing
    case routeLine
    case facility
}

struct MapOverlayDescriptor: Hashable, Identifiable {
    let id: String
    let kind: OverlayKind
    let routeID: String?
    let coordinates: [LngLatCoordinate]
    let hexColor: String
    let lineWidth: Double
    let opacity: Double
    let isInteractive: Bool
}

enum MapOverlayPlanner {
    static func routeDescriptors(
        routes: [GeoJSONFeature<LineStringGeometry, CorpusRouteProperties>],
        filters: RouteFilterState,
        searchResultIDs: Set<String>?,
        selectedRouteID: String?,
        colorMode: ColorMode
    ) -> [MapOverlayDescriptor] {
        let visibleRoutes = RouteFiltering.visibleRoutes(
            from: routes,
            filters: filters,
            searchResultIDs: searchResultIDs
        )

        var descriptors: [MapOverlayDescriptor] = []
        for route in visibleRoutes {
            guard let line = try? GeoJSONRouteDecoder.line(from: route.geometry) else {
                continue
            }
            let routeID = RouteID.normalized(route.properties.id)
            let selected = selectedRouteID == nil || selectedRouteID == routeID
            let lineOpacity = selected ? 0.95 : 0.18
            let casingOpacity = selected ? 0.72 : 0.08
            descriptors.append(
                MapOverlayDescriptor(
                    id: "route-\(routeID)-casing",
                    kind: .routeCasing,
                    routeID: routeID,
                    coordinates: line,
                    hexColor: "#223020",
                    lineWidth: selectedRouteID == routeID ? 9 : 7,
                    opacity: casingOpacity,
                    isInteractive: false
                )
            )
            descriptors.append(
                MapOverlayDescriptor(
                    id: "route-\(routeID)-line",
                    kind: .routeLine,
                    routeID: routeID,
                    coordinates: line,
                    hexColor: routeHexColor(for: route.properties, colorMode: colorMode),
                    lineWidth: selectedRouteID == routeID ? 6 : 4,
                    opacity: lineOpacity,
                    isInteractive: true
                )
            )
        }
        return descriptors
    }

    static func facilityDescriptors(
        facilities: [GeoJSONFeature<MultiLineStringGeometry, FacilityProperties>]
    ) -> [MapOverlayDescriptor] {
        facilities.flatMap { feature -> [MapOverlayDescriptor] in
            guard let lines = try? GeoJSONRouteDecoder.lines(from: feature.geometry) else {
                return []
            }
            return lines.enumerated().map { index, line in
                MapOverlayDescriptor(
                    id: "facility-\(feature.properties.id)-\(index)",
                    kind: .facility,
                    routeID: nil,
                    coordinates: line,
                    hexColor: RouteStyling.facilityHexColor(feature.properties.facilityClass),
                    lineWidth: 2,
                    opacity: 0.7,
                    isInteractive: false
                )
            }
        }
    }

    private static func routeHexColor(for properties: CorpusRouteProperties, colorMode: ColorMode) -> String {
        switch colorMode {
        case .source:
            RouteStyling.routeHexColor(source: properties.source)
        case .quality:
            RouteStyling.routeHexColor(quality: properties.qualityScore)
        }
    }
}
