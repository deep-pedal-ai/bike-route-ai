import { useContext } from 'react';

import { ThemeContext } from './theme-context.js';

import type { ThemeContextValue } from './theme-context.js';

/**
 * Access the current theme and its setters. Returns the light default with
 * no-op setters when used outside a ThemeProvider, so isolated component tests
 * don't need to wrap in the provider.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
