import Foundation

enum RouteFormatters {
    static func distance(_ kilometers: Double?) -> String {
        guard let kilometers else {
            return "Unknown distance"
        }
        let miles = kilometers * 0.621371
        return String(format: "%.1f mi", miles)
    }

    static func elevation(_ meters: Double?) -> String {
        guard let meters else {
            return "Unknown"
        }
        let feet = meters * 3.28084
        return String(format: "%.0f ft", feet)
    }

    static func percent(_ value: Double?) -> String {
        guard let value else {
            return "Unknown"
        }
        return String(format: "%.0f%%", value * 100)
    }

    static func poiDistance(_ meters: Double) -> String {
        let feet = meters * 3.28084
        if feet < 1_000 {
            return String(format: "%.0f ft", feet)
        }
        let miles = meters * 0.000621371
        return String(format: "%.1f mi", miles)
    }

    static func score(_ value: Double?) -> String {
        guard let value else {
            return "Unknown"
        }
        return String(format: "%.2f", value)
    }

    static func loop(_ value: Bool?) -> String {
        guard let value else {
            return "Unknown"
        }
        return value ? "Loop" : "Point to point"
    }

    static func surfaceSummary(_ breakdown: [String: Double]?) -> String {
        guard let breakdown, breakdown.isEmpty == false else {
            return "Unknown surface"
        }
        return breakdown
            .sorted { $0.value > $1.value }
            .prefix(2)
            .map { "\($0.key) \(percent($0.value))" }
            .joined(separator: ", ")
    }
}
