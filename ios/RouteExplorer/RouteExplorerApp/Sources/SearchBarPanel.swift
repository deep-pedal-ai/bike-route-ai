import Observation
import SwiftUI

struct SearchBarPanel: View {
    @Bindable var store: RouteExplorerStore
    @FocusState private var searchFocused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            TextField("Describe a ride", text: $store.searchQuery)
                .textInputAutocapitalization(.sentences)
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit {
                    Task { await store.submitSearch() }
                }
                .accessibilityLabel("Route search")

            Button {
                Task { await store.submitSearch() }
            } label: {
                Image(systemName: store.searchLoading ? "hourglass" : "arrow.forward.circle.fill")
                    .font(.title3)
            }
            .disabled(store.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.searchLoading)
            .accessibilityLabel("Search routes")

            if store.searchPanelOpen {
                Button {
                    store.clearSearch()
                    searchFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                }
                .accessibilityLabel("Close search results")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
        .frame(maxWidth: 540)
        .accessibilityIdentifier("route-search-bar")
    }
}
