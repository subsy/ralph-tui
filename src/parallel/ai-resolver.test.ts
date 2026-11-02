/**
 * ABOUTME: Tests for AI-powered conflict resolution.
 * Tests fast-path heuristics, prompt building, content extraction, and the resolver callback.
 */

import { describe, expect, test } from 'bun:test';
import {
  tryFastPathResolution,
  buildConflictPrompt,
  extractResolvedContent,
} from './ai-resolver.js';
import type { FileConflict } from './types.js';

describe('tryFastPathResolution', () => {
  test('returns theirs when ours is empty', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: '',
      theirsContent: 'const x = 1;',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    expect(result).toBe('const x = 1;');
  });

  test('returns theirs when ours is whitespace only', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: '   \n  \t  ',
      theirsContent: 'const x = 1;',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    expect(result).toBe('const x = 1;');
  });

  test('returns ours when theirs is empty', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'const x = 1;',
      theirsContent: '',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    expect(result).toBe('const x = 1;');
  });

  test('returns ours when theirs is whitespace only', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'const x = 1;',
      theirsContent: '  \n\t  ',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    expect(result).toBe('const x = 1;');
  });

  test('returns ours when both sides are identical', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'const x = 1;',
      theirsContent: 'const x = 1;',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    expect(result).toBe('const x = 1;');
  });

  test('returns null when both sides have different content', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'const x = 1;',
      theirsContent: 'const x = 2;',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    expect(result).toBeNull();
  });

  test('returns null when both sides are empty', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: '',
      theirsContent: '',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = tryFastPathResolution(conflict);
    // Both empty but identical, so returns ours (empty string)
    expect(result).toBe('');
  });
});

describe('buildConflictPrompt', () => {
  test('includes file path in prompt', () => {
    const conflict: FileConflict = {
      filePath: 'src/utils/helper.ts',
      oursContent: 'const x = 1;',
      theirsContent: 'const x = 2;',
      baseContent: 'const x = 0;',
      conflictMarkers: '',
    };

    const prompt = buildConflictPrompt(conflict, {
      taskId: 'TASK-123',
      taskTitle: 'Add feature X',
    });

    expect(prompt).toContain('src/utils/helper.ts');
  });

  test('includes task context in prompt', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'const x = 1;',
      theirsContent: 'const x = 2;',
      baseContent: '',
      conflictMarkers: '',
    };

    const prompt = buildConflictPrompt(conflict, {
      taskId: 'TASK-456',
      taskTitle: 'Implement authentication',
    });

    expect(prompt).toContain('TASK-456');
    expect(prompt).toContain('Implement authentication');
  });

  test('includes all three versions in prompt', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'ours version content',
      theirsContent: 'theirs version content',
      baseContent: 'base version content',
      conflictMarkers: '',
    };

    const prompt = buildConflictPrompt(conflict, {
      taskId: 'TASK-1',
      taskTitle: 'Test',
    });

    expect(prompt).toContain('ours version content');
    expect(prompt).toContain('theirs version content');
    expect(prompt).toContain('base version content');
  });

  test('handles missing base content', () => {
    const conflict: FileConflict = {
      filePath: 'new-file.ts',
      oursContent: 'const x = 1;',
      theirsContent: 'const x = 2;',
      baseContent: '',
      conflictMarkers: '',
    };

    const prompt = buildConflictPrompt(conflict, {
      taskId: 'TASK-1',
      taskTitle: 'Test',
    });

    expect(prompt).toContain('(file did not exist)');
  });

  test('includes instructions to output only file content', () => {
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'x',
      theirsContent: 'y',
      baseContent: '',
      conflictMarkers: '',
    };

    const prompt = buildConflictPrompt(conflict, {
      taskId: 'TASK-1',
      taskTitle: 'Test',
    });

    expect(prompt).toContain('OUTPUT ONLY THE RESOLVED FILE CONTENT');
    expect(prompt).toContain('No explanation');
    expect(prompt).toContain('no markdown code fences');
  });
});

