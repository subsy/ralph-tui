/**
 * ABOUTME: Exercises real verification deadlines and descendant cleanup without mocked process helpers.
 */

import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerification } from '../../src/engine/verification.js';
import { DEFAULT_VERIFICATION_CONFIG } from '../../src/config/types.js';
import { runProcess } from '../../src/utils/process.js';

test('literal file assertions run natively with cwd, quotes, directories and missing paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ralph-native-file-'));
  try {
    const name = "literal ' quoted.txt";
    await writeFile(join(cwd, name), 'fixture');
    const config = { ...DEFAULT_VERIFICATION_CONFIG, commands: [] };
    const present = await runVerification(cwd, config, undefined, [name, '.']);
    expect(present.passed).toBe(true);
    expect(present.results).toHaveLength(2);
    const missing = await runVerification(cwd, config, undefined, [`${name} missing`]);
    expect(missing.passed).toBe(false);
    expect(missing.results[0].exitCode).toBe(1);
    expect(missing.results[0].command).toContain(`${name} missing`);
    const malformed = await runVerification(cwd, config, undefined, ['bad\0path']);
    expect(malformed.passed).toBe(false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('configured commands use the native shell with cwd and output capture', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ralph-native-shell-'));
  try {
    const result = await runVerification(cwd, {
      ...DEFAULT_VERIFICATION_CONFIG, commands: ['echo native-shell'],
    });
    expect(result.passed).toBe(true);
    expect(result.results[0].stdout).toContain('native-shell');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('cancelled verification fails without launching any commands', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ralph-verification-cancelled-'));
  const controller = new AbortController();
  controller.abort();
  try {
    const result = await runVerification(cwd, {
      ...DEFAULT_VERIFICATION_CONFIG, commands: ['touch should-not-run'],
    }, controller.signal);
    expect(result.passed).toBe(false);
    expect(result.results).toEqual([]);
    expect(await Bun.file(join(cwd, 'should-not-run')).exists()).toBe(false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('verification deadline kills the shell and an uncooperative child', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ralph-verification-process-'));
  let pid: number | undefined;
  try {
    await writeFile(join(cwd, 'child.cjs'), `
      require('fs').writeFileSync('child.pid', String(process.pid));
      process.on('SIGTERM', () => {});
      setTimeout(() => require('fs').writeFileSync('late-work', 'unexpected'), 1200);
      setInterval(() => {}, 1000);
    `);
    const result = await runVerification(cwd, {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: [`'${process.execPath.replace(/'/g, "'\\''")}' child.cjs`],
      timeoutMs: 500,
    });
    pid = Number(await readFile(join(cwd, 'child.pid'), 'utf8'));
    expect(result.passed).toBe(false);
    expect(result.durationMs).toBeLessThan(3000);
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    expect(stat === '' || stat.split(' ')[2] === 'Z').toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1300));
    expect(await Bun.file(join(cwd, 'late-work')).exists()).toBe(false);
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    await rm(cwd, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === 'win32')('a command cannot turn its timeout into success by exiting zero', async () => {
  const result = await runProcess(process.execPath, ['-e',
    "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)",
  ], { timeout: 500 });
  expect(result.exitCode).toBe(0);
  expect(result.success).toBe(false);
});
