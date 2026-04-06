/**
 * ABOUTME: Tests for the ADF to Markdown converter.
 * Covers common ADF node types and edge cases.
 */

import { describe, expect, it } from 'bun:test';
import { adfToMarkdown, textToAdf, buildCompletionAdf } from './adf.js';
import type { AdfDocument } from './types.js';

describe('adfToMarkdown', () => {
  it('returns empty string for null input', () => {
    expect(adfToMarkdown(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(adfToMarkdown(undefined)).toBe('');
  });

  it('converts a simple paragraph', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toBe('Hello world');
  });

  it('converts headings at various levels', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Subtitle' }],
        },
      ],
    };
    const result = adfToMarkdown(doc);
    expect(result).toContain('# Title');
    expect(result).toContain('### Subtitle');
  });

  it('converts bold and italic text marks', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
          ],
        },
      ],
    };
    const result = adfToMarkdown(doc);
    expect(result).toContain('**bold**');
    expect(result).toContain('*italic*');
  });

  it('converts inline code marks', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Run ' },
            { type: 'text', text: 'npm install', marks: [{ type: 'code' }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toContain('`npm install`');
  });

  it('converts links', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Click here',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toContain('[Click here](https://example.com)');
  });

  it('converts bullet lists', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
            },
          ],
        },
      ],
    };
    const result = adfToMarkdown(doc);
    expect(result).toContain('- First');
    expect(result).toContain('- Second');
  });

  it('converts ordered lists', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step two' }] }],
            },
          ],
        },
      ],
    };
    const result = adfToMarkdown(doc);
    expect(result).toContain('1. Step one');
    expect(result).toContain('2. Step two');
  });

  it('converts code blocks with language', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    };
    const result = adfToMarkdown(doc);
    expect(result).toContain('```typescript');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('```');
  });

  it('converts blockquotes', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'A wise quote' }] },
          ],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toContain('> A wise quote');
  });

  it('converts horizontal rules', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [{ type: 'rule' }],
    };
    expect(adfToMarkdown(doc)).toContain('---');
  });

  it('converts mentions', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Assigned to ' },
            { type: 'mention', attrs: { text: '@jeremy' } },
          ],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toContain('@jeremy');
  });

  it('converts tables', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foo' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bar' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const result = adfToMarkdown(doc);
    expect(result).toContain('| Name | Value |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| foo | bar |');
  });

  it('gracefully handles unknown node types', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'unknownNode' as string,
          content: [{ type: 'text', text: 'fallback content' }],
        },
      ],
    };
    // Should not throw, and should render children
    expect(adfToMarkdown(doc)).toContain('fallback content');
  });

  it('handles empty document', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [],
    };
    expect(adfToMarkdown(doc)).toBe('');
  });
});

describe('textToAdf', () => {
  it('wraps text in a minimal ADF document', () => {
    const result = textToAdf('Hello world');
    expect(result.version).toBe(1);
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('paragraph');
    expect(result.content[0]?.content?.[0]?.text).toBe('Hello world');
  });
});

describe('buildCompletionAdf', () => {
  it('builds a basic completion comment', () => {
    const result = buildCompletionAdf({
      taskId: 'TEST-1',
      taskTitle: 'Test task',
    });
    expect(result.version).toBe(1);
    expect(result.type).toBe('doc');
    // Should have at least the success panel
    expect(result.content.length).toBeGreaterThanOrEqual(1);
    expect(result.content[0]?.type).toBe('panel');
  });

  it('includes acceptance criteria as a checklist', () => {
    const result = buildCompletionAdf({
      taskId: 'TEST-1',
      taskTitle: 'Test task',
      acceptanceCriteria: ['Criterion A', 'Criterion B'],
    });
    const json = JSON.stringify(result);
    expect(json).toContain('Acceptance Criteria');
    expect(json).toContain('Criterion A');
    expect(json).toContain('Criterion B');
  });

  it('includes reason when provided', () => {
    const result = buildCompletionAdf({
      taskId: 'TEST-1',
      taskTitle: 'Test task',
      reason: 'All tests passing',
    });
    const json = JSON.stringify(result);
    expect(json).toContain('All tests passing');
  });

  it('skips generic reason', () => {
    const result = buildCompletionAdf({
      taskId: 'TEST-1',
      taskTitle: 'Test task',
      reason: 'Completed by agent',
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('Completed by agent');
  });

  it('includes duration', () => {
    const result = buildCompletionAdf({
      taskId: 'TEST-1',
      taskTitle: 'Test task',
      durationMs: 90000,
    });
    const json = JSON.stringify(result);
    expect(json).toContain('1m 30s');
  });

  it('formats duration in seconds for short tasks', () => {
    const result = buildCompletionAdf({
      taskId: 'TEST-1',
      taskTitle: 'Test task',
      durationMs: 15000,
    });
    const json = JSON.stringify(result);
    expect(json).toContain('15s');
  });
});