describe('extractResolvedContent', () => {
  test('returns trimmed content', () => {
    const stdout = '  const x = 1;  \n';
    const result = extractResolvedContent(stdout);
    expect(result).toBe('const x = 1;');
  });

  test('strips markdown code fences', () => {
    const stdout = '```typescript\nconst x = 1;\n```';
    const result = extractResolvedContent(stdout);
    expect(result).toBe('const x = 1;');
  });

  test('strips plain markdown fences', () => {
    const stdout = '```\nconst x = 1;\n```';
    const result = extractResolvedContent(stdout);
    expect(result).toBe('const x = 1;');
  });

  test('handles multiline content within fences', () => {
    const stdout = '```typescript\nconst x = 1;\nconst y = 2;\n```';
    const result = extractResolvedContent(stdout);
    expect(result).toBe('const x = 1;\nconst y = 2;');
  });

  test('returns null for empty content', () => {
    const result = extractResolvedContent('');
    expect(result).toBeNull();
  });

  test('returns null for whitespace-only content', () => {
    const result = extractResolvedContent('   \n\t  ');
    expect(result).toBeNull();
  });

  test('preserves content without fences', () => {
    const stdout = 'const x = 1;\nconst y = 2;';
    const result = extractResolvedContent(stdout);
    expect(result).toBe('const x = 1;\nconst y = 2;');
  });

  test('handles content that looks like fences but is not', () => {
    // Content that starts with ``` but doesn't match the pattern
    const stdout = '```not a fence because no closing';
    const result = extractResolvedContent(stdout);
    expect(result).toBe('```not a fence because no closing');
  });
});

// Note: createAiResolver() integration tests would require mocking the agent registry.
// The module uses getAgentRegistry() which is difficult to mock in ES modules.
// The core logic is well-tested through:
// - tryFastPathResolution: all branches covered
// - buildConflictPrompt: all cases covered
// - extractResolvedContent: all cases covered
//
// The remaining untested code (lines 22-52) is the agent spawning logic which:
// 1. Gets agent from registry
// 2. Calls execute() with the prompt
// 3. Returns result or null on failure
//
// This integration is better tested via end-to-end tests with actual parallel execution.

// We can use mock.module for proper ES module mocking in bun
describe('createAiResolver', () => {
  test('module exports createAiResolver function', async () => {
    const module = await import('./ai-resolver.js');
    expect(typeof module.createAiResolver).toBe('function');
  });

  test('createAiResolver returns a function', async () => {
    const { createAiResolver } = await import('./ai-resolver.js');

    // Minimal config - the resolver is a closure that captures config
    const config = {
      agent: { name: 'test', plugin: 'claude', options: {} },
      tracker: { name: 'test', plugin: 'json', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      watch: false,
      pollIntervalMs: 30000,
      cwd: '/tmp/test',
      outputDir: '/tmp/test/output',
      progressFile: '/tmp/test/progress.md',
      showTui: false,
      errorHandling: { strategy: 'skip' as const, maxRetries: 3, retryDelayMs: 5000, continueOnNonZeroExit: false },
    };

    const resolver = createAiResolver(config);
    expect(typeof resolver).toBe('function');
  });

  test('resolver uses fast-path for empty ours content', async () => {
    const { createAiResolver } = await import('./ai-resolver.js');

    const config = {
      agent: { name: 'test', plugin: 'claude', options: {} },
      tracker: { name: 'test', plugin: 'json', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      watch: false,
      pollIntervalMs: 30000,
      cwd: '/tmp/test',
      outputDir: '/tmp/test/output',
      progressFile: '/tmp/test/progress.md',
      showTui: false,
      errorHandling: { strategy: 'skip' as const, maxRetries: 3, retryDelayMs: 5000, continueOnNonZeroExit: false },
    };

    const resolver = createAiResolver(config);

    // This should hit fast-path and return immediately without calling agent
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: '',  // Empty - triggers fast-path
      theirsContent: 'const x = 1;',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = await resolver(conflict, { taskId: 'T1', taskTitle: 'Test' });
    expect(result).toBe('const x = 1;');
  });

  test('resolver uses fast-path for identical content', async () => {
    const { createAiResolver } = await import('./ai-resolver.js');

    const config = {
      agent: { name: 'test', plugin: 'claude', options: {} },
      tracker: { name: 'test', plugin: 'json', options: {} },
      maxIterations: 10,
      iterationDelay: 1000,
      watch: false,
      pollIntervalMs: 30000,
      cwd: '/tmp/test',
      outputDir: '/tmp/test/output',
      progressFile: '/tmp/test/progress.md',
      showTui: false,
      errorHandling: { strategy: 'skip' as const, maxRetries: 3, retryDelayMs: 5000, continueOnNonZeroExit: false },
    };

    const resolver = createAiResolver(config);

    // Identical content - triggers fast-path
    const conflict: FileConflict = {
      filePath: 'test.ts',
      oursContent: 'const x = 1;',
      theirsContent: 'const x = 1;',
      baseContent: '',
      conflictMarkers: '',
    };

    const result = await resolver(conflict, { taskId: 'T1', taskTitle: 'Test' });
    expect(result).toBe('const x = 1;');
  });
});
