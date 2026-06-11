export interface Route {
  id: string;
  name: string;
  distance: number; // km
  waypoints: [number, number][]; // [lat, lng]
}

export interface RouteRequest {
  origin: string;
  destination: string;
}

export interface RouteResponse {
  routes: Route[];
}
