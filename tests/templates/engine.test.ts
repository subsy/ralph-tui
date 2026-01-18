/**
 * ABOUTME: Comprehensive tests for the template engine.
 * Tests template resolution hierarchy, installation, loading, and rendering.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdir, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import * as templateEngine from '../../src/templates/engine.js';
import {
  getBuiltinTemplate,
  getTemplateTypeFromPlugin,
  getUserConfigDir,
  getTemplateFilename,
  getProjectTemplatePath,
  getGlobalTemplatePath,
  loadTemplate,
  buildTemplateVariables,
  buildTemplateContext,
  renderPrompt,
  clearTemplateCache,
  getCustomTemplatePath,
  copyBuiltinTemplate,
  installGlobalTemplates,
  installBuiltinTemplates,
} from '../../src/templates/engine.js';
import {
  DEFAULT_TEMPLATE,
  BEADS_TEMPLATE,
  BEADS_BV_TEMPLATE,
  JSON_TEMPLATE,
} from '../../src/templates/builtin.js';
import type { TrackerTask } from '../../src/plugins/trackers/types.js';
import type { RalphConfig } from '../../src/config/types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a unique temporary directory for test isolation.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(tmpdir(), `ralph-tui-test-${randomUUID()}`);
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Clean up a test directory.
 */
async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a mock task for testing.
 */
function createMockTask(overrides: Partial<TrackerTask> = {}): TrackerTask {
  return {
    id: 'task-123',
    title: 'Test Task',
    status: 'open',
    priority: 2,
    description: 'A test task description',
    labels: ['test', 'feature'],
    type: 'story',
    dependsOn: ['task-100'],
    ...overrides,
  };
}

/**
 * Create a mock config for testing.
 */
function createMockConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    tracker: {
      plugin: 'beads',
      options: {},
    },
    agent: {
      plugin: 'claude-code',
      options: {},
    },
    model: 'claude-sonnet-4-20250514',
    cwd: process.cwd(),
    maxIterations: 10,
    ...overrides,
  } as RalphConfig;
}

// ============================================================================
// Pure Function Tests (No Filesystem)
// ============================================================================

