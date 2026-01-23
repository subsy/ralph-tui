/**
 * ABOUTME: Tests for the chat engine PRD prompt building.
 * Verifies the PRD compatibility guidance instructs plain-text descriptions,
 * and that buildPrompt uses markdown formatting (not XML tags) for CLI agent compatibility.
 */

import { describe, test, expect } from 'bun:test';
import { ChatEngine, buildPrdSystemPromptFromSkillSource } from './engine.js';
import type { AgentPlugin, AgentExecutionHandle, AgentExecutionResult, AgentPluginMeta } from '../plugins/agents/types.js';

describe('buildPrdSystemPromptFromSkillSource', () => {
  test('includes plain text description guidance', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('Plain text description');
  });

  test('instructs against **Description:** prefix', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('no **Description:** prefix');
  });

  test('does NOT include **Description:** as the recommended format', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    // Should not show the old format that caused parsing issues
    expect(result).not.toContain('"**Description:** As a user');
  });

  test('includes guidance when skill source is provided', () => {
    const skillSource = '---\ntitle: My Skill\n---\nSome skill instructions.';
    const result = buildPrdSystemPromptFromSkillSource(skillSource);
    expect(result).toContain('Some skill instructions.');
    expect(result).toContain('Plain text description');
    expect(result).toContain('no **Description:** prefix');
  });

  test('includes US-001 header format guidance', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('### US-001: Title');
  });

  test('includes acceptance criteria format guidance', () => {
    const result = buildPrdSystemPromptFromSkillSource('');
    expect(result).toContain('**Acceptance Criteria:**');
  });
});

/**
 * Create a mock agent that captures the prompt passed to execute().
 */
