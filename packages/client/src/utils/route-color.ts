// Route colour encoding. Categorical palette keyed by `source`, harmonised with
// the app's lime accent (`lime-400` = #a3e635), plus a sequential gradient for
// `quality_score`. Pure — no React, no MapLibre import.

const SOURCE_COLORS: Record<string, string> = {
  osm_relation: '#a3e635', // lime-400 — the brand accent anchors the primary source
  canon: '#38bdf8', // sky-400
  generated: '#f472b6', // pink-400
  nysdot: '#fbbf24', // amber-400
};

const DEFAULT_SOURCE_COLOR = '#a1a1aa'; // zinc-400 — unknown / unmapped source

export function colorBySource(source: string): string {
  return SOURCE_COLORS[source] ?? DEFAULT_SOURCE_COLOR;
}

// Sequential gradient for quality_score (0..1): dim slate at the low end ramping
// to the lime accent at the high end, so "good" routes glow in the brand colour.
const QUALITY_LOW = { r: 0x33, g: 0x41, b: 0x55 }; // slate-700
const QUALITY_HIGH = { r: 0xa3, g: 0xe6, b: 0x35 }; // lime-400
const QUALITY_NEUTRAL = '#52525b'; // zinc-600 — null / unscored

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