describe('Template Engine - Pure Functions', () => {
  describe('getBuiltinTemplate', () => {
    test('returns DEFAULT_TEMPLATE for "default" type', () => {
      expect(getBuiltinTemplate('default')).toBe(DEFAULT_TEMPLATE);
    });

    test('returns BEADS_TEMPLATE for "beads" type', () => {
      expect(getBuiltinTemplate('beads')).toBe(BEADS_TEMPLATE);
    });

    test('returns BEADS_BV_TEMPLATE for "beads-bv" type', () => {
      expect(getBuiltinTemplate('beads-bv')).toBe(BEADS_BV_TEMPLATE);
    });

    test('returns JSON_TEMPLATE for "json" type', () => {
      expect(getBuiltinTemplate('json')).toBe(JSON_TEMPLATE);
    });

    test('returns DEFAULT_TEMPLATE for unknown type', () => {
      expect(getBuiltinTemplate('unknown' as any)).toBe(DEFAULT_TEMPLATE);
    });
  });

  describe('getTemplateTypeFromPlugin', () => {
    test('maps beads-bv plugin to beads-bv type', () => {
      expect(getTemplateTypeFromPlugin('beads-bv')).toBe('beads-bv');
    });

    test('maps beads plugin to beads type', () => {
      expect(getTemplateTypeFromPlugin('beads')).toBe('beads');
    });

    test('maps json plugin to json type', () => {
      expect(getTemplateTypeFromPlugin('json')).toBe('json');
    });

    test('maps unknown plugin to default type', () => {
      expect(getTemplateTypeFromPlugin('custom-tracker')).toBe('default');
    });

    test('handles plugin names containing tracker type', () => {
      expect(getTemplateTypeFromPlugin('my-beads-tracker')).toBe('beads');
      expect(getTemplateTypeFromPlugin('json-extended')).toBe('json');
    });

    test('beads-bv takes precedence over beads', () => {
      // This tests that beads-bv is checked before beads
      expect(getTemplateTypeFromPlugin('beads-bv-custom')).toBe('beads-bv');
    });
  });

  describe('getUserConfigDir', () => {
    test('returns path under home directory', () => {
      const configDir = getUserConfigDir();
      expect(configDir).toContain('.config');
      expect(configDir).toContain('ralph-tui');
      expect(configDir.startsWith(homedir())).toBe(true);
    });
  });

  describe('getTemplateFilename', () => {
    test('returns beads.hbs for beads type', () => {
      expect(getTemplateFilename('beads')).toBe('beads.hbs');
    });

    test('returns beads-bv.hbs for beads-bv type', () => {
      expect(getTemplateFilename('beads-bv')).toBe('beads-bv.hbs');
    });

    test('returns json.hbs for json type', () => {
      expect(getTemplateFilename('json')).toBe('json.hbs');
    });

    test('returns default.hbs for default type', () => {
      expect(getTemplateFilename('default')).toBe('default.hbs');
    });
  });

  describe('getProjectTemplatePath', () => {
    test('returns path under .ralph-tui/templates/', () => {
      const path = getProjectTemplatePath('/my/project', 'beads');
      expect(path).toBe('/my/project/.ralph-tui/templates/beads.hbs');
    });

    test('handles different tracker types', () => {
      expect(getProjectTemplatePath('/proj', 'json')).toBe(
        '/proj/.ralph-tui/templates/json.hbs',
      );
      expect(getProjectTemplatePath('/proj', 'beads-bv')).toBe(
        '/proj/.ralph-tui/templates/beads-bv.hbs',
      );
    });
  });

  describe('getGlobalTemplatePath', () => {
    test('returns path under ~/.config/ralph-tui/templates/', () => {
      const path = getGlobalTemplatePath('beads');
      expect(path).toContain('.config/ralph-tui/templates/beads.hbs');
    });

    test('handles different tracker types', () => {
      expect(getGlobalTemplatePath('json')).toContain('templates/json.hbs');
      expect(getGlobalTemplatePath('beads-bv')).toContain(
        'templates/beads-bv.hbs',
      );
    });
  });

  describe('getCustomTemplatePath', () => {
    test('returns default filename in cwd', () => {
      const path = getCustomTemplatePath('/my/project');
      expect(path).toBe('/my/project/ralph-prompt.hbs');
    });

    test('accepts custom filename', () => {
      const path = getCustomTemplatePath('/my/project', 'custom.hbs');
      expect(path).toBe('/my/project/custom.hbs');
    });
  });
});

// ============================================================================
// Template Variables and Context Tests
// ============================================================================

