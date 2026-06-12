// Facility overlay colour encoding. One distinct colour per facility_class, kept
// off the route palette so the overlay reads as a separate layer. Pure.

const FACILITY_COLORS: Record<string, string> = {
  protected: '#22d3ee', // cyan-400 — physically separated, strongest signal
  lane: '#60a5fa', // blue-400
  sharrow: '#c084fc', // purple-400
  greenway: '#34d399', // emerald-400
  other: '#94a3b8', // slate-400
};

const DEFAULT_FACILITY_COLOR = '#64748b'; // slate-500 — unknown class

export function facilityColor(cls: string): string {
  return FACILITY_COLORS[cls] ?? DEFAULT_FACILITY_COLOR;
}
