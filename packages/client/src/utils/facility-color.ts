// Facility overlay colour encoding. One distinct colour per facility_class, kept
// off the route palette so the overlay reads as a separate layer. Pure.

const FACILITY_COLORS: Record<string, string> = {
  protected: '#2f855a', // forest — physically separated, strongest signal
  lane: '#78aeca', // sky paint
  sharrow: '#c77b5f', // clay marker
  greenway: '#76a95b', // meadow
  other: '#909886', // stone
};

const DEFAULT_FACILITY_COLOR = '#737a6b'; // shaded stone — unknown class

export function facilityColor(cls: string): string {
  return FACILITY_COLORS[cls] ?? DEFAULT_FACILITY_COLOR;
}
