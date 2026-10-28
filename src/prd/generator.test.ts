/**
 * ABOUTME: Tests for the PRD generator module.
 * Tests convertToPrdJson function with sourcePrd parameter.
 */

import { describe, test, expect } from 'bun:test';
import { convertToPrdJson } from './generator.js';
import type { GeneratedPrd } from './types.js';

describe('convertToPrdJson', () => {
  // Helper to create a minimal GeneratedPrd with all required fields
  function createTestPrd(overrides: Partial<GeneratedPrd> = {}): GeneratedPrd {
    return {
      name: 'Test Feature',
      slug: 'test-feature',
      description: 'A test feature description',
      targetUsers: 'Developers',
      problemStatement: 'Need better testing',
      solution: 'Add comprehensive tests',
      successMetrics: 'All tests pass',
      constraints: 'Must be fast',
      branchName: 'feature/test',
      createdAt: '2026-01-20T00:00:00.000Z',
      userStories: [
        {
          id: 'US-001',
          title: 'Test Story',
          description: 'Story description',
          acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
          priority: 2,
        },
      ],
      ...overrides,
    };
  }

  test('generates valid prd.json without sourcePrd', () => {
    const prd = createTestPrd();
    const result = convertToPrdJson(prd) as Record<string, unknown>;

    expect(result.name).toBe('Test Feature');
    expect(result.description).toBe('A test feature description');
    expect(result.branchName).toBe('feature/test');
    expect((result.metadata as Record<string, unknown>).version).toBe('1.0.0');
    expect((result.metadata as Record<string, unknown>).createdAt).toBe('2026-01-20T00:00:00.000Z');
    // sourcePrd should NOT be present
    expect((result.metadata as Record<string, unknown>).sourcePrd).toBeUndefined();
  });

  test('includes sourcePrd in metadata when provided', () => {
    const prd = createTestPrd();
    const result = convertToPrdJson(prd, './tasks/my-feature.md') as Record<string, unknown>;

    expect((result.metadata as Record<string, unknown>).sourcePrd).toBe('./tasks/my-feature.md');
  });

  test('handles relative path for sourcePrd', () => {
    const prd = createTestPrd();
    const result = convertToPrdJson(prd, 'my-feature.md') as Record<string, unknown>;

    expect((result.metadata as Record<string, unknown>).sourcePrd).toBe('my-feature.md');
  });

  test('handles absolute path for sourcePrd', () => {
    const prd = createTestPrd();
    const result = convertToPrdJson(prd, '/home/user/project/tasks/prd.md') as Record<string, unknown>;

    expect((result.metadata as Record<string, unknown>).sourcePrd).toBe('/home/user/project/tasks/prd.md');
  });

  test('does not include sourcePrd when empty string provided', () => {
    const prd = createTestPrd();
    const result = convertToPrdJson(prd, '') as Record<string, unknown>;

    // Empty string is falsy, so sourcePrd should not be included
    expect((result.metadata as Record<string, unknown>).sourcePrd).toBeUndefined();
  });

  test('converts user stories correctly', () => {
    const prd = createTestPrd({
      userStories: [
        {
          id: 'US-001',
          title: 'First Story',
          description: 'First description',
          acceptanceCriteria: ['AC1'],
          priority: 1,
          labels: ['frontend'],
          dependsOn: [],
        },
        {
          id: 'US-002',
          title: 'Second Story',
          description: 'Second description',
          acceptanceCriteria: ['AC2', 'AC3'],
          priority: 2,
          labels: ['backend'],
          dependsOn: ['US-001'],
        },
      ],
    });

    const result = convertToPrdJson(prd, './prd.md') as Record<string, unknown>;
    const stories = result.userStories as Array<Record<string, unknown>>;

    expect(stories).toHaveLength(2);

    expect(stories[0]!.id).toBe('US-001');
    expect(stories[0]!.title).toBe('First Story');
    expect(stories[0]!.priority).toBe(1);
    expect(stories[0]!.labels).toEqual(['frontend']);
    expect(stories[0]!.dependsOn).toEqual([]);
    expect(stories[0]!.passes).toBe(false);

    expect(stories[1]!.id).toBe('US-002');
    expect(stories[1]!.dependsOn).toEqual(['US-001']);
  });
});
