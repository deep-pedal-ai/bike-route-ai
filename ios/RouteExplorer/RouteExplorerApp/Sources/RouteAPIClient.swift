import Foundation

protocol RouteAPI {
    func fetchRoutes() async throws -> CorpusRoutesResponse
    func fetchRouteDetail(id: Int) async throws -> CorpusRouteDetailResponse
    func fetchFacilities(bbox: [Double], classes: [String]) async throws -> FacilitiesResponse
    func fetchStats() async throws -> CorpusStats
    func searchRoutes(query: String) async throws -> RouteSearchResponse
}

protocol APITransport {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: APITransport {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw RouteAPIError.nonHTTPResponse
        }
        return (data, httpResponse)
    }
}

enum RouteAPIError: Error, Equatable, LocalizedError {
    case invalidURL
    case nonHTTPResponse
    case server(statusCode: Int, message: String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid API URL"
        case .nonHTTPResponse:
            "Server returned an invalid response"
        case .server(_, let message):
            message
        case .decoding(let message):
            message
        }
    }
}

struct RouteAPIClient: RouteAPI {
    let baseURL: URL
    let transport: APITransport
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    static func live(environment: AppEnvironment = .live()) -> RouteAPIClient {
        RouteAPIClient(baseURL: environment.apiBaseURL, transport: URLSessionTransport())
    }

    func fetchRoutes() async throws -> CorpusRoutesResponse {
        try await get("/api/corpus/routes")
    }

    func fetchRouteDetail(id: Int) async throws -> CorpusRouteDetailResponse {
        try await get("/api/corpus/routes/\(id)")
    }

    func fetchFacilities(bbox: [Double], classes: [String]) async throws -> FacilitiesResponse {
        var components = URLComponents()
        components.path = "/api/corpus/facilities"
        components.queryItems = [
            URLQueryItem(name: "bbox", value: bbox.map { String($0) }.joined(separator: ",")),
            URLQueryItem(name: "classes", value: classes.joined(separator: ","))
        ]
        return try await request(pathWithQuery: components.string ?? components.path)
    }

    func fetchStats() async throws -> CorpusStats {
        try await get("/api/corpus/stats")
    }

    func searchRoutes(query: String) async throws -> RouteSearchResponse {
        var request = try makeRequest(pathWithQuery: "/api/routes/search")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(["query": query])
        return try await run(request)
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(pathWithQuery: path)
    }

    private func request<T: Decodable>(pathWithQuery: String) async throws -> T {
        try await run(makeRequest(pathWithQuery: pathWithQuery))
    }

    private func makeRequest(pathWithQuery: String) throws -> URLRequest {
        guard let url = URL(string: pathWithQuery, relativeTo: baseURL)?.absoluteURL else {
            throw RouteAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func run<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? decoder.decode(ErrorResponse.self, from: data).error) ?? "Request failed with status \(response.statusCode)"
            throw RouteAPIError.server(statusCode: response.statusCode, message: message)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw RouteAPIError.decoding("Could not decode server response")
        }
    }
}
