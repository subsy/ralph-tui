/**
 * ABOUTME: Tests for the GitHub Copilot CLI plugin.
 * Tests configuration, argument building, and setup for GitHub Copilot agent.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

// Mock child_process
class MockChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = { write: () => { }, end: () => { } };
    kill = () => { };
    unref = () => { };
}

let currentMockProcess: MockChildProcess;

mock.module('node:child_process', () => ({
    spawn: () => {
        currentMockProcess = new MockChildProcess();
        return currentMockProcess;
    }
}));

import { GithubCopilotAgentPlugin } from './github-copilot.js';

describe('GithubCopilotAgentPlugin', () => {
    let plugin: GithubCopilotAgentPlugin;

    beforeEach(() => {
        plugin = new GithubCopilotAgentPlugin();
    });

    afterEach(async () => {
        await plugin.dispose();
    });

    describe('meta', () => {
        test('has correct plugin ID', () => {
            expect(plugin.meta.id).toBe('github-copilot');
        });

        test('has correct name', () => {
            expect(plugin.meta.name).toBe('GitHub Copilot');
        });

        test('has correct default command', () => {
            expect(plugin.meta.defaultCommand).toBe('copilot');
        });

        test('supports streaming', () => {
            expect(plugin.meta.supportsStreaming).toBe(true);
        });

        test('supports interrupt', () => {
            expect(plugin.meta.supportsInterrupt).toBe(true);
        });

        test('does not support file context', () => {
            expect(plugin.meta.supportsFileContext).toBe(false);
        });

        test('does not support subagent tracing', () => {
            expect(plugin.meta.supportsSubagentTracing).toBe(false);
        });

        test('has no structured output format', () => {
            expect(plugin.meta.structuredOutputFormat).toBe(undefined);
        });
    });

    describe('initialize', () => {
        test('initializes with default config', async () => {
            await plugin.initialize({});
            expect(await plugin.isReady()).toBe(true);
        });

        test('accepts model configuration', async () => {
            await plugin.initialize({ model: 'gpt-4' });
            expect(await plugin.isReady()).toBe(true);
        });

        test('accepts autoApprove configuration', async () => {
            await plugin.initialize({ autoApprove: false });
            expect(await plugin.isReady()).toBe(true);
        });

        test('accepts timeout configuration', async () => {
            await plugin.initialize({ timeout: 300000 });
            expect(await plugin.isReady()).toBe(true);
        });
    });

    describe('getSetupQuestions', () => {
        test('includes model question', () => {
            const questions = plugin.getSetupQuestions();
            const modelQuestion = questions.find((q: { id: string }) => q.id === 'model');
            expect(modelQuestion).toBeDefined();
            expect(modelQuestion?.type).toBe('text');
        });

        test('includes autoApprove question', () => {
            const questions = plugin.getSetupQuestions();
            const autoApproveQuestion = questions.find((q: { id: string }) => q.id === 'autoApprove');
            expect(autoApproveQuestion).toBeDefined();
            expect(autoApproveQuestion?.type).toBe('boolean');
            expect(autoApproveQuestion?.default).toBe(true);
        });

        test('includes base questions (command, timeout)', () => {
            const questions = plugin.getSetupQuestions();
            expect(questions.find((q: { id: string }) => q.id === 'command')).toBeDefined();
            expect(questions.find((q: { id: string }) => q.id === 'timeout')).toBeDefined();
        });
    });

    describe('validateSetup', () => {
        test('accepts empty config', async () => {
            const result = await plugin.validateSetup({});
            expect(result).toBeNull();
        });

        test('accepts valid config', async () => {
            const result = await plugin.validateSetup({ model: 'gpt-4', autoApprove: true });
            expect(result).toBeNull();
        });
    });

    describe('validateModel', () => {
        test('accepts any model', () => {
            expect(plugin.validateModel('gpt-4')).toBeNull();
            expect(plugin.validateModel('gpt-3.5-turbo')).toBeNull();
            expect(plugin.validateModel('custom-model')).toBeNull();
        });

        test('accepts empty model', () => {
            expect(plugin.validateModel('')).toBeNull();
        });
    });

    describe('getSandboxRequirements', () => {
        test('includes github-copilot auth paths', () => {
            const requirements = plugin.getSandboxRequirements();
            expect(requirements.authPaths).toContain('~/.config/github-copilot');
            expect(requirements.authPaths).toContain('~/.config/gh');
            expect(requirements.authPaths).toContain('~/.gitconfig');
        });

        test('requires network', () => {
            const requirements = plugin.getSandboxRequirements();
            expect(requirements.requiresNetwork).toBe(true);
        });
    });
});

describe('GithubCopilotAgentPlugin buildArgs', () => {
    let plugin: GithubCopilotAgentPlugin;

    // Create a test subclass to access protected method
    class TestableGithubCopilotPlugin extends GithubCopilotAgentPlugin {
        testBuildArgs(prompt: string): string[] {
            return (this as unknown as { buildArgs: (p: string) => string[] }).buildArgs(prompt);
        }

        testGetStdinInput(prompt: string): string | undefined {
            return (this as unknown as { getStdinInput: (p: string) => string | undefined }).getStdinInput(prompt);
        }
    }

    beforeEach(() => {
        plugin = new TestableGithubCopilotPlugin();
    });

    afterEach(async () => {
        await plugin.dispose();
    });

    test('includes --yolo by default', async () => {
        await plugin.initialize({});
        const args = (plugin as TestableGithubCopilotPlugin).testBuildArgs('test prompt');
        expect(args).toContain('--yolo');
    });

    test('omits --yolo when autoApprove is disabled', async () => {
        await plugin.initialize({ autoApprove: false });
        const args = (plugin as TestableGithubCopilotPlugin).testBuildArgs('test prompt');
        expect(args).not.toContain('--yolo');
    });

    test('includes model flag when specified', async () => {
        await plugin.initialize({ model: 'gpt-4' });
        const args = (plugin as TestableGithubCopilotPlugin).testBuildArgs('test prompt');
        expect(args).toContain('--model');
        expect(args).toContain('gpt-4');
    });

    test('omits model flag when not specified', async () => {
        await plugin.initialize({});
        const args = (plugin as TestableGithubCopilotPlugin).testBuildArgs('test prompt');
        expect(args).not.toContain('--model');
    });

    test('returns prompt via stdin', async () => {
        await plugin.initialize({});
        const stdinInput = (plugin as TestableGithubCopilotPlugin).testGetStdinInput('my test prompt');
        expect(stdinInput).toBe('my test prompt');
    });
});

describe('GithubCopilotAgentPlugin runVersion', () => {
    let plugin: GithubCopilotAgentPlugin;

    beforeEach(() => {
        plugin = new GithubCopilotAgentPlugin();
    });

    afterEach(async () => {
        await plugin.dispose();
    });

    test('extracts version from successful output', async () => {
        const promise = (plugin as any).runVersion('copilot');

        // Wait for process to be created
        // We need next tick or similar because runVersion calls spawn immediately
        // but we need to reference currentMockProcess which is set by side-effect
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(currentMockProcess).toBeDefined();

        // Emit output and close behavior
        // The implementation accumulates stdout
        currentMockProcess.stdout.emit('data', Buffer.from('copilot version 1.0.0\n'));
        currentMockProcess.emit('close', 0);

        const result = await promise;
        expect(result.success).toBe(true);
        expect(result.version).toBe('1.0.0');
    });

    test('handles parse failure', async () => {
        const promise = (plugin as any).runVersion('copilot');

        await new Promise(resolve => setTimeout(resolve, 0));

        currentMockProcess.stdout.emit('data', Buffer.from('unexpected output\n'));
        currentMockProcess.emit('close', 0);

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('Unable to parse');
    });

    test('handles non-zero exit code', async () => {
        const promise = (plugin as any).runVersion('copilot');

        await new Promise(resolve => setTimeout(resolve, 0));

        currentMockProcess.stderr.emit('data', Buffer.from('command failed\n'));
        currentMockProcess.emit('close', 1);

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('command failed');
    });

    test('handles spawn error', async () => {
        const promise = (plugin as any).runVersion('copilot');

        await new Promise(resolve => setTimeout(resolve, 0));

        currentMockProcess.emit('error', new Error('spawn failed'));

        const result = await promise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('spawn failed');
    });
});
