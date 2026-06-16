import { createContext } from 'react';

export type Theme = 'light' | 'dark';

export type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

export const STORAGE_KEY = 'theme';
export const DEFAULT_THEME: Theme = 'light';

/**
 * Reads the current theme from the DOM attribute the no-flash script wrote,
 * falling back to localStorage, then the light default. Keeping the provider
 * and the inline script in agreement on mount is what prevents a flash for
 * dark-mode users.
 */
export function readInitialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.theme;
    if (attr === 'dark' || attr === 'light') return attr;
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'dark') {
      return 'dark';
    }
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through to default.
  }
  return DEFAULT_THEME;
}

/**
 * Context defaults to a working light theme with a no-op setter so components
 * that read `useTheme()` outside a provider (e.g. Header in isolation tests)
 * render without throwing.
 */
export const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  toggleTheme: () => {},
});
