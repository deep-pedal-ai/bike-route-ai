import Foundation
import Observation

struct SelectedRoute: Identifiable, Equatable {
    let id: String
}

struct CameraIntent: Equatable, Identifiable {
    enum Reason: Equatable {
        case initialLoad
        case searchResults
        case selectedRoute
    }

    let id = UUID()
    let bounds: RouteBounds
    let reason: Reason
}

@MainActor
@Observable
final class RouteExplorerStore {
    var routes: [GeoJSONFeature<LineStringGeometry, CorpusRouteProperties>] = []
    var facilities: [GeoJSONFeature<MultiLineStringGeometry, FacilityProperties>] = []
    var routeLoading = false
    var routeError: String?
    var facilityLoading = false
    var facilityError: String?
    var filters = RouteFilterState()
    var colorMode: ColorMode = .source
    var facilitiesEnabled = false
    var searchQuery = ""
    var searchLoading = false
    var searchResults: [RouteSearchResult]?
    var searchError: String?
    var filtersRelaxed = false
    var selectedRoute: SelectedRoute?
    var routeDetail: CorpusRouteDetailResponse?
    var routeDetailLoading = false
    var routeDetailError: String?
    var cameraIntent: CameraIntent?

    private let api: RouteAPI
    private let defaultFacilityBbox = [-74.3, 40.4, -73.6, 41.0]

    init(api: RouteAPI) {
        self.api = api
    }

    var searchPanelOpen: Bool {
        searchLoading || searchResults != nil || searchError != nil
    }

    var activeSearchIDs: Set<String>? {
        searchResults.map { Set($0.map { RouteID.normalized($0.id) }) }
    }

    var visibleRoutes: [GeoJSONFeature<LineStringGeometry, CorpusRouteProperties>] {
        RouteFiltering.visibleRoutes(
            from: routes,
            filters: filters,
            searchResultIDs: activeSearchIDs
        )
    }

    var mappableRouteIDs: Set<String> {
        Set(routes.map { RouteID.normalized($0.properties.id) })
    }

    var availableSources: [String] {
        Array(Set(routes.map(\.properties.source))).sorted()
    }

    func loadInitialData() async {
        routeLoading = true
        routeError = nil
        do {
            let response = try await api.fetchRoutes()
            routes = response.features
            if let bounds = GeoJSONRouteDecoder.bounds(for: routes) {
                cameraIntent = CameraIntent(bounds: bounds, reason: .initialLoad)
            }
        } catch {
            routeError = displayMessage(for: error)
        }
        routeLoading = false
    }

    func submitSearch() async {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.isEmpty == false, searchLoading == false else {
            return
        }
        searchLoading = true
        searchResults = nil
        searchError = nil
        filtersRelaxed = false
        do {
            let response = try await api.searchRoutes(query: query)
            searchResults = response.results
            filtersRelaxed = response.filtersRelaxed
            frameSearchResults(response.results)
        } catch {
            searchError = displayMessage(for: error)
        }
        searchLoading = false
    }

    func clearSearch() {
        searchQuery = ""
        searchLoading = false
        searchResults = nil
        searchError = nil
        filtersRelaxed = false
    }

    func selectRoute(_ id: String) {
        let normalized = RouteID.normalized(id)
        selectedRoute = SelectedRoute(id: normalized)
        routeDetail = nil
        routeDetailError = nil
        if let bounds = boundsForRoute(id: normalized) {
            cameraIntent = CameraIntent(bounds: bounds, reason: .selectedRoute)
        }
    }

    func clearSelection() {
        selectedRoute = nil
        routeDetail = nil
        routeDetailLoading = false
        routeDetailError = nil
    }

    func loadSelectedRouteDetail() async {
        guard let selectedRoute, let id = RouteID.numeric(selectedRoute.id) else {
            routeDetailError = "This route has no numeric corpus ID."
            return
        }
        routeDetailLoading = true
        routeDetailError = nil
        do {
            routeDetail = try await api.fetchRouteDetail(id: id)
        } catch {
            routeDetailError = displayMessage(for: error)
        }
        routeDetailLoading = false
    }

    func setFacilitiesEnabled(_ enabled: Bool) async {
        facilitiesEnabled = enabled
        guard enabled else {
            facilities = []
            facilityError = nil
            facilityLoading = false
            return
        }
        await loadFacilities()
    }

    func loadFacilities() async {
        guard facilitiesEnabled else {
            return
        }
        facilityLoading = true
        facilityError = nil
        do {
            let response = try await api.fetchFacilities(
                bbox: defaultFacilityBbox,
                classes: RouteStyling.facilityClasses
            )
            facilities = response.features
        } catch {
            facilityError = displayMessage(for: error)
        }
        facilityLoading = false
    }

    func setDistancePreset(_ preset: DistancePreset) {
        filters.minKm = preset.minKm
        filters.maxKm = preset.maxKm
    }

    private func frameSearchResults(_ results: [RouteSearchResult]) {
        let ids = Set(results.map { RouteID.normalized($0.id) })
        let matchingRoutes = routes.filter { ids.contains(RouteID.normalized($0.properties.id)) }
        if let bounds = GeoJSONRouteDecoder.bounds(for: matchingRoutes) {
            cameraIntent = CameraIntent(bounds: bounds, reason: .searchResults)
        }
    }

    private func boundsForRoute(id: String) -> RouteBounds? {
        let matches = routes.filter { RouteID.normalized($0.properties.id) == id }
        return GeoJSONRouteDecoder.bounds(for: matches)
    }

    private func displayMessage(for error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return description
        }
        return error.localizedDescription
    }
}

enum DistancePreset: String, CaseIterable, Identifiable {
    case any
    case under10
    case tenTo25
    case twentyFiveTo50
    case fiftyPlus

    var id: String { rawValue }

    var title: String {
        switch self {
        case .any:
            "Any distance"
        case .under10:
            "Under 10 km"
        case .tenTo25:
            "10-25 km"
        case .twentyFiveTo50:
            "25-50 km"
        case .fiftyPlus:
            "50+ km"
        }
    }

    var minKm: Double? {
        switch self {
        case .any, .under10:
            nil
        case .tenTo25:
            10
        case .twentyFiveTo50:
            25
        case .fiftyPlus:
            50
        }
    }

    var maxKm: Double? {
        switch self {
        case .any, .fiftyPlus:
            nil
        case .under10:
            10
        case .tenTo25:
            25
        case .twentyFiveTo50:
            50
        }
    }
}
