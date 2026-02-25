/**
 * ABOUTME: Built-in tracker plugin exports and registration.
 * Provides factory functions for all built-in tracker plugins
 * and a function to register them with the registry.
 */

import { getTrackerRegistry } from '../registry.js';
import createJsonTracker from './json/index.js';
import createBeadsTracker from './beads/index.js';
import createBeadsBvTracker from './beads-bv/index.js';
import createBeadsRustTracker from './beads-rust/index.js';
import createBeadsRustBvTracker from './beads-rust-bv/index.js';

/**
 * All built-in tracker plugin factories.
 */
export const builtinTrackers = {
  json: createJsonTracker,
  beads: createBeadsTracker,
  'beads-bv': createBeadsBvTracker,
  'beads-rust': createBeadsRustTracker,
  'beads-rust-bv': createBeadsRustBvTracker,
} as const;

/**
 * Register all built-in tracker plugins with the registry.
 * Should be called during application initialization.
 */
export function registerBuiltinTrackers(): void {
  const registry = getTrackerRegistry();

  for (const factory of Object.values(builtinTrackers)) {
    registry.registerBuiltin(factory);
  }
}

export {
  createJsonTracker,
  createBeadsTracker,
  createBeadsBvTracker,
  createBeadsRustTracker,
  createBeadsRustBvTracker,
};
