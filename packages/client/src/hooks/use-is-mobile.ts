import { useSyncExternalStore } from 'react';

// Single source of truth for the mobile/desktop divide. Matches Tailwind's `sm`
// breakpoint so CSS (`sm:` utilities) and JS (the camera-padding branch) can't
// drift. Mobile = strictly below this width.
export const MOBILE_BREAKPOINT_PX = 640;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

// True while the viewport is narrower than the `sm` breakpoint. Backed by
// useSyncExternalStore so the matchMedia subscription needs no effect/setState.
// Used only where CSS media queries can't reach — currently the imperative
// map-camera padding. Prefer Tailwind `sm:` utilities for plain show/hide.
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
