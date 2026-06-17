import Foundation

struct AppEnvironment {
    let apiBaseURL: URL

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        let rawValue = bundle.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        let fallback = "http://localhost:3000"
        let value = (rawValue?.isEmpty == false ? rawValue : fallback) ?? fallback
        guard let url = URL(string: value) else {
            return AppEnvironment(apiBaseURL: URL(string: fallback)!)
        }
        return AppEnvironment(apiBaseURL: url)
    }
}
