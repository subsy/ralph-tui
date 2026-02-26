/**
 * ABOUTME: Unit tests for convert command argument parsing and Linear conversion logic.
 * Covers Linear-specific argument validation, format support, and parent resolution modes.
 */

import { describe, expect, test } from 'bun:test';
import { parseConvertArgs } from './convert.js';

describe('parseConvertArgs', () => {
  describe('format support', () => {
    test('accepts --to json', () => {
      const result = parseConvertArgs(['--to', 'json', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.to).toBe('json');
    });

    test('accepts --to beads', () => {
      const result = parseConvertArgs(['--to', 'beads', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.to).toBe('beads');
    });

    test('accepts --to linear', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.to).toBe('linear');
    });

    test('rejects unsupported format', () => {
      const result = parseConvertArgs(['--to', 'jira', 'input.md']);
      expect(result).toBeNull();
    });

    test('accepts -t shorthand for format', () => {
      const result = parseConvertArgs(['-t', 'json', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.to).toBe('json');
    });
  });

  describe('required arguments', () => {
    test('requires --to flag', () => {
      const result = parseConvertArgs(['input.md']);
      expect(result).toBeNull();
    });

    test('requires input file', () => {
      const result = parseConvertArgs(['--to', 'json']);
      expect(result).toBeNull();
    });
  });

  describe('Linear-specific options', () => {
    test('--team is required for linear format', () => {
      const result = parseConvertArgs(['--to', 'linear', 'input.md']);
      expect(result).toBeNull();
    });

    test('accepts --team flag', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.team).toBe('ENG');
    });

    test('accepts --project flag', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', '--project', 'Q1 Sprint', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.project).toBe('Q1 Sprint');
    });

    test('accepts --parent flag with issue key', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', '--parent', 'ENG-123', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.parent).toBe('ENG-123');
    });

    test('accepts --parent flag with UUID', () => {
      const result = parseConvertArgs([
        '--to', 'linear', '--team', 'ENG',
        '--parent', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'input.md',
      ]);
      expect(result).not.toBeNull();
      expect(result!.parent).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    test('--team not required for non-linear formats', () => {
      const result = parseConvertArgs(['--to', 'json', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.team).toBeUndefined();
    });

    test('accepts all Linear options together', () => {
      const result = parseConvertArgs([
        '--to', 'linear',
        '--team', 'ENG',
        '--project', 'Sprint 1',
        '--parent', 'ENG-42',
        '--labels', 'backend,mvp',
        '--verbose',
        'prd.md',
      ]);
      expect(result).not.toBeNull();
      expect(result!.to).toBe('linear');
      expect(result!.team).toBe('ENG');
      expect(result!.project).toBe('Sprint 1');
      expect(result!.parent).toBe('ENG-42');
      expect(result!.labels).toEqual(['backend', 'mvp']);
      expect(result!.verbose).toBe(true);
      expect(result!.input).toBe('prd.md');
    });
  });

  describe('common options', () => {
    test('parses --labels as comma-separated list', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', '--labels', 'a,b,c', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.labels).toEqual(['a', 'b', 'c']);
    });

    test('trims whitespace from labels', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', '--labels', ' a , b ', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.labels).toEqual(['a', 'b']);
    });

    test('filters empty labels', () => {
      const result = parseConvertArgs(['--to', 'linear', '--team', 'ENG', '--labels', 'a,,b', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.labels).toEqual(['a', 'b']);
    });

    test('parses --force flag', () => {
      const result = parseConvertArgs(['--to', 'json', '--force', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.force).toBe(true);
    });

    test('parses --verbose flag', () => {
      const result = parseConvertArgs(['--to', 'json', '--verbose', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.verbose).toBe(true);
    });

    test('parses -f shorthand for force', () => {
      const result = parseConvertArgs(['-t', 'json', '-f', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.force).toBe(true);
    });

    test('parses -v shorthand for verbose', () => {
      const result = parseConvertArgs(['-t', 'json', '-v', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.verbose).toBe(true);
    });

    test('parses --output flag', () => {
      const result = parseConvertArgs(['--to', 'json', '--output', 'out.json', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.output).toBe('out.json');
    });

    test('parses --branch flag', () => {
      const result = parseConvertArgs(['--to', 'json', '--branch', 'feature/test', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.branch).toBe('feature/test');
    });

    test('positional argument is the input file', () => {
      const result = parseConvertArgs(['--to', 'json', 'my-prd.md']);
      expect(result).not.toBeNull();
      expect(result!.input).toBe('my-prd.md');
    });

    test('defaults for optional flags', () => {
      const result = parseConvertArgs(['--to', 'json', 'input.md']);
      expect(result).not.toBeNull();
      expect(result!.force).toBe(false);
      expect(result!.verbose).toBe(false);
      expect(result!.output).toBeUndefined();
      expect(result!.branch).toBeUndefined();
      expect(result!.labels).toBeUndefined();
      expect(result!.project).toBeUndefined();
      expect(result!.parent).toBeUndefined();
    });
  });
});
