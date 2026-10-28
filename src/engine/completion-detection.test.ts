/**
 * ABOUTME: Tests for task completion detection logic.
 * Verifies that tasks are only marked complete with explicit <promise>COMPLETE</promise> signal.
 * See: https://github.com/subsy/ralph-tui/issues/259
 */

import { describe, test, expect } from 'bun:test';

/**
 * The completion pattern used by the engine.
 * Duplicated here for testing since it's a private const in the engine.
 */
const PROMISE_COMPLETE_PATTERN = /<promise>\s*COMPLETE\s*<\/promise>/i;

describe('Task Completion Detection (Issue #259)', () => {
  describe('PROMISE_COMPLETE_PATTERN', () => {
    test('matches standard completion signal', () => {
      const stdout = 'Task finished successfully.\n<promise>COMPLETE</promise>';
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(true);
    });

    test('matches completion signal with whitespace', () => {
      const stdout = '<promise>  COMPLETE  </promise>';
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(true);
    });

    test('matches completion signal case-insensitively', () => {
      expect(PROMISE_COMPLETE_PATTERN.test('<promise>complete</promise>')).toBe(true);
      expect(PROMISE_COMPLETE_PATTERN.test('<PROMISE>COMPLETE</PROMISE>')).toBe(true);
      expect(PROMISE_COMPLETE_PATTERN.test('<Promise>Complete</Promise>')).toBe(true);
    });

    test('matches completion signal with newlines around it', () => {
      const stdout = 'Done with task.\n\n<promise>COMPLETE</promise>\n\nEnd of output.';
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(true);
    });

    test('matches completion signal in middle of output', () => {
      const stdout = `
        Starting task...
        Working on implementation...
        <promise>COMPLETE</promise>
        Cleaning up...
      `;
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(true);
    });

    test('does NOT match when signal is absent', () => {
      const stdout = 'Task finished successfully. Exit code 0.';
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(false);
    });

    test('does NOT match partial signal', () => {
      expect(PROMISE_COMPLETE_PATTERN.test('<promise>COMPLET</promise>')).toBe(false);
      expect(PROMISE_COMPLETE_PATTERN.test('<promise>COMPLETE')).toBe(false);
      expect(PROMISE_COMPLETE_PATTERN.test('COMPLETE</promise>')).toBe(false);
    });

    test('does NOT match malformed tags', () => {
      expect(PROMISE_COMPLETE_PATTERN.test('<promis>COMPLETE</promis>')).toBe(false);
      expect(PROMISE_COMPLETE_PATTERN.test('[promise]COMPLETE[/promise]')).toBe(false);
      expect(PROMISE_COMPLETE_PATTERN.test('promise>COMPLETE</promise')).toBe(false);
    });

    test('does NOT match when agent asks clarification questions', () => {
      const stdout = `
        I need some clarification before proceeding:

        1. What database should I use?
        2. Should I add authentication?

        Please provide more details.
      `;
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(false);
    });

    test('does NOT match when agent reports being blocked', () => {
      const stdout = `
        I encountered an issue and cannot proceed:

        Error: Missing required configuration file.

        Please create the config file and try again.
      `;
      expect(PROMISE_COMPLETE_PATTERN.test(stdout)).toBe(false);
    });

    test('does NOT match empty output', () => {
      expect(PROMISE_COMPLETE_PATTERN.test('')).toBe(false);
    });

    test('does NOT match whitespace-only output', () => {
      expect(PROMISE_COMPLETE_PATTERN.test('   \n\t\n   ')).toBe(false);
    });
  });

  describe('Completion logic behavior', () => {
    /**
     * Helper to simulate the completion detection logic from the engine.
     * This mirrors the actual logic in src/engine/index.ts
     */
    function detectTaskCompletion(agentResult: {
      stdout: string;
      status: 'completed' | 'failed' | 'interrupted' | 'timeout';
    }): boolean {
      const promiseComplete = PROMISE_COMPLETE_PATTERN.test(agentResult.stdout);
      // Fix for issue #259: Only use explicit completion signal
      // Exit code 0 alone does NOT indicate task completion
      return promiseComplete;
    }

    test('marks task complete when promise signal present and exit code 0', () => {
      const result = detectTaskCompletion({
        stdout: 'Done!\n<promise>COMPLETE</promise>',
        status: 'completed',
      });
      expect(result).toBe(true);
    });

    test('marks task complete when promise signal present even if status is failed', () => {
      // Edge case: agent might output completion signal but exit non-zero
      // We trust the explicit signal over exit code
      const result = detectTaskCompletion({
        stdout: '<promise>COMPLETE</promise>',
        status: 'failed',
      });
      expect(result).toBe(true);
    });

    test('does NOT mark task complete when exit code 0 but no promise signal', () => {
      // This is the key fix for issue #259
      const result = detectTaskCompletion({
        stdout: 'Task finished. Everything looks good.',
        status: 'completed',
      });
      expect(result).toBe(false);
    });

    test('does NOT mark task complete when agent asks questions and exits cleanly', () => {
      // This is the exact scenario from issue #259
      const result = detectTaskCompletion({
        stdout: `
          I have a few questions before I can proceed:

          1. What framework should I use?
          2. Do you want tests included?

          Please clarify these points.
        `,
        status: 'completed', // Agent exited with code 0
      });
      expect(result).toBe(false);
    });

    test('does NOT mark task complete when agent reports error and exits', () => {
      const result = detectTaskCompletion({
        stdout: 'Error: Could not find the specified file. Aborting.',
        status: 'completed',
      });
      expect(result).toBe(false);
    });

    test('does NOT mark task complete when agent times out', () => {
      const result = detectTaskCompletion({
        stdout: 'Working on task...',
        status: 'timeout',
      });
      expect(result).toBe(false);
    });

    test('does NOT mark task complete when agent is interrupted', () => {
      const result = detectTaskCompletion({
        stdout: 'Starting work...\n<promise>COMPLE',
        status: 'interrupted',
      });
      expect(result).toBe(false);
    });

    test('does NOT mark task complete with empty stdout even if status is completed', () => {
      const result = detectTaskCompletion({
        stdout: '',
        status: 'completed',
      });
      expect(result).toBe(false);
    });
  });

  describe('Edge cases for issue #259', () => {
    function detectTaskCompletion(stdout: string, _status: string): boolean {
      const promiseComplete = PROMISE_COMPLETE_PATTERN.test(stdout);
      return promiseComplete;
    }

    test('agent outputs metadata update message without completion signal', () => {
      // Scenario from issue #259: agent updates metadata but does no real work
      const stdout = `
        Updated task metadata.
        Committed changes to .ralph-tui/tasks.json

        Task status has been updated.
      `;
      expect(detectTaskCompletion(stdout, 'completed')).toBe(false);
    });

    test('agent loops through tasks without doing work', () => {
      // Another scenario from issue #259
      const stdout = `
        Iteration 1: Looking at task...
        Need more information about requirements.

        Iteration 2: Checking task again...
        Still need clarification on scope.

        Iteration 3: Task review...
        Cannot proceed without user input.
      `;
      expect(detectTaskCompletion(stdout, 'completed')).toBe(false);
    });

    test('completion signal must be explicit, not just mentioned', () => {
      const stdout = `
        The agent should output <promise>COMPLETE</promise> when done.
        But I haven't actually finished the task yet.
        I'm just explaining the protocol.
      `;
      // This WILL match because the pattern is present in the text
      // This is expected behavior - agents shouldn't mention the signal
      // unless they mean it
      expect(detectTaskCompletion(stdout, 'completed')).toBe(true);
    });

    test('multiple completion signals still counts as complete', () => {
      const stdout = `
        <promise>COMPLETE</promise>
        Just to be sure:
        <promise>COMPLETE</promise>
      `;
      expect(detectTaskCompletion(stdout, 'completed')).toBe(true);
    });
  });
});
