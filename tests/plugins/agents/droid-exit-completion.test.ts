/**
 * ABOUTME: Tests DroidAgentPlugin completion when child stdio outlives the process.
 * Covers close-first completion and bounded exit fallback.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const fixturePath = join(import.meta.dir, 'fixtures', 'droid-exit-fixture.sh');
const scriptFixturePath = join(import.meta.dir, 'fixtures', 'script');
const runnerPath = join(import.meta.dir, 'fixtures', 'run-droid-agent.ts');

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
  ): Promise<{ status: string; exitCode?: number; stdout: string; durationMs: number }> {
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
    return JSON.parse(stdout) as {
      status: string;
      exitCode?: number;
      stdout: string;
      durationMs: number;
    };
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
});
