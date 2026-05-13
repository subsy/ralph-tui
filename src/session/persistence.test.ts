/**
 * ABOUTME: Tests for persisted session state serialization and summaries.
 * Covers multi-epic session metadata so resume can restore selected scopes.
 */

import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionScope, TrackerTask } from '../plugins/trackers/types.js';
import {
  createPersistedSession,
  getSessionSummary,
  loadPersistedSession,
  savePersistedSession,
} from './persistence.js';

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ralph-session-persistence-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  for (const tempDir of tempDirs) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function task(id: string): TrackerTask {
  return {
    id,
    title: id,
    status: 'open',
    priority: 2,
  };
}

describe('session persistence multi-epic metadata', () => {
  test('creates, saves, loads, and summarizes epicIds and execution scopes', async () => {
    const cwd = await createTempDir();
    const executionScopes: ExecutionScope[] = [
      { id: 'ui-epic', title: 'UI', type: 'epic' },
      { id: 'backend-epic', title: 'Backend', type: 'epic' },
    ];

    const state = createPersistedSession({
      sessionId: 'session-123',
      agentPlugin: 'claude',
      trackerPlugin: 'beads-rust',
      epicId: 'ui-epic',
      epicIds: ['ui-epic', 'backend-epic'],
      executionScopes,
      maxIterations: 5,
      tasks: [task('ui-task'), task('backend-task')],
      cwd,
    });

    expect(state.trackerState.epicIds).toEqual(['ui-epic', 'backend-epic']);
    expect(state.trackerState.executionScopes).toEqual(executionScopes);

    await savePersistedSession(state);
    const loaded = await loadPersistedSession(cwd);
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error('Expected persisted session to load');
    }

    expect(loaded.trackerState.epicIds).toEqual(['ui-epic', 'backend-epic']);
    expect(loaded.trackerState.executionScopes).toEqual(executionScopes);

    const summary = getSessionSummary(loaded);
    expect(summary.epicId).toBe('ui-epic');
    expect(summary.epicIds).toEqual(['ui-epic', 'backend-epic']);
    expect(summary.executionScopes).toEqual(executionScopes);
  });
});
