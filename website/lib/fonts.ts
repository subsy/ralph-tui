/**
 * ABOUTME: Font configuration for the Ralph TUI website.
 * Configures Inter for body text and Space Mono for code blocks.
 */

import { Inter, Space_Mono } from 'next/font/google';

/**
 * Inter font configuration for body text.
 * Variable font with Latin subset for optimal loading.
 */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * Space Mono font configuration for code and monospace text.
 * Matches the terminal aesthetic of the TUI.
 */
export const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-mono',
});

/**
 * Combined font class names for use in the root layout.
 */
export const fontVariables = `${inter.variable} ${spaceMono.variable}`;
