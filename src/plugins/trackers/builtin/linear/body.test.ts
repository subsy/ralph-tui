/**
 * ABOUTME: Unit tests for the Linear story issue body builder and parser.
 * Covers building structured markdown, parsing metadata, description, and
 * acceptance criteria, including edge cases and malformed input.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildStoryIssueBody,
  parseStoryIssueBody,
  parseRalphPriority,
  parseStoryId,
  parseAcceptanceCriteria,
  DEFAULT_RALPH_PRIORITY,
} from './body.js';

describe('buildStoryIssueBody', () => {
  test('builds well-formed markdown with all sections', () => {
    const body = buildStoryIssueBody({
      storyId: 'US-001',
      ralphPriority: 2,
      description: 'Implement the login flow.',
      acceptanceCriteria: ['User can enter email', 'User can enter password'],
    });

    expect(body).toContain('## Ralph Metadata');
    expect(body).toContain('**Story ID:** US-001');
    expect(body).toContain('**Ralph Priority:** 2');
    expect(body).toContain('## Description');
    expect(body).toContain('Implement the login flow.');
    expect(body).toContain('## Acceptance Criteria');
    expect(body).toContain('- [ ] User can enter email');
    expect(body).toContain('- [ ] User can enter password');
  });

  test('handles empty acceptance criteria with placeholder text', () => {
    const body = buildStoryIssueBody({
      storyId: 'US-002',
      ralphPriority: 1,
      description: 'A task with no AC.',
      acceptanceCriteria: [],
    });

    expect(body).toContain('*No acceptance criteria defined.*');
    expect(body).not.toContain('- [ ]');
  });

  test('handles high priority values (unbounded)', () => {
    const body = buildStoryIssueBody({
      storyId: 'US-100',
      ralphPriority: 42,
      description: 'Low priority task.',
      acceptanceCriteria: ['Done when done'],
    });

    expect(body).toContain('**Ralph Priority:** 42');
  });

  test('roundtrip: build then parse produces original values', () => {
    const params = {
      storyId: 'US-007',
      ralphPriority: 3,
      description: 'Test roundtrip behavior.',
      acceptanceCriteria: ['First', 'Second', 'Third'],
    };

    const body = buildStoryIssueBody(params);
    const parsed = parseStoryIssueBody(body);

    expect(parsed.storyId).toBe(params.storyId);
    expect(parsed.ralphPriority).toBe(params.ralphPriority);
    expect(parsed.description).toBe(params.description);
    expect(parsed.acceptanceCriteria).toEqual(params.acceptanceCriteria);
  });
});

describe('parseRalphPriority', () => {
  test('extracts priority from standard format', () => {
    expect(parseRalphPriority('- **Ralph Priority:** 2')).toBe(2);
  });

  test('extracts priority from plain format', () => {
    expect(parseRalphPriority('Ralph Priority: 5')).toBe(5);
  });

  test('extracts high unbounded priority', () => {
    expect(parseRalphPriority('- **Ralph Priority:** 99')).toBe(99);
  });

  test('returns default for missing priority', () => {
    expect(parseRalphPriority('No priority here')).toBe(DEFAULT_RALPH_PRIORITY);
  });

  test('returns default for empty string', () => {
    expect(parseRalphPriority('')).toBe(DEFAULT_RALPH_PRIORITY);
  });

  test('returns default for non-numeric priority', () => {
    expect(parseRalphPriority('Ralph Priority: high')).toBe(DEFAULT_RALPH_PRIORITY);
  });

  test('handles case-insensitive matching', () => {
    expect(parseRalphPriority('ralph priority: 4')).toBe(4);
    expect(parseRalphPriority('RALPH PRIORITY: 1')).toBe(1);
  });
});

describe('parseStoryId', () => {
  test('extracts story ID from standard format', () => {
    expect(parseStoryId('- **Story ID:** US-001')).toBe('US-001');
  });

  test('extracts story ID from plain format', () => {
    expect(parseStoryId('Story ID: US-042')).toBe('US-042');
  });

  test('returns undefined for missing story ID', () => {
    expect(parseStoryId('No relevant metadata here')).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(parseStoryId('')).toBeUndefined();
  });

  test('trims trailing bold markers', () => {
    expect(parseStoryId('- **Story ID:** US-003**')).toBe('US-003');
  });

  test('handles case-insensitive matching', () => {
    expect(parseStoryId('story id: US-010')).toBe('US-010');
  });
});

describe('parseAcceptanceCriteria', () => {
  test('extracts unchecked items', () => {
    const section = '- [ ] First criterion\n- [ ] Second criterion';
    expect(parseAcceptanceCriteria(section)).toEqual(['First criterion', 'Second criterion']);
  });

  test('extracts checked items', () => {
    const section = '- [x] Done item\n- [X] Also done';
    expect(parseAcceptanceCriteria(section)).toEqual(['Done item', 'Also done']);
  });

  test('extracts mixed checked and unchecked', () => {
    const section = '- [x] Completed\n- [ ] Pending\n- [X] Also done';
    expect(parseAcceptanceCriteria(section)).toEqual(['Completed', 'Pending', 'Also done']);
  });

  test('ignores non-checkbox lines', () => {
    const section = 'Some text\n- [ ] Real criterion\nMore text';
    expect(parseAcceptanceCriteria(section)).toEqual(['Real criterion']);
  });

  test('returns empty array for no checkboxes', () => {
    expect(parseAcceptanceCriteria('No acceptance criteria defined.')).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(parseAcceptanceCriteria('')).toEqual([]);
  });

  test('trims whitespace from items', () => {
    const section = '- [ ]   Spaced criterion  ';
    expect(parseAcceptanceCriteria(section)).toEqual(['Spaced criterion']);
  });
});

describe('parseStoryIssueBody', () => {
  test('parses well-formed body with all sections', () => {
    const body = [
      '## Ralph Metadata',
      '- **Story ID:** US-005',
      '- **Ralph Priority:** 1',
      '',
      '## Description',
      'Implement user authentication.',
      '',
      '## Acceptance Criteria',
      '- [ ] Login works',
      '- [ ] Logout works',
    ].join('\n');

    const parsed = parseStoryIssueBody(body);
    expect(parsed.storyId).toBe('US-005');
    expect(parsed.ralphPriority).toBe(1);
    expect(parsed.description).toBe('Implement user authentication.');
    expect(parsed.acceptanceCriteria).toEqual(['Login works', 'Logout works']);
  });

  test('handles missing Ralph Metadata section', () => {
    const body = [
      '## Description',
      'Some description.',
      '',
      '## Acceptance Criteria',
      '- [ ] A criterion',
    ].join('\n');

    const parsed = parseStoryIssueBody(body);
    expect(parsed.storyId).toBeUndefined();
    expect(parsed.ralphPriority).toBe(DEFAULT_RALPH_PRIORITY);
    expect(parsed.description).toBe('Some description.');
    expect(parsed.acceptanceCriteria).toEqual(['A criterion']);
  });

  test('handles missing Description section', () => {
    const body = [
      '## Ralph Metadata',
      '- **Story ID:** US-010',
      '- **Ralph Priority:** 2',
      '',
      '## Acceptance Criteria',
      '- [ ] Something',
    ].join('\n');

    const parsed = parseStoryIssueBody(body);
    expect(parsed.storyId).toBe('US-010');
    expect(parsed.ralphPriority).toBe(2);
    expect(parsed.description).toBe('');
    expect(parsed.acceptanceCriteria).toEqual(['Something']);
  });

  test('handles missing Acceptance Criteria section', () => {
    const body = [
      '## Ralph Metadata',
      '- **Story ID:** US-011',
      '- **Ralph Priority:** 3',
      '',
      '## Description',
      'Just a description.',
    ].join('\n');

    const parsed = parseStoryIssueBody(body);
    expect(parsed.storyId).toBe('US-011');
    expect(parsed.description).toBe('Just a description.');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });

  test('handles empty body', () => {
    const parsed = parseStoryIssueBody('');
    expect(parsed.storyId).toBeUndefined();
    expect(parsed.ralphPriority).toBe(DEFAULT_RALPH_PRIORITY);
    expect(parsed.description).toBe('');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });

  test('handles whitespace-only body', () => {
    const parsed = parseStoryIssueBody('   \n  \n  ');
    expect(parsed.storyId).toBeUndefined();
    expect(parsed.ralphPriority).toBe(DEFAULT_RALPH_PRIORITY);
    expect(parsed.description).toBe('');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });

  test('handles body with no recognized sections', () => {
    const parsed = parseStoryIssueBody('Just some random text with no headings.');
    expect(parsed.storyId).toBeUndefined();
    expect(parsed.ralphPriority).toBe(DEFAULT_RALPH_PRIORITY);
    expect(parsed.description).toBe('');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });

  test('handles multiline description', () => {
    const body = [
      '## Ralph Metadata',
      '- **Story ID:** US-020',
      '- **Ralph Priority:** 2',
      '',
      '## Description',
      'First line of description.',
      'Second line of description.',
      '',
      'Third paragraph.',
      '',
      '## Acceptance Criteria',
      '- [ ] Done',
    ].join('\n');

    const parsed = parseStoryIssueBody(body);
    expect(parsed.description).toContain('First line of description.');
    expect(parsed.description).toContain('Second line of description.');
    expect(parsed.description).toContain('Third paragraph.');
  });
});

describe('DEFAULT_RALPH_PRIORITY', () => {
  test('is 3 (medium)', () => {
    expect(DEFAULT_RALPH_PRIORITY).toBe(3);
  });
});
