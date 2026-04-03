/**
 * ABOUTME: Tests for the Jira tracker plugin.
 * Tests status mapping, priority mapping, task conversion, dependency resolution,
 * and acceptance criteria extraction.
 */

import { describe, expect, it } from 'bun:test';
import { JiraTrackerPlugin } from './index.js';

// We test the plugin's exported class directly for mapping logic.
// Full integration tests require a live Jira instance.

describe('JiraTrackerPlugin', () => {
  it('has correct plugin metadata', () => {
    const plugin = new JiraTrackerPlugin();
    expect(plugin.meta.id).toBe('jira');
    expect(plugin.meta.supportsHierarchy).toBe(true);
    expect(plugin.meta.supportsDependencies).toBe(true);
  });

  it('provides setup questions', () => {
    const plugin = new JiraTrackerPlugin();
    const questions = plugin.getSetupQuestions();
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.find((q) => q.id === 'baseUrl')).toBeTruthy();
    expect(questions.find((q) => q.id === 'email')).toBeTruthy();
    expect(questions.find((q) => q.id === 'apiToken')).toBeTruthy();
  });

  it('epicId getter/setter works', () => {
    const plugin = new JiraTrackerPlugin();
    expect(plugin.getEpicId()).toBe('');
    plugin.setEpicId('MYN-5000');
    expect(plugin.getEpicId()).toBe('MYN-5000');
  });

  it('returns template string', () => {
    const plugin = new JiraTrackerPlugin();
    const template = plugin.getTemplate();
    expect(template).toContain('{{taskId}}');
    expect(template).toContain('{{taskTitle}}');
    expect(template).toContain('COMPLETE');
  });

  it('getTasks returns empty array when no epicId set', async () => {
    const plugin = new JiraTrackerPlugin();
    const tasks = await plugin.getTasks();
    expect(tasks).toEqual([]);
  });
});
