/**
 * ABOUTME: Tests for template engine tracker-type resolution and Jira template lookup.
 * Verifies Jira is treated as a first-class built-in template type for project overrides.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBuiltinTemplate, getTemplateTypeFromPlugin, loadTemplate, renderPrompt } from './engine.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('template engine Jira support', () => {
  test('maps jira plugin names to the jira template type', () => {
    expect(getTemplateTypeFromPlugin('jira')).toBe('jira');
  });

  test('loads a project jira.hbs override before the tracker template fallback', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-jira-template-'));
    const templatesDir = join(tempDir, '.ralph-tui', 'templates');
    const projectTemplate = join(templatesDir, 'jira.hbs');

    await mkdir(templatesDir, { recursive: true });
    await writeFile(projectTemplate, 'PROJECT JIRA TEMPLATE', 'utf-8');

    const result = loadTemplate(undefined, 'jira', tempDir, 'TRACKER TEMPLATE');

    expect(result.success).toBe(true);
    expect(result.content).toBe('PROJECT JIRA TEMPLATE');
    expect(result.source).toBe(`project:${projectTemplate}`);
  });

  test('returns the built-in Jira template for jira tracker type', () => {
    const template = getBuiltinTemplate('jira');
    expect(template).toContain('{{taskId}}');
    expect(template).toContain('## Workflow');
  });

  test('renders nested prd context for the Jira template', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-jira-render-'));
    const templatesDir = join(tempDir, '.ralph-tui', 'templates');
    const projectTemplate = join(templatesDir, 'jira.hbs');
    await mkdir(templatesDir, { recursive: true });
    await writeFile(projectTemplate, getBuiltinTemplate('jira'), 'utf-8');

    const task: TrackerTask = {
      id: 'SNSP-55',
      title: 'Ship the story',
      status: 'open',
      priority: 1,
      description: 'Implement the story details',
    };
    const config: RalphConfig = {
      cwd: tempDir,
      maxIterations: 10,
      iterationDelay: 0,
      watch: false,
      pollIntervalMs: 30000,
      outputDir: '.ralph-tui/iterations',
      progressFile: '.ralph-tui/progress.md',
      showTui: true,
      agent: { name: 'default', plugin: 'claude', options: {} },
      tracker: { name: 'default', plugin: 'jira', options: {} },
      errorHandling: {
        strategy: 'abort',
        maxRetries: 0,
        retryDelayMs: 0,
        continueOnNonZeroExit: false,
      },
      autoCommit: false,
    };

    const result = renderPrompt(
      task,
      config,
      undefined,
      {
        prd: {
          name: 'Epic Alpha',
          description: 'Cross-team epic context',
          content: 'Epic Alpha full markdown',
          completedCount: 2,
          totalCount: 5,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.prompt).toContain('## Epic: Epic Alpha');
    expect(result.prompt).toContain('Cross-team epic context');
    expect(result.prompt).toContain('Progress: 2/5 stories completed.');
  });
});
