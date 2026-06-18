import CoreLocation
import MapKit
import SwiftUI
import UIKit

struct RouteMapView: UIViewRepresentable {
    let routeDescriptors: [MapOverlayDescriptor]
    let facilityDescriptors: [MapOverlayDescriptor]
    let poiDescriptors: [PoiAnnotationDescriptor]
    let cameraIntent: CameraIntent?
    let onRouteSelected: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onRouteSelected: onRouteSelected)
    }

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView(frame: .zero)
        mapView.delegate = context.coordinator
        mapView.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .realistic)
        mapView.showsUserLocation = false
        mapView.showsCompass = true
        mapView.showsScale = true
        mapView.pointOfInterestFilter = .excludingAll
        mapView.isPitchEnabled = false
        mapView.accessibilityIdentifier = "route-map"
        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: PoiAnnotation.reuseIdentifier
        )

        let recognizer = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        recognizer.cancelsTouchesInView = false
        mapView.addGestureRecognizer(recognizer)
        context.coordinator.mapView = mapView
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.onRouteSelected = onRouteSelected
        context.coordinator.render(
            mapView: mapView,
            facilityDescriptors: facilityDescriptors,
            poiDescriptors: poiDescriptors,
            routeDescriptors: routeDescriptors
        )
        context.coordinator.apply(cameraIntent: cameraIntent, to: mapView)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        weak var mapView: MKMapView?
        var onRouteSelected: (String) -> Void
        private var renderedDescriptors: [MapOverlayDescriptor] = []
        private var renderedPOIDescriptors: [PoiAnnotationDescriptor] = []
        private var descriptorsByOverlay: [ObjectIdentifier: MapOverlayDescriptor] = [:]
        private var interactiveLines: [(routeID: String, coordinates: [LngLatCoordinate])] = []
        private var lastCameraIntentID: UUID?

        init(onRouteSelected: @escaping (String) -> Void) {
            self.onRouteSelected = onRouteSelected
        }

        func render(
            mapView: MKMapView,
            facilityDescriptors: [MapOverlayDescriptor],
            poiDescriptors: [PoiAnnotationDescriptor],
            routeDescriptors: [MapOverlayDescriptor]
        ) {
            let descriptors = facilityDescriptors + routeDescriptors
            if descriptors != renderedDescriptors {
                mapView.removeOverlays(mapView.overlays)
                descriptorsByOverlay = [:]
                interactiveLines = []

                let overlays = descriptors.compactMap(makeOverlay)
                mapView.addOverlays(overlays, level: .aboveRoads)
                renderedDescriptors = descriptors
            }

            if poiDescriptors != renderedPOIDescriptors {
                let currentPOIs = mapView.annotations.compactMap { $0 as? PoiAnnotation }
                mapView.removeAnnotations(currentPOIs)
                mapView.addAnnotations(poiDescriptors.map { PoiAnnotation(descriptor: $0) })
                renderedPOIDescriptors = poiDescriptors
            }
        }

        func apply(cameraIntent: CameraIntent?, to mapView: MKMapView) {
            guard let cameraIntent, lastCameraIntentID != cameraIntent.id else {
                return
            }
            lastCameraIntentID = cameraIntent.id
            let rect = mkMapRect(for: cameraIntent.bounds)
            guard rect.isNull == false else {
                return
            }
            mapView.setVisibleMapRect(
                rect,
                edgePadding: padding(for: cameraIntent.reason, in: mapView),
                animated: cameraIntent.reason != .initialLoad
            )
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
            guard
                let polyline = overlay as? MKPolyline,
                let descriptor = descriptorsByOverlay[ObjectIdentifier(polyline)]
            else {
                return MKOverlayRenderer(overlay: overlay)
            }

            let renderer = MKPolylineRenderer(polyline: polyline)
            renderer.strokeColor = UIColor(hex: descriptor.hexColor).withAlphaComponent(descriptor.opacity)
            renderer.lineWidth = descriptor.lineWidth
            renderer.lineJoin = .round
            renderer.lineCap = .round
            return renderer
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
            guard let poiAnnotation = annotation as? PoiAnnotation else {
                return nil
            }
            let view = mapView.dequeueReusableAnnotationView(
                withIdentifier: PoiAnnotation.reuseIdentifier,
                for: poiAnnotation
            )
            guard let markerView = view as? MKMarkerAnnotationView else {
                return view
            }
            markerView.annotation = poiAnnotation
            markerView.canShowCallout = true
            markerView.markerTintColor = UIColor(hex: RouteStyling.poiHexColor(poiAnnotation.descriptor.bucket))
            markerView.glyphTintColor = .white
            markerView.glyphImage = UIImage(systemName: RouteStyling.poiGlyphName(poiAnnotation.descriptor.bucket))
            markerView.titleVisibility = .adaptive
            markerView.subtitleVisibility = .adaptive
            markerView.displayPriority = .defaultHigh
            markerView.animatesWhenAdded = true
            return markerView
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let mapView else {
                return
            }
            let point = recognizer.location(in: mapView)
            guard isAnnotationTap(point, in: mapView) == false else {
                return
            }
            var bestMatch: (routeID: String, distance: CGFloat)?

            for line in interactiveLines.reversed() {
                let distance = minimumDistance(from: point, to: line.coordinates, in: mapView)
                if distance <= 24, bestMatch == nil || distance < bestMatch!.distance {
                    bestMatch = (line.routeID, distance)
                }
            }

            if let routeID = bestMatch?.routeID {
                onRouteSelected(routeID)
            }
        }

        private func makeOverlay(_ descriptor: MapOverlayDescriptor) -> MKPolyline? {
            guard descriptor.coordinates.count >= 2 else {
                return nil
            }
            var coordinates = descriptor.coordinates.map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
            let polyline = MKPolyline(coordinates: &coordinates, count: coordinates.count)
            descriptorsByOverlay[ObjectIdentifier(polyline)] = descriptor
            if descriptor.isInteractive, let routeID = descriptor.routeID {
                interactiveLines.append((routeID, descriptor.coordinates))
            }
            return polyline
        }

        private func isAnnotationTap(_ point: CGPoint, in mapView: MKMapView) -> Bool {
            var hitView = mapView.hitTest(point, with: nil)
            while let current = hitView {
                if current is MKAnnotationView {
                    return true
                }
                hitView = current.superview
            }
            return false
        }

        private func mkMapRect(for bounds: RouteBounds) -> MKMapRect {
            let southWest = MKMapPoint(
                CLLocationCoordinate2D(latitude: bounds.minLat, longitude: bounds.minLng)
            )
            let northEast = MKMapPoint(
                CLLocationCoordinate2D(latitude: bounds.maxLat, longitude: bounds.maxLng)
            )
            let minX = min(southWest.x, northEast.x)
            let minY = min(southWest.y, northEast.y)
            let width = max(abs(northEast.x - southWest.x), 1_000)
            let height = max(abs(northEast.y - southWest.y), 1_000)
            return MKMapRect(x: minX, y: minY, width: width, height: height)
        }

        private func padding(for reason: CameraIntent.Reason, in mapView: MKMapView) -> UIEdgeInsets {
            let compactHeight = mapView.bounds.height < 700
            switch reason {
            case .initialLoad:
                return UIEdgeInsets(top: 72, left: 48, bottom: compactHeight ? 120 : 180, right: 48)
            case .searchResults:
                return UIEdgeInsets(top: 108, left: 48, bottom: compactHeight ? 220 : 300, right: 48)
            case .selectedRoute:
                return UIEdgeInsets(top: 96, left: 48, bottom: compactHeight ? 240 : 320, right: 48)
            }
        }

        private func minimumDistance(
            from point: CGPoint,
            to coordinates: [LngLatCoordinate],
            in mapView: MKMapView
        ) -> CGFloat {
            guard coordinates.count >= 2 else {
                return .greatestFiniteMagnitude
            }
            let points = coordinates.map {
                mapView.convert(
                    CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude),
                    toPointTo: mapView
                )
            }
            return zip(points, points.dropFirst()).reduce(.greatestFiniteMagnitude) { partial, segment in
                min(partial, distance(from: point, toSegmentFrom: segment.0, to: segment.1))
            }
        }

        private func distance(from point: CGPoint, toSegmentFrom start: CGPoint, to end: CGPoint) -> CGFloat {
            let dx = end.x - start.x
            let dy = end.y - start.y
            guard dx != 0 || dy != 0 else {
                return hypot(point.x - start.x, point.y - start.y)
            }
            let t = max(0, min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
            let projection = CGPoint(x: start.x + t * dx, y: start.y + t * dy)
            return hypot(point.x - projection.x, point.y - projection.y)
        }
    }
}

final class PoiAnnotation: NSObject, MKAnnotation {
    static let reuseIdentifier = "route-poi-marker"

    let descriptor: PoiAnnotationDescriptor
    let coordinate: CLLocationCoordinate2D

    var title: String? {
        descriptor.title
    }

    var subtitle: String? {
        descriptor.subtitle
    }

    init(descriptor: PoiAnnotationDescriptor) {
        self.descriptor = descriptor
        self.coordinate = CLLocationCoordinate2D(
            latitude: descriptor.coordinate.latitude,
            longitude: descriptor.coordinate.longitude
        )
    }
}

extension UIColor {
    convenience init(hex: String) {
        let sanitized = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: sanitized).scanHexInt64(&value)
        let red = CGFloat((value >> 16) & 0xff) / 255
        let green = CGFloat((value >> 8) & 0xff) / 255
        let blue = CGFloat(value & 0xff) / 255
        self.init(red: red, green: green, blue: blue, alpha: 1)
    }
}
