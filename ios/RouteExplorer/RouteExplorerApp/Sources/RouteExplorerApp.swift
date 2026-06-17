import SwiftUI

@main
struct RouteExplorerApp: App {
    @State private var store = RouteExplorerStore(api: RouteExplorerApp.makeAPI())

    var body: some Scene {
        WindowGroup {
            RouteExplorerView(store: store)
        }
    }

    private static func makeAPI() -> RouteAPI {
        if ProcessInfo.processInfo.arguments.contains("--ui-test-fixtures") {
            return FixtureRouteAPI()
        }
        return RouteAPIClient.live()
    }
}
