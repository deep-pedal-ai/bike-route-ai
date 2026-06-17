import Foundation
import Testing
@testable import RouteExplorer

final class StubTransport: APITransport {
    var requests: [URLRequest] = []
    var handler: (URLRequest) throws -> (Data, HTTPURLResponse)

    init(handler: @escaping (URLRequest) throws -> (Data, HTTPURLResponse)) {
        self.handler = handler
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return try handler(request)
    }
}

struct RouteAPIClientTests {
    @Test func fetchRoutesDecodesGeoJSONAndUsesBaseURL() async throws {
        let body = """
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "geometry": { "type": "LineString", "coordinates": [[-73.9, 40.7], [-73.8, 40.8]] },
              "properties": {
                "id": 4,
                "name": "Harbor Loop",
                "source": "canon",
                "distance_km": 12,
                "is_loop": true,
                "quality_score": 0.82,
                "ascent_m": 120,
                "descent_m": 118,
                "network": "test"
              }
            }
          ]
        }
        """.data(using: .utf8)!
        let transport = StubTransport { request in
            (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = RouteAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)

        let response = try await client.fetchRoutes()

        #expect(response.features.first?.properties.id == 4)
        #expect(transport.requests.first?.url?.absoluteString == "https://example.test/api/corpus/routes")
    }

    @Test func serverErrorUsesAPIErrorPayload() async {
        let body = #"{"error":"route 404 not found","statusCode":404}"#.data(using: .utf8)!
        let transport = StubTransport { request in
            (body, HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!)
        }
        let client = RouteAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)

        await #expect(throws: RouteAPIError.server(statusCode: 404, message: "route 404 not found")) {
            _ = try await client.fetchRouteDetail(id: 404)
        }
    }
}