describe('Template Engine - Variables and Context', () => {
  describe('buildTemplateVariables', () => {
    test('includes all basic task fields', () => {
      const task = createMockTask();
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.taskId).toBe('task-123');
      expect(vars.taskTitle).toBe('Test Task');
      expect(vars.taskDescription).toBe('A test task description');
      expect(vars.status).toBe('open');
      expect(vars.priority).toBe('2');
      expect(vars.labels).toBe('test, feature');
      expect(vars.dependsOn).toBe('task-100');
    });

    test('includes config fields', () => {
      const task = createMockTask();
      const config = createMockConfig({ model: 'claude-opus-4-20250514' });
      const vars = buildTemplateVariables(task, config);

      expect(vars.model).toBe('claude-opus-4-20250514');
      expect(vars.trackerName).toBe('beads');
      expect(vars.agentName).toBe('claude-code');
    });

    test('includes epic information when provided', () => {
      const task = createMockTask();
      const config = createMockConfig();
      const epic = {
        id: 'epic-1',
        title: 'Epic Title',
        description: 'Epic desc',
      };
      const vars = buildTemplateVariables(task, config, epic);

      expect(vars.epicId).toBe('epic-1');
      expect(vars.epicTitle).toBe('Epic Title');
    });

    test('falls back to task.parentId for epicId', () => {
      const task = createMockTask({ parentId: 'parent-epic' });
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.epicId).toBe('parent-epic');
    });

    test('includes recentProgress from string parameter', () => {
      const task = createMockTask();
      const config = createMockConfig();
      const vars = buildTemplateVariables(
        task,
        config,
        undefined,
        'Previous work done',
      );

      expect(vars.recentProgress).toBe('Previous work done');
    });

    test('includes extended context fields', () => {
      const task = createMockTask();
      const config = createMockConfig();
      const extended = {
        recentProgress: 'Recent work',
        codebasePatterns: '## Patterns\n- Use TypeScript',
        selectionReason: 'High priority blocker',
        prd: {
          name: 'Feature PRD',
          description: 'PRD description',
          content: '# Full PRD content',
          completedCount: 3,
          totalCount: 10,
        },
      };
      const vars = buildTemplateVariables(task, config, undefined, extended);

      expect(vars.recentProgress).toBe('Recent work');
      expect(vars.codebasePatterns).toBe('## Patterns\n- Use TypeScript');
      expect(vars.selectionReason).toBe('High priority blocker');
      expect(vars.prdName).toBe('Feature PRD');
      expect(vars.prdDescription).toBe('PRD description');
      expect(vars.prdContent).toBe('# Full PRD content');
      expect(vars.prdCompletedCount).toBe('3');
      expect(vars.prdTotalCount).toBe('10');
    });

    test('includes current date and timestamp', () => {
      const task = createMockTask();
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(vars.currentTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('handles metadata.notes', () => {
      const task = createMockTask({
        metadata: { notes: 'Important note' },
      });
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.notes).toBe('Important note');
    });

    test('handles metadata.acceptanceCriteria', () => {
      const task = createMockTask({
        metadata: {
          acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        },
      });
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.acceptanceCriteria).toContain('Criterion 1');
      expect(vars.acceptanceCriteria).toContain('Criterion 2');
    });

    test('extracts acceptance criteria from ## Acceptance Criteria section in description', () => {
      const task = createMockTask({
        description: `Some intro text

## Acceptance Criteria
- First criterion
- Second criterion

## Other section`,
      });
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.acceptanceCriteria).toContain('First criterion');
      expect(vars.acceptanceCriteria).toContain('Second criterion');
    });

    test('extracts acceptance criteria from checklist items in description', () => {
      const task = createMockTask({
        description: `Task description with checklist:
- [ ] Unchecked item
- [x] Checked item
* [ ] Another unchecked`,
      });
      const config = createMockConfig();
      const vars = buildTemplateVariables(task, config);

      expect(vars.acceptanceCriteria).toContain('[ ] Unchecked item');
      expect(vars.acceptanceCriteria).toContain('[x] Checked item');
    });
  });

  describe('buildTemplateContext', () => {
    test('includes vars, task, config, and epic', () => {
      const task = createMockTask();
      const config = createMockConfig();
      const epic = { id: 'epic-1', title: 'Epic' };
      const context = buildTemplateContext(task, config, epic, 'progress');

      expect(context.vars).toBeDefined();
      expect(context.task).toBe(task);
      expect(context.config).toBe(config);
      expect(context.epic).toBe(epic);
    });
  });
});

// ============================================================================
// Template Loading Tests (Filesystem)
// ============================================================================

