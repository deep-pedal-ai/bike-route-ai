import Testing
@testable import RouteExplorer

struct RouteFormattersTests {
    @Test func formatsDistanceAsMiles() {
        #expect(RouteFormatters.distance(10) == "6.2 mi")
    }

    @Test func formatsMetersAsFeet() {
        #expect(RouteFormatters.elevation(100) == "328 ft")
    }

    @Test func formatsPercent() {
        #expect(RouteFormatters.percent(0.357) == "36%")
    }
}
