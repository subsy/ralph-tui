/**
 * ABOUTME: Theme provider component for dark/light mode switching.
 * Wraps next-themes ThemeProvider with default configuration.
 */

'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * Theme provider that enables dark/light mode switching.
 * Defaults to dark mode to match the TUI aesthetic.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
