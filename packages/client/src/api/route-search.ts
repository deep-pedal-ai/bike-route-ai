import type { ErrorResponse, RouteSearchResponse, RouteSearchResult } from '@bike-route-ai/shared';

const ROUTE_SEARCH_ENDPOINT = '/api/routes/search';

export async function searchRoutes(query: string, fetchImpl: typeof fetch = fetch): Promise<RouteSearchResponse> {
  const response = await fetchImpl(ROUTE_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(isErrorResponse(body) ? body.error : 'Route search failed');
  }
  if (!isRouteSearchResponse(body)) {
    throw new Error('Route search returned an invalid response');
  }

  return body;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function isRouteSearchResponse(value: unknown): value is RouteSearchResponse {
  if (!isRecord(value) || typeof value.filtersRelaxed !== 'boolean' || !Array.isArray(value.results)) {
    return false;
  }
  return value.results.every(isRouteSearchResult);
}

function isRouteSearchResult(value: unknown): value is RouteSearchResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.distanceKm) &&
    (value.ascentM === null || isFiniteNumber(value.ascentM)) &&
    typeof value.isLoop === 'boolean' &&
    (value.qualityScore === null || isFiniteNumber(value.qualityScore)) &&
    (value.surfaceBreakdown === null || isNumberRecord(value.surfaceBreakdown)) &&
    typeof value.blurb === 'string'
  );
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return isRecord(value) && typeof value.error === 'string' && typeof value.statusCode === 'number';
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
