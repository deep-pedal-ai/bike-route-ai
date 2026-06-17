import { Moon, Sun } from 'lucide-react';

import { useTheme } from './use-theme.js';

/**
 * Accessible light/dark switch. Shows the icon for the theme you'd switch TO
 * and announces the action via aria-label; it's a native <button>, so it's
 * keyboard-operable for free.
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-bark-border)] bg-[var(--color-bark-soft)] text-[var(--color-sage-text)] transition-all duration-200 hover:border-[var(--color-leaf)] hover:text-[var(--color-cream)]"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
