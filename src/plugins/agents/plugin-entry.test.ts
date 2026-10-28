/**
 * ABOUTME: Guards the external plugin entry point from OpenTUI imports.
 * Walks its relative source imports and reports any forbidden renderer edge.
 */

import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');
const PLUGIN_ENTRY = resolve(REPOSITORY_ROOT, 'src/plugin.ts');
const FORBIDDEN_IMPORTS = new Set(['@opentui/core', '@opentui/react', 'react']);

function findImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const fromPattern = /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g;
  const sideEffectPattern = /\bimport\s*['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(fromPattern)) {
    const specifier = match[1];
    if (specifier) specifiers.add(specifier);
  }
  for (const match of source.matchAll(sideEffectPattern)) {
    const specifier = match[1];
    if (specifier) specifiers.add(specifier);
  }
  for (const match of source.matchAll(dynamicPattern)) {
    const specifier = match[1];
    if (specifier) specifiers.add(specifier);
  }

  return [...specifiers];
}

function findForbiddenImport(specifier: string): string | undefined {
  return [...FORBIDDEN_IMPORTS].find(
    (forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
  );
}

async function resolveSourceModule(
  importer: string,
  specifier: string
): Promise<string | undefined> {
  if (!specifier.startsWith('.')) return undefined;

  const unresolved = resolve(dirname(importer), specifier);
  const extension = extname(unresolved);
  const withoutJavaScriptExtension = extension === '.js'
    ? unresolved.slice(0, -extension.length)
    : unresolved;
  const candidates = extension === '.ts' || extension === '.tsx'
    ? [unresolved]
    : [
        `${withoutJavaScriptExtension}.ts`,
        `${withoutJavaScriptExtension}.tsx`,
        resolve(withoutJavaScriptExtension, 'index.ts'),
        resolve(withoutJavaScriptExtension, 'index.tsx'),
      ];

  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // Try the next source extension or index file.
    }
  }

  throw new Error(`Unable to resolve relative import ${specifier} from ${importer}`);
}

async function findForbiddenImports(): Promise<string[]> {
  const visited = new Set<string>();
  const offenders: string[] = [];

  async function visit(modulePath: string, chain: string[]): Promise<void> {
    if (visited.has(modulePath)) return;
    visited.add(modulePath);

    const source = await readFile(modulePath, 'utf8');
    for (const specifier of findImportSpecifiers(source)) {
      const nextChain = [...chain, `${modulePath} -> ${specifier}`];
      if (findForbiddenImport(specifier)) {
        offenders.push(
          `Forbidden import "${specifier}" from ${modulePath}\nImport chain:\n${nextChain.join('\n')}`
        );
        continue;
      }

      const dependency = await resolveSourceModule(modulePath, specifier);
      if (dependency) {
        await visit(dependency, nextChain);
      }
    }
  }

  await visit(PLUGIN_ENTRY, [PLUGIN_ENTRY]);
  return offenders;
}

describe('ralph-tui/plugin entry point', () => {
  test('finds forbidden dynamic imports in source text', () => {
    expect(findImportSpecifiers("await import('@opentui/core');")).toContain('@opentui/core');
  });

  test('finds forbidden import subpaths in source text', () => {
    expect(findForbiddenImport('react/jsx-runtime')).toBe('react');
  });

  test('does not reach OpenTUI or React through relative imports', async () => {
    const offenders = await findForbiddenImports();
    if (offenders.length > 0) {
      throw new Error(offenders.join('\n\n'));
    }
    expect(offenders).toEqual([]);
  });
});
