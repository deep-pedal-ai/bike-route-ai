import Foundation
import SwiftUI

enum RouteStyling {
    static let knownSources = ["osm_relation", "canon", "generated", "nysdot"]
    static let facilityClasses = ["protected", "lane", "sharrow", "greenway", "other"]

    static func routeColor(source: String) -> Color {
        Color(hex: routeHexColor(source: source))
    }

    static func routeColor(quality: Double?) -> Color {
        Color(hex: routeHexColor(quality: quality))
    }

    static func routeHexColor(source: String) -> String {
        switch source {
        case "osm_relation":
            "#86a85e"
        case "canon":
            "#4f9bb0"
        case "generated":
            "#d9865b"
        case "nysdot":
            "#d8aa52"
        default:
            "#969b8c"
        }
    }

    static func routeHexColor(quality: Double?) -> String {
        guard let quality else {
            return "#666a5d"
        }
        let t = min(1, max(0, quality))
        let low = (r: 0x65, g: 0x67, b: 0x53)
        let high = (r: 0x86, g: 0xa8, b: 0x5e)
        let r = Int(round(Double(low.r) + Double(high.r - low.r) * t))
        let g = Int(round(Double(low.g) + Double(high.g - low.g) * t))
        let b = Int(round(Double(low.b) + Double(high.b - low.b) * t))
        return String(format: "#%02x%02x%02x", r, g, b)
    }

    static func facilityHexColor(_ facilityClass: String) -> String {
        switch facilityClass {
        case "protected":
            "#2f855a"
        case "lane":
            "#78aeca"
        case "sharrow":
            "#c77b5f"
        case "greenway":
            "#76a95b"
        case "other":
            "#909886"
        default:
            "#737a6b"
        }
    }
}

extension Color {
    init(hex: String) {
        let sanitized = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: sanitized).scanHexInt64(&value)
        let red = Double((value >> 16) & 0xff) / 255
        let green = Double((value >> 8) & 0xff) / 255
        let blue = Double(value & 0xff) / 255
        self.init(red: red, green: green, blue: blue)
    }
}
