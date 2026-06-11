import type { RouteData } from '../types/route';
import { GRAVEL_ROUTE, ROAD_ROUTE, CASUAL_ROUTE, buildFallbackRoute } from '../data/mock-routes';

export function matchRoute(query: string): RouteData {
  const q = query.toLowerCase();

  if (q.includes('gravel') || q.includes('coffee') || q.includes('fire road') || q.includes('crunch')) {
    return GRAVEL_ROUTE;
  }
  if (q.includes('coastal') || q.includes('coast') || q.includes('endurance') || q.includes('roller')) {
    return ROAD_ROUTE;
  }
  if (
    q.includes('casual') ||
    q.includes('easy') ||
    q.includes('flat') ||
    q.includes('greenway') ||
    q.includes('recovery') ||
    q.includes('path')
  ) {
    return CASUAL_ROUTE;
  }

  return buildFallbackRoute(query);
}
