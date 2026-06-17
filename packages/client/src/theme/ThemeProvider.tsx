import { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_THEME, readInitialTheme, STORAGE_KEY, ThemeContext } from './theme-context.js';

import type { ReactNode } from 'react';
import type { Theme } from './theme-context.js';

type ThemeProviderProps = {
  children: ReactNode;
};

/**
 * Owns theme state for the app: initialises from the DOM/localStorage (so it
 * agrees with the no-flash script), mirrors changes onto <html data-theme> and
 * persists the user's choice.
 */
export default function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persisting is best-effort; ignore quota/privacy-mode failures.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(
    () => ({ theme: theme ?? DEFAULT_THEME, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
