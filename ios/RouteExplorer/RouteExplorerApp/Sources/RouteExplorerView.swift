import SwiftUI

struct RouteExplorerView: View {
    let store: RouteExplorerStore

    private var selectedRouteBinding: Binding<SelectedRoute?> {
        Binding(
            get: { store.selectedRoute },
            set: { selection in
                if selection == nil {
                    store.clearSelection()
                }
            }
        )
    }

    var body: some View {
        RouteMapView(
            routeDescriptors: MapOverlayPlanner.routeDescriptors(
                routes: store.routes,
                filters: store.filters,
                searchResultIDs: store.activeSearchIDs,
                selectedRouteID: store.selectedRoute?.id,
                colorMode: store.colorMode
            ),
            facilityDescriptors: store.facilitiesEnabled
                ? MapOverlayPlanner.facilityDescriptors(facilities: store.facilities)
                : [],
            cameraIntent: store.cameraIntent,
            onRouteSelected: { routeID in
                store.selectRoute(routeID)
            }
        )
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            SearchBarPanel(store: store)
                .padding(.horizontal, 16)
                .padding(.top, 10)
        }
        .safeAreaInset(edge: .bottom) {
            bottomPanel
        }
        .overlay(alignment: .leading) {
            LoadingStatusPanel(store: store)
                .padding(.leading, 12)
        }
        .sheet(item: selectedRouteBinding) { selection in
            RouteDetailSheet(store: store, selectedRouteID: selection.id)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .task(id: selection.id) {
                    await store.loadSelectedRouteDetail()
                }
        }
        .task {
            await store.loadInitialData()
        }
    }

    @ViewBuilder
    private var bottomPanel: some View {
        if store.searchPanelOpen {
            SearchResultsPanel(store: store)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
        } else {
            FilterControlsView(store: store)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
        }
    }
}

struct LoadingStatusPanel: View {
    let store: RouteExplorerStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if store.routeLoading {
                StatusChip(title: "Loading routes", systemImage: "arrow.clockwise")
            }
            if let routeError = store.routeError {
                StatusChip(title: routeError, systemImage: "exclamationmark.triangle")
            }
            if store.facilityLoading {
                StatusChip(title: "Loading facilities", systemImage: "point.3.connected.trianglepath.dotted")
            }
            if let facilityError = store.facilityError {
                StatusChip(title: facilityError, systemImage: "exclamationmark.triangle")
            }
        }
        .frame(maxWidth: 280, alignment: .leading)
        .accessibilityIdentifier("loading-status-panel")
    }
}

struct StatusChip: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.primary)
            .lineLimit(2)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: Capsule())
    }
}