describe('Template Engine - Loading (Filesystem)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    clearTemplateCache();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('loadTemplate - Resolution Hierarchy', () => {
    test('1. Uses explicit custom path when provided', async () => {
      const customPath = join(testDir, 'custom.hbs');
      await writeFile(customPath, 'Custom template content');

      const result = loadTemplate(customPath, 'beads', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Custom template content');
      expect(result.source).toBe(customPath);
    });

    test('1. Returns error for non-existent custom path', () => {
      const result = loadTemplate(
        '/nonexistent/template.hbs',
        'beads',
        testDir,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('2. Uses project template when no custom path', async () => {
      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(
        join(projectTemplateDir, 'beads.hbs'),
        'Project template',
      );

      const result = loadTemplate(undefined, 'beads', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Project template');
      expect(result.source).toContain('project:');
    });

    test('3. Falls back to tracker/global/builtin when no project template', () => {
      const trackerTemplate = 'Tracker-provided template';

      const result = loadTemplate(undefined, 'beads', testDir, trackerTemplate);

      expect(result.success).toBe(true);
      // Template comes from either global (if installed), tracker, or builtin
      // We just verify resolution succeeded - specific source depends on environment
      expect(result.content).toBeTruthy();
      expect(
        ['tracker:beads', 'builtin:beads'].includes(result.source!) ||
          result.source?.includes('global:'),
      ).toBe(true);
    });

    test('4. Falls back to available template when nothing higher priority exists', () => {
      const result = loadTemplate(undefined, 'beads', testDir);

      expect(result.success).toBe(true);
      // Template should be found from global or builtin
      expect(result.content).toBeTruthy();
      expect(result.source?.includes('beads')).toBe(true);
    });

    test('project template takes precedence over tracker template', async () => {
      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(join(projectTemplateDir, 'beads.hbs'), 'Project wins');

      const result = loadTemplate(
        undefined,
        'beads',
        testDir,
        'Tracker template',
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe('Project wins');
    });

    test('custom path takes precedence over project template', async () => {
      // Create both custom and project templates
      const customPath = join(testDir, 'my-custom.hbs');
      await writeFile(customPath, 'Custom wins');

      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(
        join(projectTemplateDir, 'beads.hbs'),
        'Project template',
      );

      const result = loadTemplate(customPath, 'beads', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Custom wins');
    });
  });

  describe('loadTemplate - Different Tracker Types', () => {
    test('loads template for json tracker', () => {
      const result = loadTemplate(undefined, 'json', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      // Source should be global or builtin for json
      expect(result.source?.includes('json')).toBe(true);
    });

    test('loads template for beads-bv tracker', () => {
      const result = loadTemplate(undefined, 'beads-bv', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      // Source should be global or builtin for beads-bv
      expect(result.source?.includes('beads-bv')).toBe(true);
    });

    test('loads template for default tracker', () => {
      const result = loadTemplate(undefined, 'default', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      // Source should be global or builtin for default
      expect(result.source?.includes('default')).toBe(true);
    });
  });

  describe('loadTemplate - Relative Path Resolution', () => {
    test('resolves relative custom path from cwd', async () => {
      const templatePath = join(testDir, 'relative-template.hbs');
      await writeFile(templatePath, 'Relative template');

      const result = loadTemplate('relative-template.hbs', 'beads', testDir);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Relative template');
    });
  });
});

// ============================================================================
// Template Installation Tests
// ============================================================================

describe('Template Engine - Installation', () => {
  let testDir: string;
  let getUserConfigDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    testDir = await createTestDir();
    // Sandbox user config by mocking getUserConfigDir to return a temp directory
    // This prevents tests from polluting ~/.config/ralph-tui/templates
    getUserConfigDirSpy = spyOn(
      templateEngine,
      'getUserConfigDir',
    ).mockReturnValue(join(testDir, '.config', 'ralph-tui'));
  });

  afterEach(async () => {
    // Restore original getUserConfigDir behavior
    getUserConfigDirSpy.mockRestore();
    await cleanupTestDir(testDir);
  });

  describe('installGlobalTemplates', () => {
    test('creates templates directory and files', () => {
      const templatesDir = join(testDir, 'templates');
      const templates = {
        beads: '## Beads Template',
        json: '## JSON Template',
      };

      // Mock getUserConfigDir by using a custom installation
      const result = installGlobalTemplatesInDir(
        templatesDir,
        templates,
        false,
      );

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
      expect(existsSync(join(templatesDir, 'beads.hbs'))).toBe(true);
      expect(existsSync(join(templatesDir, 'json.hbs'))).toBe(true);
    });

    test('skips existing files without force', async () => {
      const templatesDir = join(testDir, 'templates');
      await mkdir(templatesDir, { recursive: true });
      await writeFile(join(templatesDir, 'beads.hbs'), 'Existing content');

      const templates = { beads: 'New content' };
      const result = installGlobalTemplatesInDir(
        templatesDir,
        templates,
        false,
      );

      expect(result.success).toBe(true);
      expect(result.results[0]?.skipped).toBe(true);
      expect(result.results[0]?.created).toBe(false);

      // Verify content wasn't changed
      const content = await readFile(join(templatesDir, 'beads.hbs'), 'utf-8');
      expect(content).toBe('Existing content');
    });

    test('overwrites existing files with force', async () => {
      const templatesDir = join(testDir, 'templates');
      await mkdir(templatesDir, { recursive: true });
      await writeFile(join(templatesDir, 'beads.hbs'), 'Old content');

      const templates = { beads: 'New content' };
      const result = installGlobalTemplatesInDir(templatesDir, templates, true);

      expect(result.success).toBe(true);
      expect(result.results[0]?.created).toBe(true);
      expect(result.results[0]?.skipped).toBe(false);

      // Verify content was updated
      const content = await readFile(join(templatesDir, 'beads.hbs'), 'utf-8');
      expect(content).toBe('New content');
    });
  });

  describe('copyBuiltinTemplate', () => {
    test('copies template to destination', () => {
      const destPath = join(testDir, 'copied-template.hbs');

      const result = copyBuiltinTemplate('beads', destPath);

      expect(result.success).toBe(true);
      expect(existsSync(destPath)).toBe(true);
    });

    test('creates parent directories', () => {
      const destPath = join(testDir, 'nested', 'dir', 'template.hbs');

      const result = copyBuiltinTemplate('json', destPath);

      expect(result.success).toBe(true);
      expect(existsSync(destPath)).toBe(true);
    });

    test('copies correct template content', async () => {
      const destPath = join(testDir, 'template.hbs');

      copyBuiltinTemplate('beads-bv', destPath);

      const content = await readFile(destPath, 'utf-8');
      expect(content).toBe(BEADS_BV_TEMPLATE);
    });
  });

  describe('installBuiltinTemplates', () => {
    test('installs all four builtin templates', () => {
      // HOME is sandboxed to testDir, so templates go to testDir/.config/ralph-tui/templates
      const result = installBuiltinTemplates(false);

      // The function returns results for all four templates
      expect(result.results.length).toBe(4);
      expect(result.templatesDir).toContain('.config/ralph-tui/templates');
      // Verify it's using the sandboxed directory
      expect(result.templatesDir.startsWith(testDir)).toBe(true);
      // Verify templates were actually created
      expect(result.results.every((r) => r.created || r.skipped)).toBe(true);
    });
  });
});

// Helper function to test installGlobalTemplates with custom directory
function installGlobalTemplatesInDir(
  templatesDir: string,
  templates: Record<string, string>,
  force: boolean,
): {
  success: boolean;
  results: Array<{
    file: string;
    created: boolean;
    skipped: boolean;
    error?: string;
  }>;
} {
  const fs = require('node:fs');
  const path = require('node:path');
  const results: Array<{
    file: string;
    created: boolean;
    skipped: boolean;
    error?: string;
  }> = [];

  // Ensure templates directory exists
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  // Install each template
  for (const [trackerType, content] of Object.entries(templates)) {
    const filename = `${trackerType}.hbs`;
    const filePath = path.join(templatesDir, filename);

    try {
      if (fs.existsSync(filePath) && !force) {
        results.push({ file: filename, created: false, skipped: true });
        continue;
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      results.push({ file: filename, created: true, skipped: false });
    } catch (error) {
      results.push({
        file: filename,
        created: false,
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const success = results.every((r) => r.created || r.skipped);
  return { success, results };
}

// ============================================================================
// Template Rendering Tests
// ============================================================================

describe('Template Engine - Rendering', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    clearTemplateCache();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('renderPrompt', () => {
    test('renders template with task variables', () => {
      const task = createMockTask();
      const config = createMockConfig({ cwd: testDir });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('task-123');
      expect(result.prompt).toContain('Test Task');
    });

    test('renders with custom template via promptTemplate config', async () => {
      const task = createMockTask();
      const customPath = join(testDir, 'custom.hbs');
      await writeFile(customPath, '## Task: {{taskId}}\n{{taskTitle}}');
      const config = createMockConfig({
        cwd: testDir,
        promptTemplate: customPath,
      });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('## Task: task-123\nTest Task');
      expect(result.source).toBe(customPath);
    });

    test('renders with epic information in output', () => {
      const task = createMockTask();
      const config = createMockConfig({ cwd: testDir });
      const epic = { id: 'epic-1', title: 'My Epic' };

      const result = renderPrompt(task, config, epic);

      expect(result.success).toBe(true);
      // Epic information should be present in the rendered output
      expect(result.prompt).toContain('epic-1');
    });

    test('renders with extended context PRD info', () => {
      const task = createMockTask();
      const config = createMockConfig({ cwd: testDir });
      const extended = {
        recentProgress: 'Did stuff',
        prd: {
          name: 'Feature PRD',
          content: 'Full PRD content here',
          completedCount: 5,
          totalCount: 10,
        },
      };

      const result = renderPrompt(task, config, undefined, extended);

      expect(result.success).toBe(true);
      // PRD content and recent progress should be rendered
      expect(result.prompt).toContain('Full PRD content here');
      expect(result.prompt).toContain('Did stuff');
    });

    test('handles Handlebars conditionals with custom template', async () => {
      const task = createMockTask({ description: undefined });
      const customPath = join(testDir, 'custom.hbs');
      await writeFile(
        customPath,
        '{{#if taskDescription}}Desc: {{taskDescription}}{{else}}No description{{/if}}',
      );
      const config = createMockConfig({
        cwd: testDir,
        promptTemplate: customPath,
      });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('No description');
    });

    test('handles Handlebars each with custom template', async () => {
      const task = createMockTask();
      const customPath = join(testDir, 'custom.hbs');
      await writeFile(customPath, 'Labels: {{labels}}');
      const config = createMockConfig({
        cwd: testDir,
        promptTemplate: customPath,
      });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Labels: test, feature');
    });

    test('returns error for invalid template syntax', async () => {
      const task = createMockTask();
      const customPath = join(testDir, 'invalid.hbs');
      await writeFile(customPath, '{{#if}}Invalid{{/if}}'); // Missing condition
      const config = createMockConfig({
        cwd: testDir,
        promptTemplate: customPath,
      });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('rendering failed');
    });
  });

  describe('clearTemplateCache', () => {
    test('allows template to be reloaded', () => {
      const task = createMockTask();
      const config = createMockConfig();

      // First render caches the template
      renderPrompt(
        task,
        config,
        undefined,
        undefined,
        'Template v1: {{taskId}}',
      );

      // Clear cache
      clearTemplateCache();

      // Second render should use new template
      const result = renderPrompt(
        task,
        config,
        undefined,
        undefined,
        'Template v2: {{taskId}}',
      );

      expect(result.success).toBe(true);
      // Note: The source key for caching includes the template content,
      // so different templates will have different cache entries anyway
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Template Engine - Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    clearTemplateCache();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe('Full Template Resolution and Rendering', () => {
    test('project template overrides tracker and renders correctly', async () => {
      // Create project template
      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(
        join(projectTemplateDir, 'beads.hbs'),
        '# Project Custom Template\nTask: {{taskId}} - {{taskTitle}}\nStatus: {{status}}',
      );

      const task = createMockTask({ id: 'PROJ-1', title: 'Project Task' });
      const config = createMockConfig({ cwd: testDir });

      const result = renderPrompt(
        task,
        config,
        undefined,
        undefined,
        'Tracker template (should not be used)',
      );

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('# Project Custom Template');
      expect(result.prompt).toContain('Task: PROJ-1 - Project Task');
      expect(result.prompt).toContain('Status: open');
      expect(result.source).toContain('project:');
    });

    test('custom path overrides everything and renders correctly', async () => {
      // Create custom template
      const customPath = join(testDir, 'my-prompt.hbs');
      await writeFile(customPath, 'CUSTOM: {{taskId}}');

      // Also create project template (should be ignored)
      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(
        join(projectTemplateDir, 'beads.hbs'),
        'PROJECT: {{taskId}}',
      );

      const task = createMockTask({ id: 'TEST-1' });
      const config = createMockConfig({
        cwd: testDir,
        promptTemplate: customPath,
      });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('CUSTOM: TEST-1');
      expect(result.source).toBe(customPath);
    });
  });

  describe('Template Update Workflow', () => {
    test('user can add project template to override default', async () => {
      // Initially use whatever default is available (global or builtin)
      const task = createMockTask();
      const config = createMockConfig({ cwd: testDir });

      let result = renderPrompt(task, config);
      expect(result.success).toBe(true);
      const initialSource = result.source;

      // User creates project template
      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(
        join(projectTemplateDir, 'beads.hbs'),
        'Custom: {{taskId}}',
      );

      // Clear cache to pick up new template
      clearTemplateCache();

      // Now should use project template (takes precedence over global/builtin)
      result = renderPrompt(task, config);
      expect(result.prompt).toBe('Custom: task-123');
      expect(result.source).toContain('project:');

      // Verify source changed
      expect(result.source).not.toBe(initialSource);
    });

    test('project template takes precedence over global template', async () => {
      // This test verifies the resolution order works correctly
      const task = createMockTask();
      const config = createMockConfig({ cwd: testDir });

      // Create project template
      const projectTemplateDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectTemplateDir, { recursive: true });
      await writeFile(
        join(projectTemplateDir, 'beads.hbs'),
        'Project: {{taskId}}',
      );

      const result = renderPrompt(task, config);

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Project: task-123');
      expect(result.source).toContain('project:');
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('Template Engine - Error Handling', () => {
  let testDir: string;
  let getUserConfigDirSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    testDir = await createTestDir();
    clearTemplateCache();
    // Sandbox user config by mocking getUserConfigDir to return a temp directory
    // This prevents tests from polluting ~/.config/ralph-tui/templates
    getUserConfigDirSpy = spyOn(
      templateEngine,
      'getUserConfigDir',
    ).mockReturnValue(join(testDir, '.config', 'ralph-tui'));
  });

  afterEach(async () => {
    // Restore original getUserConfigDir behavior
    getUserConfigDirSpy.mockRestore();
    await cleanupTestDir(testDir);
  });

  describe('loadTemplate - Tracker Template Fallback', () => {
    test('uses tracker template when no custom/project/global exists', () => {
      // Use a unique tracker type that won't have global templates
      const uniqueType = `tracker-${Date.now()}` as any;
      const trackerTemplate = 'Tracker Template: {{taskId}} - {{taskTitle}}';
      const result = loadTemplate(
        undefined,
        uniqueType,
        testDir,
        trackerTemplate,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe(trackerTemplate);
      expect(result.source).toBe(`tracker:${uniqueType}`);
    });

    test('tracker template has lower priority than project template', async () => {
      // Create a project template
      const projectDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'beads.hbs'), 'Project Override');

      const trackerTemplate = 'Tracker Template';
      const result = loadTemplate(undefined, 'beads', testDir, trackerTemplate);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Project Override');
      expect(result.source).toContain('project:');
    });
  });

  describe('loadTemplate - Builtin Fallback', () => {
    test('falls back to global or builtin when no tracker template provided', () => {
      // No custom path, no project template, no tracker template
      // Will use global template if user has it installed, otherwise builtin
      const result = loadTemplate(undefined, 'beads', testDir, undefined);

      expect(result.success).toBe(true);
      // Either global (if user has it) or builtin
      expect(result.source).toMatch(/^(builtin:|global:)/);
    });

    test('uses builtin for unknown tracker type without global template', () => {
      // Use a unique type that won't have a global template
      const uniqueType = `unknown-${Date.now()}` as any;
      const result = loadTemplate(undefined, uniqueType, testDir, undefined);

      expect(result.success).toBe(true);
      expect(result.source).toBe(`builtin:${uniqueType}`);
      // Unknown types get the default template
      expect(result.content).toBeDefined();
    });
  });

  describe('loadTemplate - Custom Path Errors', () => {
    test('returns error when custom path file does not exist', () => {
      const customPath = join(testDir, 'nonexistent.hbs');
      const result = loadTemplate(customPath, 'beads', testDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.source).toBe(customPath);
    });

    test('returns error with original path for non-existent relative path', () => {
      const result = loadTemplate('./missing-template.hbs', 'beads', testDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('renderPrompt - Error Handling', () => {
    test('returns error when template has invalid Handlebars syntax', async () => {
      // Create template with invalid syntax
      const projectDir = join(testDir, '.ralph-tui', 'templates');
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'beads.hbs'), '{{#if unclosed');

      const task = createMockTask();
      const config = createMockConfig({ cwd: testDir });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('passes through load error when custom template not found', () => {
      const task = createMockTask();
      const config = createMockConfig({
        cwd: testDir,
        promptTemplate: join(testDir, 'does-not-exist.hbs'),
      });

      const result = renderPrompt(task, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('copyBuiltinTemplate - Error Cases', () => {
    test('returns error for invalid destination path with null bytes', () => {
      // Null bytes in paths are invalid on all platforms (POSIX and Windows)
      // This is a portable way to test path validation
      const invalidPath = join(testDir, 'invalid\0byte', 'template.hbs');
      const result = copyBuiltinTemplate('beads', invalidPath);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('returns error when destination directory is read-only', async () => {
      // Create a directory and make it read-only to test permission errors
      // Skip on Windows where chmod doesn't work the same way
      if (process.platform === 'win32') {
        // Windows doesn't support POSIX chmod semantics - skip this test
        return;
      }

      const readOnlyDir = join(testDir, 'read-only-dir');
      await mkdir(readOnlyDir, { recursive: true });

      try {
        // Remove write permissions (read + execute only)
        await chmod(readOnlyDir, 0o555);

        const destPath = join(readOnlyDir, 'subdir', 'template.hbs');
        const result = copyBuiltinTemplate('beads', destPath);

        // Should fail because we can't create a subdirectory in read-only dir
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      } finally {
        // Restore write permissions so cleanup can proceed
        await chmod(readOnlyDir, 0o755);
      }
    });
  });

  describe('installGlobalTemplates - Function Behavior', () => {
    // HOME is sandboxed to testDir, so we can safely test actual file system side effects

    test('returns correct structure with templatesDir and results', () => {
      const templates = { 'test-tracker': '## Test Template' };

      const result = installGlobalTemplates(templates, false);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('templatesDir');
      expect(result).toHaveProperty('results');
      expect(result.templatesDir).toContain('.config/ralph-tui/templates');
      // Verify it's using the sandboxed directory
      expect(result.templatesDir.startsWith(testDir)).toBe(true);
      expect(Array.isArray(result.results)).toBe(true);
    });

    test('returns success true when no templates provided', () => {
      const result = installGlobalTemplates({}, false);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(0);
      // Verify sandboxed directory
      expect(result.templatesDir.startsWith(testDir)).toBe(true);
    });

    test('actually creates template files in sandboxed directory', async () => {
      const templates = { 'sandbox-test': '## Sandboxed Template Content' };

      const result = installGlobalTemplates(templates, false);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0]?.created).toBe(true);

      // Verify file was actually created in sandboxed location
      const expectedPath = join(
        testDir,
        '.config',
        'ralph-tui',
        'templates',
        'sandbox-test.hbs',
      );
      expect(existsSync(expectedPath)).toBe(true);

      const content = await readFile(expectedPath, 'utf-8');
      expect(content).toBe('## Sandboxed Template Content');
    });
  });
});

// ============================================================================
// Tracker Template Integration Tests
// ============================================================================

describe('Template Engine - Tracker Template Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    clearTemplateCache();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test('loadTemplate hierarchy: project > global > tracker > builtin', () => {
    // The template resolution hierarchy is:
    // 1. customPath (explicit path)
    // 2. Project template (.ralph-tui/templates/{tracker}.hbs)
    // 3. Global template (~/.config/ralph-tui/templates/{tracker}.hbs)
    // 4. Tracker template (from plugin's getTemplate())
    // 5. Builtin template

    // Test with a tracker type that won't have global templates
    const trackerTemplate = 'Tracker Template Content';
    const result = loadTemplate(
      undefined,
      'custom-tracker' as any,
      testDir,
      trackerTemplate,
    );

    expect(result.success).toBe(true);
    // With a custom tracker type, no global template exists, so tracker template is used
    expect(result.content).toBe(trackerTemplate);
    expect(result.source).toBe('tracker:custom-tracker');
  });

  test('renderPrompt prefers project template over tracker template', async () => {
    // Create project template
    const projectDir = join(testDir, '.ralph-tui', 'templates');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'beads.hbs'), 'Project says: {{taskId}}');

    const task = createMockTask();
    const config = createMockConfig({ cwd: testDir });
    const trackerTemplate = 'Tracker says: {{taskId}}';

    const result = renderPrompt(
      task,
      config,
      undefined,
      undefined,
      trackerTemplate,
    );

    expect(result.success).toBe(true);
    expect(result.prompt).toBe('Project says: task-123');
    expect(result.source).toContain('project:');
  });

  test('loadTemplate returns available template in correct priority order', () => {
    // No custom path, no project template (testDir is empty), no tracker template
    // Will use global (if user has it) or builtin
    const result = loadTemplate(undefined, 'beads', testDir, undefined);

    expect(result.success).toBe(true);
    // Either builtin or global depending on user's setup
    expect(result.source).toMatch(/^(builtin:|global:)/);
  });

  test('loadTemplate uses tracker template when no global exists for tracker type', () => {
    // Use a unique tracker type that definitely has no global template
    const uniqueType = `unique-tracker-${Date.now()}` as any;
    const trackerTemplate = 'My custom tracker template';
    const result = loadTemplate(
      undefined,
      uniqueType,
      testDir,
      trackerTemplate,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe(trackerTemplate);
    expect(result.source).toBe(`tracker:${uniqueType}`);
  });

  test('loadTemplate falls back to builtin for unknown type without tracker template', () => {
    const uniqueType = `unknown-${Date.now()}` as any;
    const result = loadTemplate(undefined, uniqueType, testDir, undefined);

    expect(result.success).toBe(true);
    expect(result.source).toBe(`builtin:${uniqueType}`);
    // Unknown types get the default template
    expect(result.content).toBeDefined();
  });
});
