import CoreLocation
import MapKit

struct AppleMapsRoutePoint: Equatable {
    let title: String
    let coordinate: LngLatCoordinate
}

struct AppleMapsRouteLaunchPlan: Equatable {
    enum Origin: Equatable {
        case currentLocation
        case routePoint(AppleMapsRoutePoint)
    }

    let origin: Origin
    let destination: AppleMapsRoutePoint
    let directionsMode: String
}

enum AppleMapsRouteLauncher {
    static func launchPlan(for route: CorpusRouteDetailResponse) -> AppleMapsRouteLaunchPlan? {
        guard let line = try? GeoJSONRouteDecoder.line(from: route.geometry),
              let first = line.first,
              let last = line.last
        else {
            return nil
        }

        let name = route.properties.name ?? "Route \(route.properties.id)"
        let start = AppleMapsRoutePoint(title: "\(name) start", coordinate: first)
        let end = AppleMapsRoutePoint(title: "\(name) finish", coordinate: last)

        if route.properties.isLoop == true || first.isNear(last, meters: 75) {
            return AppleMapsRouteLaunchPlan(
                origin: .currentLocation,
                destination: start,
                directionsMode: MKLaunchOptionsDirectionsModeCycling
            )
        }

        return AppleMapsRouteLaunchPlan(
            origin: .routePoint(start),
            destination: end,
            directionsMode: MKLaunchOptionsDirectionsModeCycling
        )
    }

    @discardableResult
    static func openInMaps(_ plan: AppleMapsRouteLaunchPlan) -> Bool {
        let mapItems: [MKMapItem]
        switch plan.origin {
        case .currentLocation:
            mapItems = [
                MKMapItem.forCurrentLocation(),
                mapItem(for: plan.destination)
            ]
        case .routePoint(let origin):
            mapItems = [
                mapItem(for: origin),
                mapItem(for: plan.destination)
            ]
        }

        return MKMapItem.openMaps(
            with: mapItems,
            launchOptions: [MKLaunchOptionsDirectionsModeKey: plan.directionsMode]
        )
    }

    @discardableResult
    static func openRouteInMaps(_ route: CorpusRouteDetailResponse) -> Bool {
        guard let plan = launchPlan(for: route) else {
            return false
        }
        return openInMaps(plan)
    }

    private static func mapItem(for point: AppleMapsRoutePoint) -> MKMapItem {
        let coordinate = CLLocationCoordinate2D(
            latitude: point.coordinate.latitude,
            longitude: point.coordinate.longitude
        )
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        item.name = point.title
        return item
    }
}

private extension LngLatCoordinate {
    func isNear(_ other: LngLatCoordinate, meters: CLLocationDistance) -> Bool {
        let here = CLLocation(latitude: latitude, longitude: longitude)
        let there = CLLocation(latitude: other.latitude, longitude: other.longitude)
        return here.distance(from: there) <= meters
    }
}
