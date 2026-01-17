/**
 * ABOUTME: Tests for the template engine, focusing on template variable building.
 */

import { describe, test, expect } from 'bun:test';
import * as path from 'node:path';
import { buildTemplateVariables } from './engine.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';

describe('buildTemplateVariables', () => {
  const createMinimalTask = (overrides: Partial<TrackerTask> = {}): TrackerTask => ({
    id: 'test-001',
    title: 'Test Task',
    status: 'open',
    priority: 2,
    ...overrides,
  });

  describe('beadsDbPath computation', () => {
    test('uses tracker workingDir when provided', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {
        tracker: {
          name: 'default',
          plugin: 'beads',
          options: {
            workingDir: '/custom/project',
          },
        },
        cwd: '/fallback/cwd',
      };

      const vars = buildTemplateVariables(task, config);

      expect(vars.beadsDbPath).toBe(path.join('/custom/project', '.beads', 'beads.db'));
    });

    test('uses custom beadsDir when provided', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {
        tracker: {
          name: 'default',
          plugin: 'beads',
          options: {
            workingDir: '/project',
            beadsDir: '.custom-beads',
          },
        },
      };

      const vars = buildTemplateVariables(task, config);

      expect(vars.beadsDbPath).toBe(path.join('/project', '.custom-beads', 'beads.db'));
    });

    test('falls back to config.cwd when tracker workingDir not set', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {
        tracker: {
          name: 'default',
          plugin: 'beads',
          options: {},
        },
        cwd: '/config/cwd',
      };

      const vars = buildTemplateVariables(task, config);

      expect(vars.beadsDbPath).toBe(path.join('/config/cwd', '.beads', 'beads.db'));
    });

    test('falls back to process.cwd when no paths configured', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {
        tracker: {
          name: 'default',
          plugin: 'beads',
          options: {},
        },
      };

      const vars = buildTemplateVariables(task, config);

      // Should use process.cwd() as fallback
      expect(vars.beadsDbPath).toBe(path.join(process.cwd(), '.beads', 'beads.db'));
    });

    test('handles empty config gracefully', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {};

      const vars = buildTemplateVariables(task, config);

      // Should use process.cwd() as ultimate fallback
      expect(vars.beadsDbPath).toBe(path.join(process.cwd(), '.beads', 'beads.db'));
    });
  });

  describe('basic template variables', () => {
    test('includes task fields in output', () => {
      const task = createMinimalTask({
        id: 'beads-123',
        title: 'Implement feature X',
        description: 'Full description here',
        labels: ['frontend', 'urgent'],
        priority: 1,
        status: 'in_progress',
      });
      const config: Partial<RalphConfig> = {
        tracker: { name: 'default', plugin: 'beads', options: {} },
        model: 'claude-sonnet',
        cwd: '/test/project',
      };

      const vars = buildTemplateVariables(task, config);

      expect(vars.taskId).toBe('beads-123');
      expect(vars.taskTitle).toBe('Implement feature X');
      expect(vars.taskDescription).toBe('Full description here');
      expect(vars.labels).toBe('frontend, urgent');
      expect(vars.priority).toBe('1');
      expect(vars.status).toBe('in_progress');
      expect(vars.trackerName).toBe('beads');
      expect(vars.model).toBe('claude-sonnet');
      expect(vars.cwd).toBe('/test/project');
    });

    test('handles optional fields with defaults', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {};

      const vars = buildTemplateVariables(task, config);

      expect(vars.taskDescription).toBe('');
      expect(vars.labels).toBe('');
      expect(vars.dependsOn).toBe('');
      expect(vars.blocks).toBe('');
      expect(vars.epicId).toBe('');
      expect(vars.epicTitle).toBe('');
      expect(vars.notes).toBe('');
      expect(vars.recentProgress).toBe('');
    });

    test('includes epic information when provided', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {};
      const epic = {
        id: 'epic-001',
        title: 'Big Feature Epic',
        description: 'Epic description',
      };

      const vars = buildTemplateVariables(task, config, epic);

      expect(vars.epicId).toBe('epic-001');
      expect(vars.epicTitle).toBe('Big Feature Epic');
    });

    test('includes recent progress when provided', () => {
      const task = createMinimalTask();
      const config: Partial<RalphConfig> = {};

      const vars = buildTemplateVariables(task, config, undefined, 'Completed step 1 and 2');

      expect(vars.recentProgress).toBe('Completed step 1 and 2');
    });
  });
});
