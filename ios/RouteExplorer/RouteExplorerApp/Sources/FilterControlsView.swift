import Observation
import SwiftUI

struct FilterControlsView: View {
    @Bindable var store: RouteExplorerStore

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                sourceMenu
                distanceMenu
                loopButton
                qualityMenu
                Picker("Color", selection: $store.colorMode) {
                    ForEach(ColorMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 190)
                facilityButton
            }
            .padding(12)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityIdentifier("filter-controls")
    }

    private var sourceMenu: some View {
        Menu {
            Button {
                store.filters.sources.removeAll()
            } label: {
                Label("All sources", systemImage: store.filters.sources.isEmpty ? "checkmark" : "circle")
            }

            ForEach(sources, id: \.self) { source in
                Button {
                    if store.filters.sources.contains(source) {
                        store.filters.sources.remove(source)
                    } else {
                        store.filters.sources.insert(source)
                    }
                } label: {
                    Label(source, systemImage: store.filters.sources.contains(source) ? "checkmark" : "circle")
                }
            }
        } label: {
            ControlLabel(systemImage: "line.3.horizontal.decrease.circle", title: sourceTitle)
        }
        .accessibilityLabel("Source filter")
    }

    private var distanceMenu: some View {
        Menu {
            ForEach(DistancePreset.allCases) { preset in
                Button {
                    store.setDistancePreset(preset)
                } label: {
                    Label(preset.title, systemImage: distancePreset == preset ? "checkmark" : "circle")
                }
            }
        } label: {
            ControlLabel(systemImage: "ruler", title: distancePreset.title)
        }
        .accessibilityLabel("Distance filter")
    }

    private var loopButton: some View {
        Button {
            store.filters.loopOnly.toggle()
        } label: {
            ControlLabel(
                systemImage: store.filters.loopOnly ? "arrow.triangle.2.circlepath.circle.fill" : "arrow.triangle.2.circlepath.circle",
                title: "Loops"
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Loop only")
        .accessibilityValue(store.filters.loopOnly ? "On" : "Off")
    }

    private var qualityMenu: some View {
        Menu {
            Button {
                store.filters.minQuality = nil
            } label: {
                Label("Any quality", systemImage: store.filters.minQuality == nil ? "checkmark" : "circle")
            }
            ForEach([0.4, 0.6, 0.8], id: \.self) { quality in
                Button {
                    store.filters.minQuality = quality
                } label: {
                    Label("At least \(RouteFormatters.percent(quality))", systemImage: store.filters.minQuality == quality ? "checkmark" : "circle")
                }
            }
        } label: {
            ControlLabel(systemImage: "star.circle", title: qualityTitle)
        }
        .accessibilityLabel("Minimum quality")
    }

    private var facilityButton: some View {
        Button {
            Task { await store.setFacilitiesEnabled(store.facilitiesEnabled == false) }
        } label: {
            ControlLabel(
                systemImage: store.facilitiesEnabled ? "point.3.connected.trianglepath.dotted.fill" : "point.3.connected.trianglepath.dotted",
                title: "Facilities"
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Facility overlay")
        .accessibilityValue(store.facilitiesEnabled ? "On" : "Off")
    }

    private var sources: [String] {
        store.availableSources.isEmpty ? RouteStyling.knownSources : store.availableSources
    }

    private var sourceTitle: String {
        store.filters.sources.isEmpty ? "All sources" : "\(store.filters.sources.count) source\(store.filters.sources.count == 1 ? "" : "s")"
    }

    private var qualityTitle: String {
        guard let minQuality = store.filters.minQuality else {
            return "Any quality"
        }
        return "\(RouteFormatters.percent(minQuality))+"
    }

    private var distancePreset: DistancePreset {
        switch (store.filters.minKm, store.filters.maxKm) {
        case (nil, nil):
            .any
        case (nil, 10):
            .under10
        case (10, 25):
            .tenTo25
        case (25, 50):
            .twentyFiveTo50
        case (50, nil):
            .fiftyPlus
        default:
            .any
        }
    }
}

struct ControlLabel: View {
    let systemImage: String
    let title: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
