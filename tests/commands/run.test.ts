/**
 * ABOUTME: Integration tests for the ralph run command.
 * Tests CLI argument parsing, configuration validation, and command flow.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  parseRunArgs,
  printRunHelp,
  isSessionComplete,
  shouldMarkCompletedLocally,
} from '../../src/commands/run.jsx';

describe('run command', () => {
  describe('parseRunArgs', () => {
    describe('epic option', () => {
      test('parses --epic with value', () => {
        const result = parseRunArgs(['--epic', 'ralph-tui-45r']);
        expect(result.epicId).toBe('ralph-tui-45r');
      });

      test('ignores --epic without value', () => {
        const result = parseRunArgs(['--epic']);
        expect(result.epicId).toBeUndefined();
      });

      test('ignores --epic followed by another flag', () => {
        const result = parseRunArgs(['--epic', '--force']);
        expect(result.epicId).toBeUndefined();
        expect(result.force).toBe(true);
      });
    });

    describe('prd option', () => {
      test('parses --prd with path', () => {
        const result = parseRunArgs(['--prd', './prd.json']);
        expect(result.prdPath).toBe('./prd.json');
      });

      test('ignores --prd without value', () => {
        const result = parseRunArgs(['--prd']);
        expect(result.prdPath).toBeUndefined();
      });
    });

    describe('agent option', () => {
      test('parses --agent with name', () => {
        const result = parseRunArgs(['--agent', 'claude']);
        expect(result.agent).toBe('claude');
      });

      test('parses --agent opencode', () => {
        const result = parseRunArgs(['--agent', 'opencode']);
        expect(result.agent).toBe('opencode');
      });

      test('ignores --agent without value', () => {
        const result = parseRunArgs(['--agent']);
        expect(result.agent).toBeUndefined();
      });
    });

    describe('model option', () => {
      test('parses --model with name', () => {
        const result = parseRunArgs(['--model', 'opus']);
        expect(result.model).toBe('opus');
      });

      test('parses --model sonnet', () => {
        const result = parseRunArgs(['--model', 'sonnet']);
        expect(result.model).toBe('sonnet');
      });

      test('ignores --model without value', () => {
        const result = parseRunArgs(['--model']);
        expect(result.model).toBeUndefined();
      });
    });

    describe('variant option', () => {
      test('parses --variant with value', () => {
        const result = parseRunArgs(['--variant', 'high']);
        expect(result.variant).toBe('high');
      });

      test('parses --variant max', () => {
        const result = parseRunArgs(['--variant', 'max']);
        expect(result.variant).toBe('max');
      });

      test('parses --variant minimal', () => {
        const result = parseRunArgs(['--variant', 'minimal']);
        expect(result.variant).toBe('minimal');
      });

      test('ignores --variant without value', () => {
        const result = parseRunArgs(['--variant']);
        expect(result.variant).toBeUndefined();
      });
    });

    describe('tracker option', () => {
      test('parses --tracker with name', () => {
        const result = parseRunArgs(['--tracker', 'beads']);
        expect(result.tracker).toBe('beads');
      });

      test('parses --tracker beads-bv', () => {
        const result = parseRunArgs(['--tracker', 'beads-bv']);
        expect(result.tracker).toBe('beads-bv');
      });

      test('parses --tracker json', () => {
        const result = parseRunArgs(['--tracker', 'json']);
        expect(result.tracker).toBe('json');
      });

      test('ignores --tracker without value', () => {
        const result = parseRunArgs(['--tracker']);
        expect(result.tracker).toBeUndefined();
      });
    });

    describe('iterations option', () => {
      test('parses --iterations with valid number', () => {
        const result = parseRunArgs(['--iterations', '20']);
        expect(result.iterations).toBe(20);
      });

      test('parses --iterations 0 (unlimited)', () => {
        const result = parseRunArgs(['--iterations', '0']);
        expect(result.iterations).toBe(0);
      });

      test('ignores --iterations with invalid number', () => {
        const result = parseRunArgs(['--iterations', 'abc']);
        expect(result.iterations).toBeUndefined();
      });

      test('ignores --iterations without value', () => {
        const result = parseRunArgs(['--iterations']);
        expect(result.iterations).toBeUndefined();
      });
    });

    describe('delay option', () => {
      test('parses --delay with valid number', () => {
        const result = parseRunArgs(['--delay', '2000']);
        expect(result.iterationDelay).toBe(2000);
      });

      test('ignores --delay with invalid number', () => {
        const result = parseRunArgs(['--delay', 'fast']);
        expect(result.iterationDelay).toBeUndefined();
      });

      test('ignores --delay without value', () => {
        const result = parseRunArgs(['--delay']);
        expect(result.iterationDelay).toBeUndefined();
      });
    });

    describe('cwd option', () => {
      test('parses --cwd with path', () => {
        const result = parseRunArgs(['--cwd', '/home/user/project']);
        expect(result.cwd).toBe('/home/user/project');
      });

      test('ignores --cwd without value', () => {
        const result = parseRunArgs(['--cwd']);
        expect(result.cwd).toBeUndefined();
      });
    });

    describe('resume flag', () => {
      test('parses --resume flag', () => {
        const result = parseRunArgs(['--resume']);
        expect(result.resume).toBe(true);
      });

      test('resume is undefined when not specified', () => {
        const result = parseRunArgs([]);
        expect(result.resume).toBeUndefined();
      });
    });

    describe('force flag', () => {
      test('parses --force flag', () => {
        const result = parseRunArgs(['--force']);
        expect(result.force).toBe(true);
      });

      test('force is undefined when not specified', () => {
        const result = parseRunArgs([]);
        expect(result.force).toBeUndefined();
      });
    });

    describe('headless flag', () => {
      test('parses --headless flag', () => {
        const result = parseRunArgs(['--headless']);
        expect(result.headless).toBe(true);
      });

      test('parses --no-tui flag as headless', () => {
        const result = parseRunArgs(['--no-tui']);
        expect(result.headless).toBe(true);
      });

      test('headless is undefined when not specified', () => {
        const result = parseRunArgs([]);
        expect(result.headless).toBeUndefined();
      });
    });

    describe('no-setup flag', () => {
      test('parses --no-setup flag', () => {
        const result = parseRunArgs(['--no-setup']);
        expect(result.noSetup).toBe(true);
      });

      test('noSetup is undefined when not specified', () => {
        const result = parseRunArgs([]);
        expect(result.noSetup).toBeUndefined();
      });
    });

    describe('prompt option', () => {
      test('parses --prompt with path', () => {
        const result = parseRunArgs(['--prompt', './custom-prompt.md']);
        expect(result.promptPath).toBe('./custom-prompt.md');
      });

      test('ignores --prompt without value', () => {
        const result = parseRunArgs(['--prompt']);
        expect(result.promptPath).toBeUndefined();
      });
    });

    describe('output-dir option', () => {
      test('parses --output-dir with path', () => {
        const result = parseRunArgs(['--output-dir', './logs']);
        expect(result.outputDir).toBe('./logs');
      });

      test('parses --log-dir alias', () => {
        const result = parseRunArgs(['--log-dir', './logs']);
        expect(result.outputDir).toBe('./logs');
      });

      test('ignores --output-dir without value', () => {
        const result = parseRunArgs(['--output-dir']);
        expect(result.outputDir).toBeUndefined();
      });
    });

    describe('progress-file option', () => {
      test('parses --progress-file with path', () => {
        const result = parseRunArgs(['--progress-file', './progress.md']);
        expect(result.progressFile).toBe('./progress.md');
      });

      test('ignores --progress-file without value', () => {
        const result = parseRunArgs(['--progress-file']);
        expect(result.progressFile).toBeUndefined();
      });
    });

    describe('notify options', () => {
      test('parses --notify flag', () => {
        const result = parseRunArgs(['--notify']);
        expect(result.notify).toBe(true);
      });

      test('parses --no-notify flag', () => {
        const result = parseRunArgs(['--no-notify']);
        expect(result.notify).toBe(false);
      });

      test('notify is undefined when not specified', () => {
        const result = parseRunArgs([]);
        expect(result.notify).toBeUndefined();
      });
    });

    describe('combined options', () => {
      test('parses multiple options', () => {
        const result = parseRunArgs([
          '--epic', 'my-epic',
          '--agent', 'claude',
          '--model', 'opus',
          '--variant', 'high',
          '--tracker', 'beads-bv',
          '--iterations', '15',
          '--delay', '1000',
          '--headless',
          '--notify',
        ]);

        expect(result.epicId).toBe('my-epic');
        expect(result.agent).toBe('claude');
        expect(result.model).toBe('opus');
        expect(result.variant).toBe('high');
        expect(result.tracker).toBe('beads-bv');
        expect(result.iterations).toBe(15);
        expect(result.iterationDelay).toBe(1000);
        expect(result.headless).toBe(true);
        expect(result.notify).toBe(true);
      });

      test('returns empty object for no arguments', () => {
        const result = parseRunArgs([]);
        expect(result).toEqual({});
      });

      test('ignores unknown arguments', () => {
        const result = parseRunArgs(['--unknown', 'value', '--epic', 'my-epic']);
        expect(result.epicId).toBe('my-epic');
        expect((result as Record<string, unknown>).unknown).toBeUndefined();
      });
    });
  });

  describe('printRunHelp', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    test('prints help text', () => {
      printRunHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('ralph-tui run');
      expect(output).toContain('--epic');
      expect(output).toContain('--agent');
      expect(output).toContain('--tracker');
      expect(output).toContain('--iterations');
    });

    test('includes all option descriptions', () => {
      printRunHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('--prd');
      expect(output).toContain('--model');
      expect(output).toContain('--variant');
      expect(output).toContain('--delay');
      expect(output).toContain('--cwd');
      expect(output).toContain('--resume');
      expect(output).toContain('--force');
      expect(output).toContain('--headless');
      expect(output).toContain('--no-tui');
      expect(output).toContain('--no-setup');
    });

    test('includes examples', () => {
      printRunHelp();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Examples:');
      expect(output).toContain('ralph-tui run');
    });
  });

  describe('markdown PRD detection', () => {
    let consoleErrorOutput: string[];
    let consoleErrorSpy: ReturnType<typeof spyOn>;
    let processExitSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      consoleErrorOutput = [];
      consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args) => {
        consoleErrorOutput.push(args.join(' '));
      });
      processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    test('rejects .md files passed to --prd with helpful error', async () => {
      try {
        await import('../../src/commands/run.jsx').then((m) =>
          m.executeRunCommand(['--prd', 'my-prd.md'])
        );
      } catch {
        // Expected: process.exit throws
      }

      const output = consoleErrorOutput.join('\n');
      expect(output).toContain('Markdown PRD files cannot be used directly');
      expect(output).toContain('ralph-tui convert --to json --input my-prd.md');
      expect(output).toContain('ralph-tui convert --to beads --input my-prd.md');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('rejects .markdown files passed to --prd', async () => {
      try {
        await import('../../src/commands/run.jsx').then((m) =>
          m.executeRunCommand(['--prd', 'spec.markdown'])
        );
      } catch {
        // Expected: process.exit throws
      }

      const output = consoleErrorOutput.join('\n');
      expect(output).toContain('Markdown PRD files cannot be used directly');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('rejects .MD files (case-insensitive)', async () => {
      try {
        await import('../../src/commands/run.jsx').then((m) =>
          m.executeRunCommand(['--prd', 'DESIGN.MD'])
        );
      } catch {
        // Expected: process.exit throws
      }

      const output = consoleErrorOutput.join('\n');
      expect(output).toContain('Markdown PRD files cannot be used directly');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('does not reject .json files', async () => {
      // parseRunArgs should accept .json files without triggering the markdown check
      const result = parseRunArgs(['--prd', 'tasks.json']);
      expect(result.prdPath).toBe('tasks.json');
      // The .json file won't trigger process.exit(1) for the markdown check
      // (it may fail later for other reasons in executeRunCommand, but not for markdown detection)
    });

    test('includes convert commands with the actual file path', async () => {
      try {
        await import('../../src/commands/run.jsx').then((m) =>
          m.executeRunCommand(['--prd', './docs/feature.md'])
        );
      } catch {
        // Expected: process.exit throws
      }

      const output = consoleErrorOutput.join('\n');
      expect(output).toContain('ralph-tui convert --to json --input ./docs/feature.md');
      expect(output).toContain('ralph-tui convert --to beads --input ./docs/feature.md');
    });
  });

  describe('shouldMarkCompletedLocally', () => {
    test('returns true when task completed and at least one commit exists', () => {
      expect(shouldMarkCompletedLocally(true, 1)).toBe(true);
    });

    test('returns false when task completed but no commits were created', () => {
      expect(shouldMarkCompletedLocally(true, 0)).toBe(false);
    });

    test('returns false when task did not complete regardless of commit count', () => {
      expect(shouldMarkCompletedLocally(false, 0)).toBe(false);
      expect(shouldMarkCompletedLocally(false, 3)).toBe(false);
    });
  });

  /**
   * Tests for isSessionComplete function.
   * See: https://github.com/subsy/ralph-tui/issues/247
   *
   * Session completion is determined solely by task counts, not engine status.
   * The engine status is always 'idle' after runLoop exits (set in finally block),
   * so using it for completion detection causes incorrect behavior.
   *
   * Correct: tasksCompleted >= totalTasks
   * Incorrect: tasksCompleted >= totalTasks || status === 'idle'
   */
  describe('isSessionComplete (issue #247)', () => {
    describe('sequential mode (parallelAllComplete is null)', () => {
      test('returns false when 0 tasks completed out of 5', () => {
        expect(isSessionComplete(null, 0, 5)).toBe(false);
      });

      test('returns false when 1 task completed out of 5', () => {
        expect(isSessionComplete(null, 1, 5)).toBe(false);
      });

      test('returns false when 3 tasks completed out of 5', () => {
        expect(isSessionComplete(null, 3, 5)).toBe(false);
      });

      test('returns false when 4 tasks completed out of 5 (one remaining)', () => {
        expect(isSessionComplete(null, 4, 5)).toBe(false);
      });

      test('returns false when 108 tasks completed out of 130', () => {
        // Scenario from issue #247: session shows 108/130 but should not be "complete"
        expect(isSessionComplete(null, 108, 130)).toBe(false);
      });

      test('returns true when 5 tasks completed out of 5', () => {
        expect(isSessionComplete(null, 5, 5)).toBe(true);
      });

      test('returns true when more tasks completed than total (edge case)', () => {
        // Edge case: if somehow tasksCompleted exceeds totalTasks, treat as complete
        expect(isSessionComplete(null, 6, 5)).toBe(true);
      });

      test('returns true when 0 tasks out of 0 (empty project)', () => {
        // Edge case: no tasks means nothing to do, so complete
        expect(isSessionComplete(null, 0, 0)).toBe(true);
      });

      test('returns true when 1 task completed out of 1', () => {
        expect(isSessionComplete(null, 1, 1)).toBe(true);
      });

      test('returns false when 0 tasks completed out of 1', () => {
        expect(isSessionComplete(null, 0, 1)).toBe(false);
      });

      test('handles large task counts correctly', () => {
        expect(isSessionComplete(null, 999, 1000)).toBe(false);
        expect(isSessionComplete(null, 1000, 1000)).toBe(true);
        expect(isSessionComplete(null, 1001, 1000)).toBe(true);
      });

      test('completion is based on task counts, not engine status', () => {
        // Key invariant: engine status is irrelevant to completion detection.
        // The engine status is always 'idle' after runLoop exits (finally block),
        // regardless of why execution stopped (user quit, max iterations, completion).
        const tasksCompleted = 3;
        const totalTasks = 5;

        // Correct behavior: incomplete tasks means session is not complete
        expect(isSessionComplete(null, tasksCompleted, totalTasks)).toBe(false);

        // Demonstrate why checking engine status causes incorrect behavior:
        // status === 'idle' is always true after engine stops, so this logic
        // incorrectly marks sessions as complete even with incomplete tasks
        const engineStatus = 'idle';
        const incorrectLogic = tasksCompleted >= totalTasks || engineStatus === 'idle';
        expect(incorrectLogic).toBe(true); // Incorrectly returns true!
      });
    });

    describe('parallel mode (parallelAllComplete is set)', () => {
      test('uses parallelAllComplete=true even when task counts suggest incomplete', () => {
        // Parallel executor says complete, even though counts show 0/10
        expect(isSessionComplete(true, 0, 10)).toBe(true);
      });

      test('uses parallelAllComplete=false even when task counts suggest complete', () => {
        // Parallel executor says incomplete, even though counts show 10/10
        expect(isSessionComplete(false, 10, 10)).toBe(false);
      });

      test('parallelAllComplete=true with matching counts', () => {
        expect(isSessionComplete(true, 5, 5)).toBe(true);
      });

      test('parallelAllComplete=false with incomplete counts', () => {
        expect(isSessionComplete(false, 3, 5)).toBe(false);
      });

      test('parallelAllComplete=true with zero tasks', () => {
        expect(isSessionComplete(true, 0, 0)).toBe(true);
      });

      test('parallelAllComplete=false with zero tasks', () => {
        expect(isSessionComplete(false, 0, 0)).toBe(false);
      });

      test('parallelAllComplete overrides task count logic completely', () => {
        // When parallel mode sets a value, task counts are ignored
        expect(isSessionComplete(true, 0, 100)).toBe(true);
        expect(isSessionComplete(true, 50, 100)).toBe(true);
        expect(isSessionComplete(true, 100, 100)).toBe(true);
        expect(isSessionComplete(false, 0, 100)).toBe(false);
        expect(isSessionComplete(false, 50, 100)).toBe(false);
        expect(isSessionComplete(false, 100, 100)).toBe(false);
      });
    });

    describe('nullish coalescing behavior', () => {
      test('null triggers fallback to task count check', () => {
        expect(isSessionComplete(null, 5, 5)).toBe(true);
        expect(isSessionComplete(null, 4, 5)).toBe(false);
      });

      test('boolean false does NOT trigger fallback', () => {
        // false is not nullish, so it does not fall through to task count check
        expect(isSessionComplete(false, 5, 5)).toBe(false);
      });

      test('boolean true does NOT trigger fallback', () => {
        // true is not nullish, so it does not fall through to task count check
        expect(isSessionComplete(true, 0, 5)).toBe(true);
      });
    });
  });
});
