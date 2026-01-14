/**
 * ABOUTME: PostCSS configuration for Tailwind CSS processing.
 * Uses @tailwindcss/postcss plugin for Tailwind v4 compatibility.
 */

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
