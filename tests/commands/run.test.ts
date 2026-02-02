/**
 * ABOUTME: Integration tests for the ralph run command.
 * Tests CLI argument parsing, configuration validation, and command flow.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { parseRunArgs, printRunHelp } from '../../src/commands/run.jsx';

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

  /**
   * Tests for session completion logic.
   * Regression tests for https://github.com/subsy/ralph-tui/issues/247
   *
   * The bug was: session files were deleted even when tasks were incomplete
   * because the condition `finalState.status === 'idle'` was always true
   * after the engine finished (regardless of why it finished).
   *
   * The fix: Only check `tasksCompleted >= totalTasks` for completion.
   */
  describe('session completion condition (issue #247)', () => {
    // Helper to simulate engine state for testing completion logic
    const isAllComplete = (tasksCompleted: number, totalTasks: number): boolean => {
      // This mirrors the fixed logic in run.tsx:1978
      return tasksCompleted >= totalTasks;
    };

    test('returns false when 0 tasks completed out of 5', () => {
      expect(isAllComplete(0, 5)).toBe(false);
    });

    test('returns false when 3 tasks completed out of 5', () => {
      expect(isAllComplete(3, 5)).toBe(false);
    });

    test('returns false when 108 tasks completed out of 130 (reporter scenario)', () => {
      // This was the user's exact scenario from issue #247
      expect(isAllComplete(108, 130)).toBe(false);
    });

    test('returns true when 5 tasks completed out of 5', () => {
      expect(isAllComplete(5, 5)).toBe(true);
    });

    test('returns true when more tasks completed than total (edge case)', () => {
      // This shouldn't happen normally, but if it does, treat as complete
      expect(isAllComplete(6, 5)).toBe(true);
    });

    test('returns true when 0 tasks out of 0 (empty project)', () => {
      // Edge case: no tasks is considered complete
      expect(isAllComplete(0, 0)).toBe(true);
    });

    test('completion does NOT depend on engine status', () => {
      // The key fix: we don't check engine status anymore
      // Previously, status === 'idle' was always true after engine finished
      // This test documents that completion is purely based on task counts
      const engineStatus = 'idle'; // This would always be true
      const tasksCompleted = 3;
      const totalTasks = 5;

      // Old buggy logic would have been:
      // const allComplete = tasksCompleted >= totalTasks || engineStatus === 'idle';
      // This would incorrectly return true!

      // Fixed logic:
      const allComplete = isAllComplete(tasksCompleted, totalTasks);
      expect(allComplete).toBe(false);

      // Verify the old logic would have been wrong
      const oldBuggyLogic = tasksCompleted >= totalTasks || engineStatus === 'idle';
      expect(oldBuggyLogic).toBe(true); // This was the bug!
    });
  });
});
