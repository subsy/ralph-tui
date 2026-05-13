/**
 * ABOUTME: Tests for session metadata creation.
 * Covers multi-epic session fields written to session metadata.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionScope } from '../plugins/trackers/types.js';
import { checkSession, createSession } from './index.js';

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
