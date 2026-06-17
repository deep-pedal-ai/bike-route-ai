// Facility overlay colour encoding. One distinct colour per facility_class, kept
// off the route palette so the overlay reads as a separate layer. Tones are
// deepened to stay legible on the cream Voyager basemap. Pure.

const FACILITY_COLORS: Record<string, string> = {
  protected: '#1f6b46', // deep forest — physically separated, strongest signal
  lane: '#3d7fb0', // sky paint
  sharrow: '#b1583a', // clay marker
  greenway: '#4f8a3a', // meadow
  other: '#6f7563', // stone
};

const DEFAULT_FACILITY_COLOR: string = '#4d534a'; // shaded stone — unknown class

export function facilityColor(cls: string): string {
  return FACILITY_COLORS[cls] ?? DEFAULT_FACILITY_COLOR;
}
