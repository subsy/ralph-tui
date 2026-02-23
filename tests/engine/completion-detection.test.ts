/**
 * ABOUTME: Tests for pluggable completion detection strategies.
 * Covers all strategies (promise-tag, relaxed-tag, heuristic) and the detectCompletion orchestrator.
 */

import { describe, it, expect } from 'bun:test';
import {
  promiseTagStrategy,
  relaxedTagStrategy,
  heuristicStrategy,
  detectCompletion,
} from '../../src/engine/completion-strategies';
import type { AgentExecutionResult } from '../../src/plugins/agents/types';

function makeResult(stdout: string, exitCode = 0): AgentExecutionResult {
  return {
    executionId: 'test-id',
    status: 'completed',
    exitCode,
    stdout,
    stderr: '',
    durationMs: 100,
    interrupted: false,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };
}

describe('promiseTagStrategy', () => {
  it('detects exact match', () => {
    expect(promiseTagStrategy.detect(makeResult('<promise>COMPLETE</promise>'))).toBe(true);
  });

  it('is case insensitive', () => {
    expect(promiseTagStrategy.detect(makeResult('<promise>complete</promise>'))).toBe(true);
    expect(promiseTagStrategy.detect(makeResult('<PROMISE>COMPLETE</PROMISE>'))).toBe(true);
  });

  it('tolerates whitespace inside tags', () => {
    expect(promiseTagStrategy.detect(makeResult('<promise>  COMPLETE  </promise>'))).toBe(true);
    expect(promiseTagStrategy.detect(makeResult('<promise>\nCOMPLETE\n</promise>'))).toBe(true);
  });

  it('rejects missing tag', () => {
    expect(promiseTagStrategy.detect(makeResult('Task finished.'))).toBe(false);
  });

  it('rejects partial tag', () => {
    expect(promiseTagStrategy.detect(makeResult('promise COMPLETE'))).toBe(false);
  });
});

describe('relaxedTagStrategy', () => {
  it('detects exact tag', () => {
    expect(relaxedTagStrategy.detect(makeResult('<promise>COMPLETE</promise>'))).toBe(true);
  });

  it('detects "promise: complete" alternate form', () => {
    expect(relaxedTagStrategy.detect(makeResult('promise: complete'))).toBe(true);
    expect(relaxedTagStrategy.detect(makeResult('Promise: Complete'))).toBe(true);
  });

  it('detects tag inside code fences (tag still present in raw text)', () => {
    const output = '```\n<promise>COMPLETE</promise>\n```';
    expect(relaxedTagStrategy.detect(makeResult(output))).toBe(true);
  });

  it('rejects when no signal present', () => {
    expect(relaxedTagStrategy.detect(makeResult('All done!'))).toBe(false);
  });
});

describe('heuristicStrategy', () => {
  it('detects completion with exit 0 and matching phrase', () => {
    expect(heuristicStrategy.detect(makeResult('all acceptance criteria met', 0))).toBe(true);
    expect(heuristicStrategy.detect(makeResult('all tasks complete', 0))).toBe(true);
    expect(heuristicStrategy.detect(makeResult('implementation complete', 0))).toBe(true);
    expect(heuristicStrategy.detect(makeResult('all checks pass', 0))).toBe(true);
  });

  it('rejects when exit code is non-zero', () => {
    expect(heuristicStrategy.detect(makeResult('all acceptance criteria met', 1))).toBe(false);
  });

  it('rejects exit 0 without completion phrase', () => {
    expect(heuristicStrategy.detect(makeResult('Task is done.', 0))).toBe(false);
  });

  it('rejects when exitCode is undefined', () => {
    const result = makeResult('all acceptance criteria met');
    result.exitCode = undefined;
    expect(heuristicStrategy.detect(result)).toBe(false);
  });

  it('only checks last 500 chars', () => {
    const preamble = 'all acceptance criteria met ' + 'x'.repeat(600);
    expect(heuristicStrategy.detect(makeResult(preamble, 0))).toBe(false);
  });
});

describe('detectCompletion', () => {
  it('defaults to promise-tag strategy only', () => {
    const result = detectCompletion(makeResult('<promise>COMPLETE</promise>'));
    expect(result.completed).toBe(true);
    expect(result.matchedStrategy).toBe('promise-tag');
  });

  it('returns first matching strategy', () => {
    const result = detectCompletion(
      makeResult('<promise>COMPLETE</promise>'),
      ['promise-tag', 'relaxed-tag'],
    );
    expect(result.matchedStrategy).toBe('promise-tag');
  });

  it('falls through to second strategy when first does not match', () => {
    const result = detectCompletion(
      makeResult('promise: complete'),
      ['promise-tag', 'relaxed-tag'],
    );
    expect(result.completed).toBe(true);
    expect(result.matchedStrategy).toBe('relaxed-tag');
  });

  it('returns no match when no strategy matches', () => {
    const result = detectCompletion(makeResult('Nothing here.'), ['promise-tag', 'relaxed-tag']);
    expect(result.completed).toBe(false);
    expect(result.matchedStrategy).toBeNull();
  });

  it('heuristic not active by default config', () => {
    const result = detectCompletion(makeResult('all acceptance criteria met', 0));
    expect(result.completed).toBe(false);
  });

  it('heuristic active when explicitly configured', () => {
    const result = detectCompletion(
      makeResult('all acceptance criteria met', 0),
      ['heuristic'],
    );
    expect(result.completed).toBe(true);
    expect(result.matchedStrategy).toBe('heuristic');
  });
});
