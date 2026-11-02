/**
 * ABOUTME: Tests DroidAgentPlugin completion when child stdio outlives the process.
 * Covers close-first completion and bounded exit fallback.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const fixturePath = join(import.meta.dir, 'fixtures', 'droid-exit-fixture.sh');
const scriptFixturePath = join(import.meta.dir, 'fixtures', 'script');
const runnerPath = join(import.meta.dir, 'fixtures', 'run-droid-agent.ts');

interface FixtureResult {
  status: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  interrupted: boolean;
  starts: number;
  ends: number;
  runningAtStart: boolean;
  runningAfterEnd: boolean;
  currentAfterEnd: boolean;
  streamedStdout: string;
  streamedStderr: string;
  currentHandlesMatch: boolean;
  currentPromisesMatch: boolean;
  currentObserverCount: number;
}

describe('DroidAgentPlugin process exit completion', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    await stopFixtureChild();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function runFixture(
    mode: string,
    env: Record<string, string> = {}
  ): Promise<FixtureResult> {
    const child = Bun.spawn([process.execPath, 'run', runnerPath, mode], {
      env: { ...process.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as FixtureResult;
    expect(result.starts).toBe(1);
    expect(result.ends).toBe(1);
    expect(result.runningAtStart).toBe(true);
    expect(result.runningAfterEnd).toBe(false);
    expect(result.currentAfterEnd).toBe(false);
    return result;
  }

  async function stopFixtureChild(): Promise<void> {
    if (!tempDir) {
      return;
    }
    try {
      const childPid = Number.parseInt(
        await readFile(join(tempDir, 'child.pid'), 'utf8'),
        10
      );
      if (Number.isInteger(childPid)) {
        process.kill(childPid, 'SIGTERM');
      }
    } catch {
      // The fixture may have already exited or not written its PID.
    }
  }

  test('completes when an inherited stdio holder outlives the agent', async () => {
    if (platform() === 'win32') {
      return;
    }

    tempDir = await mkdtemp(join(tmpdir(), 'ralph-droid-exit-'));
    const startedAt = Date.now();
    const result = await runFixture('hold', {
      AGENT_CHILD_PID_FILE: join(tempDir, 'child.pid'),
      AGENT_FIXTURE_PATH: fixturePath,
      DROID_SCRIPT_FIXTURE_PATH: scriptFixturePath,
    });

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('droid fixture output');
  });

  test('completes through close without waiting for the drain grace period', async () => {
    if (platform() === 'win32') {
      return;
    }

    const startedAt = Date.now();
    const result = await runFixture('clean', {
      AGENT_FIXTURE_PATH: fixturePath,
      DROID_SCRIPT_FIXTURE_PATH: scriptFixturePath,
    });

    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('droid fixture output');
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  for (const direct of [false, true]) {
    test(`${direct ? 'direct construction' : 'script shim'} inherits bounded output accumulation`, async () => {
      if (platform() === 'win32') return;
      const result = await runFixture('large', {
        AGENT_FIXTURE_PATH: fixturePath, DROID_SCRIPT_FIXTURE_PATH: scriptFixturePath,
        DROID_DIRECT_LAUNCH: direct ? '1' : '0',
      });
      for (const stream of ['stdout', 'stderr'] as const) {
        expect(result[stream]).toHaveLength(2_000_000);
        expect(result[stream]).toStartWith('[...agent output truncated in memory...]\n');
        expect(result[stream]).toEndWith(`${stream}-tail`);
      }
      expect(result.streamedStdout.length).toBeGreaterThan(result.stdout.length);
      expect(result.streamedStderr.length).toBeGreaterThan(result.stderr.length);
    });

    for (const mode of ['clean', 'fail', 'throw-on-end', 'current-handle', 'timeout', 'interrupt', 'interrupt-all', 'early-interrupt']) {
      test(`${direct ? 'direct construction' : 'script shim'} inherits ${mode} lifecycle`, async () => {
        if (platform() === 'win32') return;
        const result = await runFixture(mode, {
          AGENT_FIXTURE_PATH: fixturePath,
          DROID_SCRIPT_FIXTURE_PATH: scriptFixturePath,
          DROID_DIRECT_LAUNCH: direct ? '1' : '0',
        });
        const interrupted = mode.includes('interrupt');
        expect(result.status).toBe(interrupted ? 'interrupted' : mode === 'timeout' ? 'timeout' : mode === 'fail' ? 'failed' : 'completed');
        expect(result.interrupted).toBe(interrupted);
        expect(result.currentHandlesMatch).toBe(true);
        expect(result.currentPromisesMatch).toBe(true);
        if (mode !== 'early-interrupt') expect(result.currentObserverCount).toBeGreaterThanOrEqual(2);
        if (mode === 'fail') expect(result.exitCode).toBe(7);
        if (mode === 'clean' || mode === 'throw-on-end') {
          expect(result.stdout).toBe(result.streamedStdout);
          expect(result.stderr).toBe(result.streamedStderr);
          expect(result.stderr).toContain('droid fixture stderr');
        }
      }, 10000);
    }

    for (const mode of ['hold', 'burst', 'continuous']) {
      test(`${direct ? 'direct construction' : 'script shim'} inherits bounded ${mode} drain`, async () => {
        if (platform() === 'win32') return;
        tempDir = await mkdtemp(join(tmpdir(), 'ralph-droid-drain-'));
        const result = await runFixture(mode, {
          AGENT_FIXTURE_PATH: fixturePath,
          DROID_SCRIPT_FIXTURE_PATH: scriptFixturePath,
          DROID_DIRECT_LAUNCH: direct ? '1' : '0',
          AGENT_CHILD_PID_FILE: join(tempDir, 'child.pid'),
        });
        expect(result.status).toBe('completed');
        expect(result.exitCode).toBe(0);
        expect(result.durationMs).toBeLessThan(mode === 'continuous' ? 13000 : 5000);
        if (mode === 'burst') {
          expect(result.stdout).toContain('burst output');
          expect(result.stderr).toContain('late stderr');
          expect(result.durationMs).toBeGreaterThanOrEqual(3000);
        }
        if (mode === 'continuous') {
          expect(result.stdout.match(/continuous output/g)?.length).toBeGreaterThan(20);
          expect(result.durationMs).toBeGreaterThanOrEqual(9500);
        }
      }, 15000);
    }
  }

  for (const authCase of ['filtered', 'passthrough', 'explicit']) {
    test(`real Linux script preserves prompt bytes, cwd, echo, flags and ${authCase} authentication environment`, async () => {
      if (platform() !== 'linux') return;
      tempDir = await mkdtemp(join(tmpdir(), "ralph-droid-pty's-"));
      const command = join(tempDir, "fake droid's.ts");
      await writeFile(command, `#!${process.execPath}
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(),
  tty: Boolean(process.stdin.isTTY), echo: require('node:child_process').execSync('stty -a', { stdio: ['inherit', 'pipe', 'pipe'] }).toString(),
  env: { CI: process.env.CI, TERM: process.env.TERM, NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR, INK_DISABLE_INPUT: process.env.INK_DISABLE_INPUT,
    secret: process.env.DROID_TEST_SECRET, explicit: process.env.DROID_EXPLICIT_VALUE,
    factory: process.env.FACTORY_API_KEY, unrelated: process.env.UNRELATED_API_KEY } }));
`, { mode: 0o755 });
      const prompt = "line one\nline\ttwo\rquote' slash\\ $HOME $(touch sentinel) `touch sentinel`";
      const result = await runFixture('capture', {
        AGENT_FIXTURE_PATH: command, DROID_CWD: tempDir, DROID_PROMPT: prompt,
        DROID_TEST_SECRET: 'non-secret-test-value',
        DROID_AUTH_CASE: authCase, FACTORY_API_KEY: 'inherited-test-key',
        UNRELATED_API_KEY: 'unrelated-test-key',
      });
      const captured = JSON.parse(result.stdout.trim());
      expect(captured.args).toEqual([
        'exec', '--output-format', 'stream-json', '--default-flag', '--runtime-flag',
        '--skip-permissions-unsafe', '--cwd', tempDir, prompt,
      ]);
      expect(captured.args.at(-1)).toBe(prompt);
      expect(captured.args.slice(-3, -1)).toEqual(['--cwd', tempDir]);
      expect(captured.cwd).toBe(tempDir);
      expect(captured.tty).toBe(true);
      expect(captured.echo).toMatch(/(?:^|\s)-echo(?:\s|;)/);
      expect(captured.env).toEqual({ CI: 'true', TERM: 'dumb', NO_COLOR: '1',
        FORCE_COLOR: '0', INK_DISABLE_INPUT: '1', explicit: 'explicit',
        ...(authCase === 'passthrough' ? { factory: 'inherited-test-key' } : {}),
        ...(authCase === 'explicit' ? { factory: 'explicit-test-key' } : {}),
      });
      expect(await Bun.file(join(tempDir, 'sentinel')).exists()).toBe(false);
    });
  }
});
