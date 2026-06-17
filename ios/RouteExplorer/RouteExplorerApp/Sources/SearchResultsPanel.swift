import SwiftUI

struct SearchResultsPanel: View {
    let store: RouteExplorerStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            content
        }
        .padding(14)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                if store.filtersRelaxed {
                    Label("Filters relaxed", systemImage: "slider.horizontal.2.square")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button {
                store.clearSearch()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("Close search results")
            .accessibilityIdentifier("close-search-results")
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.searchLoading {
            HStack(spacing: 12) {
                ProgressView()
                Text("Searching routes")
                    .font(.subheadline)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 20)
        } else if let error = store.searchError {
            ContentUnavailableView("Search failed", systemImage: "exclamationmark.triangle", description: Text(error))
                .frame(minHeight: 180)
        } else if let results = store.searchResults, results.isEmpty {
            ContentUnavailableView("No routes", systemImage: "magnifyingglass", description: Text("Try a broader query."))
                .frame(minHeight: 180)
        } else if let results = store.searchResults {
            ScrollView(.vertical) {
                LazyVStack(spacing: 10) {
                    ForEach(results) { result in
                        SearchResultCard(
                            result: result,
                            isMappable: store.mappableRouteIDs.contains(RouteID.normalized(result.id)),
                            isSelected: store.selectedRoute?.id == RouteID.normalized(result.id),
                            onSelect: {
                                store.selectRoute(result.id)
                            }
                        )
                    }
                }
            }
            .frame(maxHeight: 320)
        }
    }

    private var title: String {
        if store.searchLoading {
            return "Searching"
        }
        if let results = store.searchResults {
            return "\(results.count) result\(results.count == 1 ? "" : "s")"
        }
        return "Search results"
    }
}

struct SearchResultCard: View {
    let result: RouteSearchResult
    let isMappable: Bool
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(result.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                Text(result.blurb)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)

                RouteMetadataRow(
                    distance: RouteFormatters.distance(result.distanceKm),
                    loop: result.isLoop ? "Loop" : "Point to point",
                    ascent: RouteFormatters.elevation(result.ascentM),
                    quality: RouteFormatters.score(result.qualityScore)
                )

                Text(RouteFormatters.surfaceSummary(result.surfaceBreakdown))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if isMappable == false {
                    Label("No map geometry", systemImage: "map")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? Color.green.opacity(0.16) : Color(.secondarySystemBackground))
            )
        }
        .buttonStyle(.plain)
        .disabled(isMappable == false)
        .accessibilityIdentifier("search-result-\(result.id)")
    }
}

struct RouteMetadataRow: View {
    let distance: String
    let loop: String
    let ascent: String
    let quality: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                metadata("ruler", distance)
                metadata("arrow.triangle.2.circlepath", loop)
                metadata("mountain.2", ascent)
                metadata("star", quality)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 12) {
                    metadata("ruler", distance)
                    metadata("arrow.triangle.2.circlepath", loop)
                }
                HStack(spacing: 12) {
                    metadata("mountain.2", ascent)
                    metadata("star", quality)
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    private func metadata(_ systemImage: String, _ text: String) -> some View {
        Label(text, systemImage: systemImage)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
    }
}
