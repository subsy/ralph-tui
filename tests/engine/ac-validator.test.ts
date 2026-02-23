/**
 * ABOUTME: Tests for the AC validator — parsing acceptance criteria into executable assertions.
 * Covers command extraction, file existence checks, graceful skipping, and edge cases.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseExecutableCriteria,
  acToVerificationCommands,
  getAcVerificationCommands,
} from '../../src/engine/ac-validator';

describe('parseExecutableCriteria', () => {
  it('extracts backtick command: "Running `bun test` passes" → type command, assertion "bun test"', () => {
    const result = parseExecutableCriteria(['Running `bun test` passes']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('command');
    expect(result[0].assertion).toBe('bun test');
    expect(result[0].original).toBe('Running `bun test` passes');
  });

  it('extracts file existence: "Tests exist in src/__tests__/" → type file-exists', () => {
    const result = parseExecutableCriteria(['Tests exist in src/__tests__/']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('file-exists');
    expect(result[0].assertion).toBe('src/__tests__/');
  });

  it('skips non-executable criteria gracefully', () => {
    const result = parseExecutableCriteria(['UI looks correct', 'The button is blue']);
    expect(result).toHaveLength(0);
  });

  it('returns only executable ones from mixed criteria', () => {
    const criteria = [
      'UI looks correct',
      'Running `bun run typecheck` passes',
      'The colors match the design',
      'File created at src/foo.ts',
    ];
    const result = parseExecutableCriteria(criteria);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('command');
    expect(result[0].assertion).toBe('bun run typecheck');
    expect(result[1].type).toBe('file-exists');
    expect(result[1].assertion).toBe('src/foo.ts');
  });

  it('returns empty array for empty criteria input', () => {
    expect(parseExecutableCriteria([])).toHaveLength(0);
  });

  it('extracts bun run command from backtick-wrapped text', () => {
    const result = parseExecutableCriteria(['`bun run build` exits with 0']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('command');
    expect(result[0].assertion).toBe('bun run build');
  });

  it('skips backtick content that does not look like a command', () => {
    const result = parseExecutableCriteria(['The `blue` button is visible']);
    expect(result).toHaveLength(0);
  });

  it('extracts file existence with "present at" pattern', () => {
    const result = parseExecutableCriteria(['Config present at /etc/app.conf']);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('file-exists');
    expect(result[0].assertion).toBe('/etc/app.conf');
  });
});

describe('acToVerificationCommands', () => {
  it('converts command type to raw command string', () => {
    const acs = [{ original: '', type: 'command' as const, assertion: 'bun test' }];
    expect(acToVerificationCommands(acs)).toEqual(['bun test']);
  });

  it('converts file-exists type to test -e shell command', () => {
    const acs = [{ original: '', type: 'file-exists' as const, assertion: 'src/__tests__/' }];
    expect(acToVerificationCommands(acs)).toEqual(['test -e "src/__tests__/"']);
  });

  it('filters out empty strings', () => {
    const acs = [{ original: '', type: 'command' as const, assertion: '' }];
    expect(acToVerificationCommands(acs)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(acToVerificationCommands([])).toHaveLength(0);
  });
});

describe('getAcVerificationCommands', () => {
  it('returns empty array when metadata is undefined', () => {
    expect(getAcVerificationCommands(undefined)).toHaveLength(0);
  });

  it('returns empty array when acceptanceCriteria is missing from metadata', () => {
    expect(getAcVerificationCommands({ notes: 'done' })).toHaveLength(0);
  });

  it('returns empty array when acceptanceCriteria is not an array', () => {
    expect(getAcVerificationCommands({ acceptanceCriteria: 'not an array' })).toHaveLength(0);
  });

  it('extracts commands from metadata acceptanceCriteria', () => {
    const metadata = {
      acceptanceCriteria: ['Running `bun test` passes', 'UI looks correct'],
    };
    const result = getAcVerificationCommands(metadata);
    expect(result).toEqual(['bun test']);
  });

  it('filters out non-string items in acceptanceCriteria array', () => {
    const metadata = {
      acceptanceCriteria: ['Running `bun test` passes', 42, null, 'UI looks nice'],
    };
    const result = getAcVerificationCommands(metadata);
    expect(result).toEqual(['bun test']);
  });
});
