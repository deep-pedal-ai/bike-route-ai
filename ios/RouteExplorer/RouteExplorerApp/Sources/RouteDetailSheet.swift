import SwiftUI

struct RouteDetailSheet: View {
    let store: RouteExplorerStore
    let selectedRouteID: String
    @State private var appleMapsErrorPresented = false

    var body: some View {
        NavigationStack {
            Group {
                if store.routeDetailLoading {
                    ProgressView("Loading route")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = store.routeDetailError {
                    ContentUnavailableView("Route unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if let detail = store.routeDetail {
                    detailContent(detail)
                } else {
                    ProgressView("Loading route")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(routeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.clearSelection()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close route details")
                }
            }
        }
        .accessibilityIdentifier("route-detail-sheet")
        .alert("Apple Maps unavailable", isPresented: $appleMapsErrorPresented) {
            Button("OK", role: .cancel) {}
        }
    }

    private func detailContent(_ detail: CorpusRouteDetailResponse) -> some View {
        let route = detail.properties
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(route.name ?? "Route \(route.id)")
                    .font(.title2.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                if AppleMapsRouteLauncher.launchPlan(for: detail) != nil {
                    Button {
                        if AppleMapsRouteLauncher.openRouteInMaps(detail) == false {
                            appleMapsErrorPresented = true
                        }
                    } label: {
                        Label("Start in Apple Maps", systemImage: "location.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .accessibilityIdentifier("start-apple-maps")
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 138), spacing: 10)], spacing: 10) {
                    MetricCell(title: "Distance", value: RouteFormatters.distance(route.distanceKm), systemImage: "ruler")
                    MetricCell(title: "Route type", value: RouteFormatters.loop(route.isLoop), systemImage: "arrow.triangle.2.circlepath")
                    MetricCell(title: "Ascent", value: RouteFormatters.elevation(route.ascentM), systemImage: "mountain.2")
                    MetricCell(title: "Descent", value: RouteFormatters.elevation(route.descentM), systemImage: "arrow.down")
                    MetricCell(title: "Quality", value: RouteFormatters.score(route.qualityScore), systemImage: "star")
                    MetricCell(title: "Match", value: RouteFormatters.score(route.matchQuality), systemImage: "scope")
                    MetricCell(title: "Protected lanes", value: RouteFormatters.percent(route.protectedLaneFraction), systemImage: "shield")
                    MetricCell(title: "Greenway", value: RouteFormatters.percent(route.greenwayFraction), systemImage: "leaf")
                    MetricCell(title: "Facility coverage", value: RouteFormatters.percent(route.facilityCoverageFraction), systemImage: "point.3.connected.trianglepath.dotted")
                }

                BreakdownSection(title: "Surface", values: route.surfaceBreakdown)
                BreakdownSection(title: "Waytype", values: route.waytypeBreakdown)

                VStack(alignment: .leading, spacing: 8) {
                    Label(route.source, systemImage: "tray.full")
                    Label(route.sourceId, systemImage: "number")
                    Label("\(route.osmWayIdCount) OSM ways", systemImage: "map")
                    if let attribution = route.attribution {
                        Text(attribution)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .padding()
        }
    }

    private var routeTitle: String {
        if let detail = store.routeDetail {
            return detail.properties.name ?? "Route \(detail.properties.id)"
        }
        return "Route \(selectedRouteID)"
    }
}

struct MetricCell: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(value)
                .font(.headline)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct BreakdownSection: View {
    let title: String
    let values: [String: Double]?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
            if let values, values.isEmpty == false {
                ForEach(values.sorted(by: { $0.value > $1.value }), id: \.key) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(item.key.capitalized)
                            Spacer()
                            Text(RouteFormatters.percent(item.value))
                                .foregroundStyle(.secondary)
                        }
                        ProgressView(value: min(1, max(0, item.value)))
                            .tint(.green)
                    }
                    .font(.subheadline)
                }
            } else {
                Text("Unknown")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
