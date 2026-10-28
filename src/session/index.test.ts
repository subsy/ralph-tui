/**
 * ABOUTME: Tests for session metadata creation.
 * Covers multi-epic session fields written to session metadata.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionScope } from '../plugins/trackers/types.js';
import {
  acquireLockWithPrompt,
  checkSession,
  createSession,
  releaseLock,
  resumeSession,
  saveSession,
} from './index.js';

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ralph-session-index-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  for (const tempDir of tempDirs) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('createSession', () => {
  test('persists multi-epic IDs and execution scopes', async () => {
    const cwd = await createTempDir();
    const executionScopes: ExecutionScope[] = [
      { id: 'ui-epic', title: 'UI', type: 'epic' },
      { id: 'backend-epic', title: 'Backend', type: 'epic' },
    ];

    const session = await createSession({
      cwd,
      sessionId: 'session-123',
      agentPlugin: 'claude',
      trackerPlugin: 'beads-rust',
      epicId: 'ui-epic',
      epicIds: ['ui-epic', 'backend-epic'],
      executionScopes,
      maxIterations: 5,
      totalTasks: 2,
      lockAlreadyAcquired: true,
    });

    expect(session.epicIds).toEqual(['ui-epic', 'backend-epic']);
    expect(session.executionScopes).toEqual(executionScopes);

    const checked = await checkSession(cwd);
    expect(checked.session?.epicIds).toEqual(['ui-epic', 'backend-epic']);
    expect(checked.session?.executionScopes).toEqual(executionScopes);
  });
});

describe('resumeSession', () => {
  test('succeeds when the current process already owns the lock', async () => {
    const cwd = await createTempDir();
    const session = await createSession({
      cwd,
      sessionId: 'session-owned-lock',
      agentPlugin: 'claude',
      trackerPlugin: 'beads-rust',
      maxIterations: 5,
      totalTasks: 2,
      lockAlreadyAcquired: true,
    });
    session.status = 'paused';
    await saveSession(session);

    const acquired = await acquireLockWithPrompt(cwd, session.id);
    expect(acquired.acquired).toBe(true);

    const resumed = await resumeSession(cwd);

    expect(resumed?.status).toBe('running');
    expect((await checkSession(cwd)).session?.status).toBe('running');
    await releaseLock(cwd);
  });

  test('acquires the lock when no lock is held', async () => {
    const cwd = await createTempDir();
    const session = await createSession({
      cwd,
      sessionId: 'session-unlocked',
      agentPlugin: 'claude',
      trackerPlugin: 'beads-rust',
      maxIterations: 5,
      totalTasks: 2,
      lockAlreadyAcquired: true,
    });
    session.status = 'paused';
    await saveSession(session);

    const resumed = await resumeSession(cwd);

    expect(resumed?.status).toBe('running');
    await releaseLock(cwd);
  });
});
