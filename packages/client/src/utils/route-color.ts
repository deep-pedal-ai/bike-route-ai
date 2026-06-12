// Route colour encoding. Categorical palette keyed by `source`, tuned toward
// outdoor ride-planning cues: leaf, river, wildflower, and trail paint. Pure —
// no React, no MapLibre import.

const SOURCE_COLORS: Record<string, string> = {
  osm_relation: '#86a85e', // leaf — broad public route corpus
  canon: '#4f9bb0', // river — curated routes
  generated: '#d9865b', // clay — AI/generated routes
  nysdot: '#d8aa52', // trail marker — agency routes
};

const DEFAULT_SOURCE_COLOR = '#969b8c'; // lichen stone — unknown / unmapped source

export function colorBySource(source: string): string {
  return SOURCE_COLORS[source] ?? DEFAULT_SOURCE_COLOR;
}

// Sequential gradient for quality_score (0..1): muted soil at the low end,
// living leaf at the high end. It should read as outdoorsy, not neon.
const QUALITY_LOW = { r: 0x65, g: 0x67, b: 0x53 }; // olive soil
const QUALITY_HIGH = { r: 0x86, g: 0xa8, b: 0x5e }; // leaf
const QUALITY_NEUTRAL = '#666a5d'; // shaded stone — null / unscored

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
