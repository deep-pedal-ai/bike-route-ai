import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Magic Lane MCP server — exposes geospatial tools (location search, routing,
// isochrones, round trips, reverse geocoding, static/interactive maps). See
// https://github.com/magiclane/magiclane-mcp-server
const SERVER_NAME = 'magiclane';
// The package exposes two bins (stdio and http); npx can't auto-resolve which
// one to run from the package name alone, so name it explicitly via -p/bin.
const STDIO_PACKAGE = '@magiclane/mcp-server';
const STDIO_BIN = 'magiclane-mcp';
// Tools loaded generically: their input schemas round-trip cleanly through
// @langchain/mcp-adapters' client-side validation.
//   - round_trip: a loop of a target size (`range`) from a single departure
//     point. No concept of a stop/waypoint — re-rolling `random_seed` is the
//     only lever, so it CANNOT honor "pass through <place>" requests.
//   - route_planner: an origin→destination route that DOES accept an ordered
//     `intermediate_waypoints` array (coordinates / address / reference_poi /
//     along_route_poi). This is the tool for "add a stop in <part of town>";
//     set destination == origin to make it a loop with a stop. Verified that
//     coordinate/address/reference_poi stop shapes pass client-side validation
//     (unlike static_map_render's union — see buildRoutingMapTool below).
//   - location_search: lets the model resolve a place name (e.g. "Irvine, CA")
//     to coordinates directly, instead of stuffing the place name into a nested
//     reference_location shape — which the model reliably mangles.
// Other tools (isochrones, etc.) can be added the same way once there's a need.
//
// NB: static_map_render is NOT loaded generically — its union input schema
// breaks client-side validation; see buildRoundTripMapTool / buildRoutingMapTool.
const GENERIC_TOOL_NAMES = ['round_trip', 'route_planner', 'location_search'] as const;

// static_map_render is NOT loaded generically: its `parameters` field is a
// Zod *union* of four sub-schemas (routing / isochrone / round_trip /
// map_location). When the MCP server's JSON Schema for that union is
// converted into a DynamicStructuredTool by @langchain/mcp-adapters, the
// resulting schema contains `anyOf` branches with internal $refs (e.g.
// `#/properties/parameters/anyOf/0/properties/...`) that
// @cfworker/json-schema — used for client-side arg validation — cannot
// resolve. Every call fails with "Unresolved $ref" before it ever reaches the
// MCP server, regardless of how well-formed the input is (confirmed by
// invoking the raw MCP tool directly with valid round-trip-shaped input).
//
// Workaround: skip the broken DynamicStructuredTool wrapper for this tool and
// call it through the raw MCP `Client.callTool` instead (which goes straight
// to the server's own Zod validation, where unions work fine). We hand-write
// a narrow Zod schema below, scoped to rendering a round-trip loop — the one
// case this app needs — rather than exposing the full 4-way-union input
// shape to the model.
//
// interactive_map is intentionally NOT bound: unlike static_map_render, it
// doesn't return an image. It returns an MCP Apps UI resource (a raw HTML/JS
// MapLibre widget meant to run in a sandboxed iframe inside an MCP-Apps-aware
// host like Claude Desktop). This chat surface has no such host, so there's
// nowhere to render it yet.
const DepartureSchema = z
  .object({
    coordinates: z
      .object({ longitude: z.number(), latitude: z.number() })
      .optional()
      .describe('Exact [longitude, latitude] in WGS84. Prefer this when known — no search step required.'),
    location: z
      .object({
        text: z.string().describe('Place name, address, or POI query to resolve.'),
        target: z.enum(['pois', 'addresses', 'cities']).default('addresses'),
      })
      .optional()
      .describe('Resolve the start point from a place name when exact coordinates are unknown.'),
  })
  .refine((d) => d.coordinates !== undefined || d.location !== undefined, {
    message: "Either 'coordinates' or 'location' must be provided",
  });

const RoundTripRenderInputSchema = z.object({
  departure: DepartureSchema.describe('Start AND end point of the loop.'),
  range: z
    .number()
    .positive()
    .describe(
      'Target loop size. Seconds when type is "fastest"/"economic"/"scenic"; meters when type is "shortest".',
    ),
  transport: z
    .enum(['car', 'lorry', 'truck', 'pedestrian', 'bike', 'public'])
    .default('bike')
    .describe('Transport mode for the loop.'),
  type: z
    .enum(['fastest', 'shortest', 'economic', 'scenic'])
    .default('fastest')
    .describe('Optimization objective and units for `range`.'),
});

// Mirrors the relevant slice of @langchain/mcp-adapters' own content-block
// conversion (text passthrough, image as a data-URL image_url block) so the
// hand-built tools below produce ToolMessage content in the same shape the
// rest of the agent already expects from MCP tool results.
function toToolMessageContent(result: CallToolResult, toolName: string) {
  if (result.isError) {
    const message = result.content
      .map((content) => (content.type === 'text' ? content.text : `[${content.type}]`))
      .join('\n');
    throw new Error(`MCP tool '${toolName}' returned an error: ${message}`);
  }

  return result.content.map((content) => {
    if (content.type === 'text') {
      return { type: 'text', text: content.text };
    }
    if (content.type === 'image') {
      return { type: 'image_url', image_url: { url: `data:${content.mimeType};base64,${content.data}` } };
    }
    return { type: 'text', text: `[unsupported MCP content type: ${content.type}]` };
  });
}

// Builds the round-trip map render tool directly against the raw MCP client,
// bypassing the broken DynamicStructuredTool schema validation described
// above.
function buildRoundTripMapTool(rawClient: Client): DynamicStructuredTool {
  return tool(
    async (input) => {
      const result = await rawClient.callTool({
        name: 'static_map_render',
        arguments: { render_type: 'round_trip', output_format: 'image/png', parameters: input },
      });
      return toToolMessageContent(result as CallToolResult, 'static_map_render');
    },
    {
      name: 'render_round_trip_map',
      description:
        'Render a static PNG map image of a cycling round-trip loop, starting and ending at the same location.',
      schema: RoundTripRenderInputSchema,
    },
  ) as unknown as DynamicStructuredTool;
}

// static_map_render with render_type:'routing' is also a union branch, so it
// hits the same client-side validation wall as the round-trip render. We
// hand-write a narrow Zod schema scoped to drawing a cycling route (with
// optional stops) and call the raw MCP client, mirroring buildRoundTripMapTool.
const RouteCoordinatesSchema = z.object({
  longitude: z.number().describe('Longitude in WGS84, -180..180. East positive.'),
  latitude: z.number().describe('Latitude in WGS84, -90..90. North positive.'),
});

// A free-text place resolved during routing, optionally biased toward a
// city/region so "downtown" lands in the right town.
const RouteLocationSchema = z.object({
  text: z.string().describe('Place name, address, or POI query to resolve.'),
  target: z.enum(['pois', 'addresses', 'cities']).default('addresses'),
  poi_categories: z
    .array(z.string())
    .optional()
    .describe('Required when target="pois" (e.g. ["food&drink"], ["sightseeing"]).'),
  reference_location: z
    .object({
      coordinates: RouteCoordinatesSchema.optional(),
      location_text: z.string().optional().describe('City/region to scope the search, e.g. "Irvine, CA".'),
    })
    .optional()
    .describe('Geographic context that biases resolution toward an area.'),
});

// Origin/destination point: exact coordinates (preferred) or a place to resolve.
const RoutePointSchema = z
  .object({
    coordinates: RouteCoordinatesSchema.optional().describe('Exact [longitude, latitude]. Prefer when known.'),
    location: RouteLocationSchema.optional().describe('Resolve from a place name when coordinates are unknown.'),
  })
  .refine((d) => d.coordinates !== undefined || d.location !== undefined, {
    message: "Either 'coordinates' or 'location' must be provided",
  });

// One intermediate stop. `type` selects the shape: fixed point (coordinates),
// resolved address, a POI near a reference area, or a flexible POI along the way.
const RouteStopSchema = z.object({
  type: z
    .enum(['coordinates', 'address', 'reference_poi', 'along_route_poi'])
    .describe('Stop shape. Use "address"/"reference_poi" for a stop in a specific part of town.'),
  waypoint: z
    .object({
      coordinates: RouteCoordinatesSchema.optional(),
      location: RouteLocationSchema.optional(),
    })
    .describe('Stop location; shape must match `type` (coordinates → coordinates, otherwise location).'),
});

const RoutingRenderInputSchema = z.object({
  transport: z
    .enum(['car', 'lorry', 'truck', 'pedestrian', 'bike', 'public'])
    .default('bike')
    .describe('Transport mode; must match the route_planner call.'),
  type: z
    .enum(['fastest', 'shortest'])
    .default('fastest')
    .describe('Optimization objective; must match the route_planner call.'),
  origin: RoutePointSchema.describe('Route start point.'),
  destination: RoutePointSchema.describe('Route end point. Set equal to origin to draw a loop.'),
  intermediate_waypoints: z
    .array(RouteStopSchema)
    .default([])
    .describe('Ordered stops between origin and destination — pass the same list used for route_planner.'),
});

// Builds the routing map render tool against the raw MCP client, bypassing the
// broken DynamicStructuredTool schema validation (see buildRoundTripMapTool).
function buildRoutingMapTool(rawClient: Client): DynamicStructuredTool {
  return tool(
    async (input) => {
      const result = await rawClient.callTool({
        name: 'static_map_render',
        arguments: { render_type: 'routing', output_format: 'image/png', parameters: input },
      });
      return toToolMessageContent(result as CallToolResult, 'static_map_render');
    },
    {
      name: 'render_routing_map',
      description:
        'Render a static PNG map of a point-to-point or looped cycling route, including any intermediate stops. ' +
        'Pass the same origin, destination, intermediate_waypoints, transport, and type used for route_planner.',
      schema: RoutingRenderInputSchema,
    },
  ) as unknown as DynamicStructuredTool;
}

type MagicLaneMcpOptions = {
  apiKey?: string;
  url?: string;
};

type MagicLaneMcpConfig = {
  apiKey?: string;
  url?: string;
};

function resolveConfig(options: MagicLaneMcpOptions): MagicLaneMcpConfig {
  return {
    apiKey: options.apiKey ?? process.env.MAGICLANE_API_KEY,
    url: options.url ?? process.env.MAGICLANE_MCP_URL,
  };
}

// The connection is config-driven: when MAGICLANE_MCP_URL is set we talk to an
// already-running Magic Lane service over streamable HTTP; otherwise we spawn
// the published package over stdio via npx. This keeps the dev loop
// zero-infra while letting production point at a standalone service without
// code changes.
//
// Per-server connection options for MultiServerMCPClient, derived from config.
// Pure (no I/O) so the branch selection is unit-testable. Exported for tests.
export function resolveServerOptions(config: MagicLaneMcpConfig) {
  if (config.url) {
    return {
      transport: 'http' as const,
      url: config.url,
      // The remote service typically holds its own MAGICLANE_API_KEY, but
      // forward ours as a bearer token when present for keyed deployments.
      ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
    };
  }

  if (!config.apiKey) {
    // Should never reach here: callers gate on isMagicLaneConfigured first.
    throw new Error('MAGICLANE_API_KEY or MAGICLANE_MCP_URL is required for the Magic Lane MCP tools');
  }

  return {
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', '-p', STDIO_PACKAGE, STDIO_BIN],
    env: { MAGICLANE_API_KEY: config.apiKey },
  };
}

function buildClient(config: MagicLaneMcpConfig): MultiServerMCPClient {
  return new MultiServerMCPClient({
    mcpServers: { [SERVER_NAME]: resolveServerOptions(config) },
  });
}

// Whether enough config is present to load the tools at all. The chat agent
// skips MCP entirely when this is false, so it keeps working (tool-less) in
// environments without a Magic Lane key — e.g. local dev and tests.
export function isMagicLaneConfigured(options: MagicLaneMcpOptions = {}): boolean {
  const { apiKey, url } = resolveConfig(options);
  return Boolean(apiKey || url);
}

// Memoized so the whole process shares one client (and, for stdio, one
// subprocess) rather than spawning/connecting per chat request.
let clientPromise: Promise<MultiServerMCPClient> | null = null;

/**
 * Connect to the Magic Lane MCP server and return the bound tools (round-trip
 * loops, point-to-point/looped route planning with stops, location search, and
 * static map rendering of either) as LangChain tools ready to bind to an agent.
 * Returns an empty array when no connection is configured. The underlying
 * client is created once and reused.
 */
export async function loadMagicLaneTools(
  options: MagicLaneMcpOptions = {},
): Promise<DynamicStructuredTool[]> {
  const config = resolveConfig(options);
  if (!config.apiKey && !config.url) {
    return [];
  }

  clientPromise ??= Promise.resolve(buildClient(config));
  try {
    const client = await clientPromise;
    const tools = await client.getTools();
    const genericTools = tools.filter((mcpTool) =>
      (GENERIC_TOOL_NAMES as readonly string[]).includes(mcpTool.name),
    );

    const rawClient = await client.getClient(SERVER_NAME);
    if (!rawClient) {
      return genericTools;
    }

    return [...genericTools, buildRoundTripMapTool(rawClient), buildRoutingMapTool(rawClient)];
  } catch (err) {
    // Drop the memoized client so a later request can retry a fresh connection
    // rather than reusing a half-open one.
    clientPromise = null;
    throw err;
  }
}

// Close the shared client (and its stdio subprocess, if any). Safe to call when
// nothing was ever connected.
export async function closeMagicLaneClient(): Promise<void> {
  if (!clientPromise) {
    return;
  }
  const pending = clientPromise;
  clientPromise = null;
  const client = await pending;
  await client.close();
}
