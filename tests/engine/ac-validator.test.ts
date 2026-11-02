/**
 * ABOUTME: Tests for the AC validator — parsing acceptance criteria into executable assertions.
 * Covers command extraction, file existence checks, graceful skipping, and edge cases.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseExecutableCriteria,
  acToVerificationCommands,
  getAcVerificationCommands,
  getAcVerificationChecks,
} from '../../src/engine/ac-validator';

describe('parseExecutableCriteria', () => {
  it.each([
    ['verified.txt exists', 'verified.txt'],
    ["File 'verified.txt missing' exists", 'verified.txt missing'],
    ['"verified file.txt" is created', 'verified file.txt'],
    ['`node imaginary.cjs` is present', 'node imaginary.cjs'],
  ])('parses path-before-existence syntax: %s', (criterion, path) => {
    expect(parseExecutableCriteria([criterion])).toEqual([
      { original: criterion, type: 'file-exists', assertion: path },
    ]);
  });

  it.each(['No files exist in output/', 'Files must not exist in output/', 'Files are not present at output/'])('does not reverse negated criteria: %s', criterion => {
    expect(parseExecutableCriteria([criterion])).toEqual([]);
  });

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

  it.skipIf(process.platform === 'win32').each(["'", '"', '`'])('checks the full %s-quoted filename rather than an existing prefix', (quote) => {
    const cwd = mkdtempSync(join(tmpdir(), 'ralph-ac-path-'));
    try {
      writeFileSync(join(cwd, 'verified.txt'), 'prefix only');
      const missing = `Tests exist in ${quote}verified.txt missing${quote}`;
      const commands = getAcVerificationCommands({ acceptanceCriteria: [missing] });
      expect(commands).toEqual(["test -e 'verified.txt missing'"]);
      expect(spawnSync('sh', ['-c', commands[0]], { cwd }).status).toBe(1);

      writeFileSync(join(cwd, 'verified file.txt'), 'full path');
      const present = `Tests exist in ${quote}verified file.txt${quote}`;
      const checks = getAcVerificationCommands({ acceptanceCriteria: [present] });
      expect(checks).toEqual(["test -e 'verified file.txt'"]);
      expect(spawnSync('sh', ['-c', checks[0]], { cwd }).status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(["'", '"', '`'])('treats a %s-quoted command-looking filename as a literal file assertion', (quote) => {
    expect(getAcVerificationCommands({
      acceptanceCriteria: [`Files exist at ${quote}node imaginary.cjs${quote}`],
    })).toEqual(["test -e 'node imaginary.cjs'"]);
  });

  it('preserves commands that mention file assertion wording in their arguments', () => {
    const command = 'node check.cjs --message "Files exist at sample.txt"';
    expect(parseExecutableCriteria([`Running \`${command}\` passes`])).toEqual([
      { original: `Running \`${command}\` passes`, type: 'command', assertion: command },
    ]);
  });
});

describe('acToVerificationCommands', () => {
  it('converts command type to raw command string', () => {
    const acs = [{ original: '', type: 'command' as const, assertion: 'bun test' }];
    expect(acToVerificationCommands(acs, true)).toEqual(['bun test']);
  });

  it('converts file-exists type to test -e shell command', () => {
    const acs = [{ original: '', type: 'file-exists' as const, assertion: 'src/__tests__/' }];
    expect(acToVerificationCommands(acs)).toEqual(["test -e 'src/__tests__/'"]);
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
    const result = getAcVerificationCommands(metadata, true);
    expect(result).toEqual(['bun test']);
  });

  it('filters out non-string items in acceptanceCriteria array', () => {
    const metadata = {
      acceptanceCriteria: ['Running `bun test` passes', 42, null, 'UI looks nice'],
    };
    const result = getAcVerificationCommands(metadata, true);
    expect(result).toEqual(['bun test']);
  });
});

describe('acToVerificationCommands - security', () => {
  it.each(['\n', '\r', '\r\n', '\0'])('rejects command control separator %j', (separator) => {
    const assertion = `bun test${separator}touch unexpected-file`;
    expect(acToVerificationCommands([{ original: '', type: 'command', assertion }], true)).toEqual([]);
    expect(getAcVerificationCommands({
      acceptanceCriteria: [`Running \`${assertion}\` passes`],
    }, true)).toEqual([]);
  });

  it('does not emit a file-contains command without a target file', () => {
    expect(acToVerificationCommands([
      { original: '', type: 'file-contains', assertion: 'expected text' },
    ])).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('checks shell-looking filenames literally without executing their contents', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ralph-ac-'));
    try {
      const filename = "file'$(touch unexpected-file);\nname";
      writeFileSync(join(cwd, filename), 'fixture');
      const commands = acToVerificationCommands([
        { original: '', type: 'file-exists', assertion: filename },
      ]);
      expect(commands).toHaveLength(1);
      const result = spawnSync('sh', ['-c', commands[0]], { cwd, env: { PATH: process.env.PATH } });
      expect(result.status).toBe(0);
      expect(existsSync(join(cwd, 'unexpected-file'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects commands containing shell metacharacters (injection prevention)', () => {
    const acs = [
      { original: '', type: 'command' as const, assertion: 'bun test; rm -rf /' },
      { original: '', type: 'command' as const, assertion: 'bun test && evil' },
      { original: '', type: 'command' as const, assertion: 'bun test | tee /dev/null' },
      { original: '', type: 'command' as const, assertion: 'bun test' }, // safe
    ];
    const result = acToVerificationCommands(acs, true);
    expect(result).toEqual(['bun test']); // only the safe command passes through
  });
});

describe('acceptance criteria trust boundary', () => {
  it('keeps literal paths structured and only opted-in safe commands executable', () => {
    const metadata = { acceptanceCriteria: [
      'File "verified file.txt" exists', '`node trusted.cjs`', '`bun test; echo injected`',
    ] };
    expect(getAcVerificationChecks(metadata)).toEqual({ files: ['verified file.txt'], commands: [] });
    expect(getAcVerificationChecks(metadata, true)).toEqual({ files: ['verified file.txt'], commands: ['node trusted.cjs'] });
  });

  it.each([undefined, false, 'true', 'false', 1, {}, []].map(trust => ({ trust })))('rejects commands without boolean true: %j', ({ trust }) => {
    const metadata = { acceptanceCriteria: [
      '`curl https://example.invalid/`', '`git clean -fd`', '`npm install example`',
      'Files exist at literal-file',
    ] };
    expect(getAcVerificationCommands(metadata, trust as boolean)).toEqual(["test -e 'literal-file'"]);
  });

  it('requires opt-in even for commands with no shell metacharacters', () => {
    const acs = [{ original: '', type: 'command' as const, assertion: 'node untrusted.js' }];
    expect(acToVerificationCommands(acs)).toEqual([]);
    expect(acToVerificationCommands(acs, true)).toEqual(['node untrusted.js']);
  });
});