function createMockAgent(responseText = 'mock response'): {
  agent: AgentPlugin;
  getCapturedPrompt: () => string | undefined;
} {
  let capturedPrompt: string | undefined;

  const meta: AgentPluginMeta = {
    id: 'mock',
    name: 'Mock',
    description: 'Mock agent for testing',
    version: '1.0.0',
    defaultCommand: 'mock',
    supportsStreaming: false,
    supportsInterrupt: false,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  const agent: AgentPlugin = {
    meta,
    initialize: async () => {},
    isReady: async () => true,
    detect: async () => ({ available: true }),
    execute: (prompt: string, _files?, options?) => {
      capturedPrompt = prompt;
      const result: AgentExecutionResult = {
        executionId: 'mock-exec',
        status: 'completed',
        exitCode: 0,
        stdout: responseText,
        stderr: '',
        durationMs: 10,
        interrupted: false,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      };
      // Deliver output via onStdout callback if provided
      if (options?.onStdout) {
        options.onStdout(responseText);
      }
      const handle: AgentExecutionHandle = {
        executionId: 'mock-exec',
        promise: Promise.resolve(result),
        interrupt: () => {},
        isRunning: () => false,
      };
      return handle;
    },
    interrupt: () => false,
    interruptAll: () => {},
    getCurrentExecution: () => undefined,
    dispose: async () => {},
    getSetupQuestions: () => [],
    validateSetup: async () => null,
    validateModel: () => null,
    getSandboxRequirements: () => ({
      authPaths: [],
      binaryPaths: [],
      runtimePaths: [],
      requiresNetwork: false,
    }),
    preflight: async () => ({ success: true, durationMs: 0 }),
  };

  return { agent, getCapturedPrompt: () => capturedPrompt };
}

describe('ChatEngine buildPrompt format', () => {
  test('uses markdown ## Instructions header instead of XML <system> tags', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'You are a helpful assistant.',
    });

    await engine.sendMessage('Hello');

    const prompt = getCapturedPrompt()!;
    expect(prompt).toContain('## Instructions');
    expect(prompt).not.toContain('<system>');
    expect(prompt).not.toContain('</system>');
  });

  test('includes system prompt content after ## Instructions header', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const systemPrompt = 'Generate a PRD with user stories.';
    const engine = new ChatEngine({ agent, systemPrompt });

    await engine.sendMessage('Build a login page');

    const prompt = getCapturedPrompt()!;
    expect(prompt).toContain('## Instructions\n');
    expect(prompt).toContain(systemPrompt);
  });

  test('uses ## Current Request header for user message instead of User: prefix', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test prompt.',
    });

    await engine.sendMessage('Build a dashboard');

    const prompt = getCapturedPrompt()!;
    expect(prompt).toContain('## Current Request\n');
    expect(prompt).toContain('Build a dashboard');
  });

  test('does not end with bare Assistant: marker', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test prompt.',
    });

    await engine.sendMessage('Hello');

    const prompt = getCapturedPrompt()!;
    expect(prompt.trimEnd()).not.toMatch(/Assistant:$/);
  });

  test('does not use XML <conversation> tags for history', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test prompt.',
    });

    // Send first message to build history
    await engine.sendMessage('First message');
    // Send second message - now there's history
    await engine.sendMessage('Second message');

    const prompt = getCapturedPrompt()!;
    expect(prompt).not.toContain('<conversation>');
    expect(prompt).not.toContain('</conversation>');
  });

  test('includes ## Conversation History header when history exists', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test prompt.',
    });

    await engine.sendMessage('First message');
    await engine.sendMessage('Second message');

    const prompt = getCapturedPrompt()!;
    expect(prompt).toContain('## Conversation History\n');
  });

  test('includes current user message in conversation history on first send', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test prompt.',
    });

    await engine.sendMessage('First message');

    const prompt = getCapturedPrompt()!;
    // The current user message is pushed to this.messages before buildPrompt runs,
    // so it appears in conversation history even on the first message
    expect(prompt).toContain('## Conversation History');
    expect(prompt).toContain('User: First message');
  });

  test('includes User: and Assistant: role prefixes in conversation history', async () => {
    const { agent, getCapturedPrompt } = createMockAgent('I can help with that.');
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test prompt.',
    });

    await engine.sendMessage('Help me build a feature');
    await engine.sendMessage('What about testing?');

    const prompt = getCapturedPrompt()!;
    expect(prompt).toContain('User: Help me build a feature');
    expect(prompt).toContain('Assistant: I can help with that.');
  });

  test('prompt sections appear in correct order: Instructions, History, Current Request', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'System instructions here.',
    });

    await engine.sendMessage('First');
    await engine.sendMessage('Second');

    const prompt = getCapturedPrompt()!;
    const instructionsIdx = prompt.indexOf('## Instructions');
    const historyIdx = prompt.indexOf('## Conversation History');
    const requestIdx = prompt.indexOf('## Current Request');

    expect(instructionsIdx).toBeGreaterThanOrEqual(0);
    expect(historyIdx).toBeGreaterThan(instructionsIdx);
    expect(requestIdx).toBeGreaterThan(historyIdx);
  });

  test('respects maxHistoryMessages limit', async () => {
    const { agent, getCapturedPrompt } = createMockAgent();
    const engine = new ChatEngine({
      agent,
      systemPrompt: 'Test.',
      maxHistoryMessages: 2,
    });

    // Send 3 messages to exceed the limit
    // After each send, messages grows: [user1, assistant1, user2, assistant2, user3]
    // With maxHistoryMessages=2, slice(-2) gives the last 2 entries
    await engine.sendMessage('Message 1');
    await engine.sendMessage('Message 2');
    await engine.sendMessage('Message 3');

    const prompt = getCapturedPrompt()!;
    // Only the last 2 messages from history should be included
    expect(prompt).not.toContain('User: Message 1');
    expect(prompt).not.toContain('User: Message 2');
    // Current user message (Message 3) is in history (pushed before buildPrompt)
    expect(prompt).toContain('User: Message 3');
  });
});
