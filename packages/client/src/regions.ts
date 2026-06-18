// Region registry — the single source of truth the RegionSwitcher and the
// per-region initial camera are driven by. NY and Seattle both ship enabled;
// the list-driven switcher keeps a 3rd region a dropdown, not a redesign.
// Disabled entries (if any) render as a non-clickable "coming soon" pill.
// See docs/multi-region-seattle-plan.md §7, §8.

export type RegionView = {
  longitude: number;
  latitude: number;
  zoom: number;
};

export type Region = {
  // The `region` partition key (matches the DB column / API ?region= value).
  key: string;
  // Short pill label.
  label: string;
  // Initial camera used until the corpus loads (per-region; NO geolocate in S1).
  defaultView: RegionView;
  // Disabled regions render as a non-clickable "coming soon" pill.
  enabled: boolean;
};

export const DEFAULT_REGION = 'ny';

export const REGIONS: Region[] = [
  {
    key: 'ny',
    label: 'New York',
    // Sensible NY default centre used until routes load.
    defaultView: { longitude: -73.95, latitude: 40.7, zoom: 10 },
    enabled: true,
  },
  {
    key: 'seattle',
    label: 'Seattle',
    // Puget Sound centre used until the Seattle corpus loads.
    defaultView: { longitude: -122.33, latitude: 47.61, zoom: 10 },
    enabled: true,
  },
  {
    key: 'sf',
    label: 'San Francisco',
    // Bay Area default: centre over the bay between SF and Oakland at zoom 12 so
    // the GGB and East Bay shorelines are both visible on load. Designed to fit
    // both the city rides (JFK Drive, Embarcadero) and the regional spurs
    // (Sausalito, Berkeley Marina) within the first viewport. Locked in STEP 0.
    defaultView: { longitude: -122.48, latitude: 37.81, zoom: 12 },
    enabled: true,
  },
];

// Look up a region by key, falling back to the default region when the key is
// unknown or absent (e.g. a stray ?region= value).
export function regionFor(key: string | null | undefined): Region {
  const found = REGIONS.find((r) => r.key === key && r.enabled);
  return found ?? REGIONS.find((r) => r.key === DEFAULT_REGION) ?? REGIONS[0];
}
