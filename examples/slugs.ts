/**
 * ABOUTME: URL slug utilities for testing ralph-tui.
 * Provides functions to convert between human-readable text and URL-friendly slugs.
 */

/**
 * Converts a string to a URL-friendly slug.
 * @param s - The string to convert to a slug
 * @returns A lowercase, hyphen-separated slug
 * @example
 * slugify('Hello World') // returns 'hello-world'
 * slugify('My Blog Post!') // returns 'my-blog-post'
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Converts a slug back to a human-readable string with title case.
 * @param s - The slug to convert
 * @returns A title-cased string with spaces
 * @example
 * unslugify('hello-world') // returns 'Hello World'
 * unslugify('my-blog-post') // returns 'My Blog Post'
 */
export function unslugify(s: string): string {
  return s
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
