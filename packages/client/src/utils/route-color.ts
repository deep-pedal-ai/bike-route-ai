// Route colour encoding. Categorical palette keyed by `source`, tuned toward
// outdoor ride-planning cues: leaf, river, clay, and trail paint. Deepened and
// saturated so each line holds its own on the CREAM Voyager basemap (the old
// mid-tones — #86a85e leaf, #d8aa52 trail — washed out on light tiles). Pure —
// no React, no MapLibre import.

const SOURCE_COLORS: Record<string, string> = {
  osm_relation: '#3f7d2f', // deep leaf — broad public route corpus
  canon: '#1f7e98', // river teal — curated routes
  generated: '#c4602b', // clay — AI/generated routes
  nysdot: '#b5852a', // trail gold — agency routes
};

const DEFAULT_SOURCE_COLOR: string = '#5c5f52'; // lichen stone — unknown / unmapped source

export function colorBySource(source: string): string {
  return SOURCE_COLORS[source] ?? DEFAULT_SOURCE_COLOR;
}

// Sequential gradient for quality_score (0..1): muted soil at the low end,
// vivid leaf at the high end. Both endpoints are dark enough to read against
// cream tiles while staying distinct from one another.
const QUALITY_LOW = { r: 0x8a, g: 0x6a, b: 0x2a }; // dry earth / amber soil
const QUALITY_HIGH = { r: 0x2f, g: 0x82, b: 0x33 }; // living leaf
const QUALITY_NEUTRAL = '#5a5d50'; // shaded stone — null / unscored

function toHex(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}

export function colorByQuality(score: number | null): string {
  if (score === null) {
    return QUALITY_NEUTRAL;
  }
  const t = Math.min(1, Math.max(0, score));
  const r = Math.round(QUALITY_LOW.r + (QUALITY_HIGH.r - QUALITY_LOW.r) * t);
  const g = Math.round(QUALITY_LOW.g + (QUALITY_HIGH.g - QUALITY_LOW.g) * t);
  const b = Math.round(QUALITY_LOW.b + (QUALITY_HIGH.b - QUALITY_LOW.b) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
