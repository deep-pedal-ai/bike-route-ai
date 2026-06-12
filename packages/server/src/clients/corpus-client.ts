import { query } from '../db.js';

import type {
  CorpusRouteProps,
  CorpusRouteDetailProps,
  CorpusStats,
  FacilityProps,
} from '@bike-route-ai/shared';
import type { Feature, LineString, MultiLineString } from 'geojson';

// Every query below assembles its ENTIRE result in SQL (json_build_object /
// jsonb_agg / ST_AsGeoJSON(...)::json) so node-postgres parses it as a JS value
// with real numbers — never hand-mapping pg rows (which would re-introduce the
// bigint/numeric/count-as-string bug). Each query returns a single row whose
// `result` column is the finished payload.

type ResultRow<T> = { result: T };

export const getRoutesOverview = async (): Promise<
  Feature<LineString, CorpusRouteProps>[]
> => {
  const sql = `
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(ST_Simplify(geom, 0.0001))::jsonb,
          'properties', jsonb_build_object(
            'id', id,
            'name', name,
            'source', source,
            'distance_km', distance_km,
            'is_loop', is_loop,
            'quality_score', quality_score,
            'ascent_m', ascent_m,
            'descent_m', descent_m,
            'network', network
          )
        )
      ),
      '[]'::jsonb
    ) as result
    from routes
    where geom is not null
  `;
  const { rows } = await query<ResultRow<Feature<LineString, CorpusRouteProps>[]>>(sql);
  return rows[0].result;
};

export const getRouteById = async (
  id: number,
): Promise<Feature<LineString, CorpusRouteDetailProps> | null> => {
  const sql = `
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(geom)::jsonb,
      'properties', jsonb_build_object(
        'id', id,
        'name', name,
        'source', source,
        'distance_km', distance_km,
        'is_loop', is_loop,
        'quality_score', quality_score,
        'ascent_m', ascent_m,
        'descent_m', descent_m,
        'network', network,
        'source_id', source_id,
        'match_quality', match_quality,
        'surface_breakdown', surface_breakdown,
        'waytype_breakdown', waytype_breakdown,
        'steepness_breakdown', steepness_breakdown,
        'protected_lane_fraction', protected_lane_fraction,
        'greenway_fraction', greenway_fraction,
        'facility_coverage_fraction', facility_coverage_fraction,
        'attribution', attribution,
        'osm_way_id_count', coalesce(array_length(osm_way_ids, 1), 0),
        'tags', coalesce(tags, '{}'::jsonb)
      )
    ) as result
    from routes
    where id = $1 and geom is not null
  `;
  const { rows } = await query<
    ResultRow<Feature<LineString, CorpusRouteDetailProps>>
  >(sql, [id]);
  return rows.length > 0 ? rows[0].result : null;
};

// Cap on facility features returned per bbox request. We fetch CAP+1 rows so a
// full page (more rows existed than the cap) flips `truncated`.
const FACILITY_CAP = 2000;

export const getFacilitiesInBbox = async (
  bbox: [number, number, number, number],
  classes?: string[],
): Promise<{
  features: Feature<MultiLineString, FacilityProps>[];
  truncated: boolean;
  count: number;
}> => {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const hasClasses = classes !== undefined && classes.length > 0;

  // $1..$4 bbox; $5 cap+1 (limit); $6 cap; $7 classes (optional).
  const sql = `
    with fetched as (
      select id, facility_class, borough, geom
      from facility_segments
      where geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        and geom is not null
        ${hasClasses ? 'and facility_class = ANY($7)' : ''}
      limit $5
    ),
    capped as (
      select * from fetched limit $6
    )
    select jsonb_build_object(
      'features', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(ST_Simplify(geom, 0.0005))::jsonb,
              'properties', jsonb_build_object(
                'id', id,
                'facility_class', facility_class,
                'borough', borough
              )
            )
          )
          from capped
        ),
        '[]'::jsonb
      ),
      'truncated', (select count(*) from fetched) > $6,
      'count', least((select count(*) from fetched), $6)
    ) as result
  `;

  const params: unknown[] = [
    minLng,
    minLat,
    maxLng,
    maxLat,
    FACILITY_CAP + 1,
    FACILITY_CAP,
  ];
  if (hasClasses) params.push(classes);

  const { rows } = await query<
    ResultRow<{
      features: Feature<MultiLineString, FacilityProps>[];
      truncated: boolean;
      count: number;
    }>
  >(sql, params);
  return rows[0].result;
};

export const getStats = async (): Promise<CorpusStats> => {
  // Assembled as ONE jsonb object so all counts come back as JSON numbers
  // (jsonb_object_agg over count(*)::int) rather than pg bigint strings.
  const sql = `
    with route_sources as (
      select source, count(*)::int as n
      from routes
      group by source
    ),
    facility_classes as (
      select facility_class, count(*)::int as n
      from facility_segments
      group by facility_class
    ),
    route_extent as (
      select ST_Extent(geom) as ext
      from routes
      where geom is not null
    )
    select jsonb_build_object(
      'routes_by_source', coalesce(
        (select jsonb_object_agg(source, n) from route_sources),
        '{}'::jsonb
      ),
      'facilities_by_class', coalesce(
        (select jsonb_object_agg(facility_class, n) from facility_classes),
        '{}'::jsonb
      ),
      'bbox', (
        select jsonb_build_array(
          ST_XMin(ext::geometry),
          ST_YMin(ext::geometry),
          ST_XMax(ext::geometry),
          ST_YMax(ext::geometry)
        )
        from route_extent
      )
    ) as result
  `;
  const { rows } = await query<ResultRow<CorpusStats>>(sql);
  return rows[0].result;
};
