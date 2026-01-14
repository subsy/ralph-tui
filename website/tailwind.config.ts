/**
 * ABOUTME: Tailwind CSS configuration with design tokens from the Ralph TUI theme.
 * Uses CSS variables for dark/light mode theming support.
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Background colors using CSS variables for theme switching
        bg: {
          primary: 'rgb(var(--bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--bg-tertiary) / <alpha-value>)',
          highlight: 'rgb(var(--bg-highlight) / <alpha-value>)',
        },
        // Foreground (text) colors
        fg: {
          primary: 'rgb(var(--fg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--fg-secondary) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          dim: 'rgb(var(--fg-dim) / <alpha-value>)',
        },
        // Status colors
        status: {
          success: 'rgb(var(--status-success) / <alpha-value>)',
          warning: 'rgb(var(--status-warning) / <alpha-value>)',
          error: 'rgb(var(--status-error) / <alpha-value>)',
          info: 'rgb(var(--status-info) / <alpha-value>)',
        },
        // Accent colors
        accent: {
          primary: 'rgb(var(--accent-primary) / <alpha-value>)',
          secondary: 'rgb(var(--accent-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--accent-tertiary) / <alpha-value>)',
        },
        // Border colors
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          active: 'rgb(var(--border-active) / <alpha-value>)',
          muted: 'rgb(var(--border-muted) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-space-mono)', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'rgb(var(--fg-primary))',
            '--tw-prose-headings': 'rgb(var(--fg-primary))',
            '--tw-prose-lead': 'rgb(var(--fg-secondary))',
            '--tw-prose-links': 'rgb(var(--accent-primary))',
            '--tw-prose-bold': 'rgb(var(--fg-primary))',
            '--tw-prose-counters': 'rgb(var(--fg-muted))',
            '--tw-prose-bullets': 'rgb(var(--fg-muted))',
            '--tw-prose-hr': 'rgb(var(--border))',
            '--tw-prose-quotes': 'rgb(var(--fg-secondary))',
            '--tw-prose-quote-borders': 'rgb(var(--accent-primary))',
            '--tw-prose-captions': 'rgb(var(--fg-muted))',
            '--tw-prose-code': 'rgb(var(--accent-tertiary))',
            '--tw-prose-pre-code': 'rgb(var(--fg-primary))',
            '--tw-prose-pre-bg': 'rgb(var(--bg-primary))',
            '--tw-prose-th-borders': 'rgb(var(--border))',
            '--tw-prose-td-borders': 'rgb(var(--border-muted))',
          },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        'slide-up': 'slide-up 0.5s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
