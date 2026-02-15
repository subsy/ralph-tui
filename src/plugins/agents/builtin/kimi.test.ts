/**
 * ABOUTME: Tests for the Kimi CLI agent plugin.
 * Tests configuration, argument building, and JSONL parsing for Moonshot AI's Kimi CLI.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
    KimiAgentPlugin,
    parseKimiJsonLine,
    parseKimiOutputToEvents,
} from './kimi.js';

describe('KimiAgentPlugin', () => {
    let plugin: KimiAgentPlugin;

    beforeEach(() => {
        plugin = new KimiAgentPlugin();
    });

    afterEach(async () => {
        await plugin.dispose();
    });

    describe('meta', () => {
        test('has correct plugin ID', () => {
            expect(plugin.meta.id).toBe('kimi');
        });

        test('has correct name', () => {
            expect(plugin.meta.name).toBe('Kimi CLI');
        });

        test('has correct default command', () => {
            expect(plugin.meta.defaultCommand).toBe('kimi');
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

        test('supports subagent tracing', () => {
            expect(plugin.meta.supportsSubagentTracing).toBe(true);
        });

        test('has JSONL structured output format', () => {
            expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
        });

        test('has skills paths configured', () => {
            expect(plugin.meta.skillsPaths?.personal).toBe('~/.kimi/skills');
            expect(plugin.meta.skillsPaths?.repo).toBe('.kimi/skills');
        });
    });

    describe('initialize', () => {
        test('initializes with default config', async () => {
            await plugin.initialize({});
            expect(await plugin.isReady()).toBe(true);
        });

        test('accepts model configuration', async () => {
            await plugin.initialize({ model: 'kimi-k2-0711' });
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
            const modelQuestion = questions.find((q) => q.id === 'model');
            expect(modelQuestion).toBeDefined();
            expect(modelQuestion?.type).toBe('text');
            expect(modelQuestion?.required).toBe(false);
        });

        test('includes base questions (command, timeout)', () => {
            const questions = plugin.getSetupQuestions();
            expect(questions.find((q) => q.id === 'command')).toBeDefined();
            expect(questions.find((q) => q.id === 'timeout')).toBeDefined();
        });
    });

    describe('validateSetup', () => {
        test('accepts valid kimi model', async () => {
            const result = await plugin.validateSetup({ model: 'kimi-k2-0711' });
            expect(result).toBeNull();
        });

        test('accepts empty model', async () => {
            const result = await plugin.validateSetup({ model: '' });
            expect(result).toBeNull();
        });

        test('accepts any model name (no validation)', async () => {
            const result = await plugin.validateSetup({ model: 'any-model-name' });
            expect(result).toBeNull();
        });
    });
});

describe('KimiAgentPlugin buildArgs', () => {
    let plugin: KimiAgentPlugin;

    // Create a test subclass to access protected method
    class TestableKimiPlugin extends KimiAgentPlugin {
        testBuildArgs(prompt: string): string[] {
            return (this as unknown as { buildArgs: (p: string) => string[] }).buildArgs(prompt);
        }

        testGetStdinInput(prompt: string): string | undefined {
            return (this as unknown as { getStdinInput: (p: string) => string | undefined }).getStdinInput(prompt);
        }
    }

    beforeEach(() => {
        plugin = new TestableKimiPlugin();
    });

    afterEach(async () => {
        await plugin.dispose();
    });

    test('includes --print for non-interactive mode', async () => {
        await plugin.initialize({});
        const args = (plugin as TestableKimiPlugin).testBuildArgs('test prompt');
        expect(args).toContain('--print');
    });

    test('includes --input-format text', async () => {
        await plugin.initialize({});
        const args = (plugin as TestableKimiPlugin).testBuildArgs('test prompt');
        expect(args).toContain('--input-format');
        expect(args).toContain('text');
    });

    test('includes --output-format stream-json', async () => {
        await plugin.initialize({});
        const args = (plugin as TestableKimiPlugin).testBuildArgs('test prompt');
        expect(args).toContain('--output-format');
        expect(args).toContain('stream-json');
    });

    test('includes model flag when specified', async () => {
        await plugin.initialize({ model: 'kimi-k2-0711' });
        const args = (plugin as TestableKimiPlugin).testBuildArgs('test prompt');
        expect(args).toContain('--model');
        expect(args).toContain('kimi-k2-0711');
    });

    test('omits model flag when not specified', async () => {
        await plugin.initialize({});
        const args = (plugin as TestableKimiPlugin).testBuildArgs('test prompt');
        expect(args).not.toContain('--model');
    });

    test('returns prompt via stdin', async () => {
        await plugin.initialize({});
        const stdinInput = (plugin as TestableKimiPlugin).testGetStdinInput('my test prompt');
        expect(stdinInput).toBe('my test prompt');
    });
});

describe('parseKimiJsonLine', () => {
    test('returns empty array for empty input', () => {
        expect(parseKimiJsonLine('')).toEqual([]);
        expect(parseKimiJsonLine('   ')).toEqual([]);
    });

    test('returns empty array for invalid JSON', () => {
        expect(parseKimiJsonLine('not json')).toEqual([]);
        expect(parseKimiJsonLine('{ invalid')).toEqual([]);
    });

    test('parses text content from assistant message', () => {
        const input = JSON.stringify({
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from Kimi' }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('text');
        expect((events[0] as { content: string }).content).toBe('Hello from Kimi');
    });

    test('skips think events', () => {
        const input = JSON.stringify({
            role: 'assistant',
            content: [{ type: 'think', think: 'internal reasoning...' }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(0);
    });

    test('parses function tool call', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{
                type: 'function',
                function: {
                    name: 'WriteFile',
                    arguments: JSON.stringify({ path: '/test.js', content: 'hello' }),
                },
            }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('tool_use');
        expect((events[0] as { name: string }).name).toBe('WriteFile');
        expect((events[0] as { input: Record<string, unknown> }).input).toEqual({
            path: '/test.js',
            content: 'hello',
        });
    });

    test('handles function call with non-JSON arguments', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{
                type: 'function',
                function: {
                    name: 'Shell',
                    arguments: 'ls -la',
                },
            }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('tool_use');
        expect((events[0] as { input: Record<string, unknown> }).input).toEqual({
            command: 'ls -la',
        });
    });

    test('parses tool_result event', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{ type: 'tool_result', is_error: false }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('tool_result');
    });

    test('parses tool_result with error', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{ type: 'tool_result', is_error: true, output: 'File not found' }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(2);
        expect(events[0]?.type).toBe('error');
        expect((events[0] as { message: string }).message).toBe('File not found');
        expect(events[1]?.type).toBe('tool_result');
    });

    test('parses function_result event', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{ type: 'function_result' }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('tool_result');
    });

    test('parses top-level text event', () => {
        const input = JSON.stringify({
            type: 'text',
            text: 'Direct text output',
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('text');
        expect((events[0] as { content: string }).content).toBe('Direct text output');
    });

    test('parses top-level error event', () => {
        const input = JSON.stringify({
            type: 'error',
            error: { message: 'API rate limit' },
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('error');
        expect((events[0] as { message: string }).message).toBe('API rate limit');
    });

    test('parses error with string error field', () => {
        const input = JSON.stringify({
            type: 'error',
            error: 'Something went wrong',
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('error');
        expect((events[0] as { message: string }).message).toBe('Something went wrong');
    });

    test('parses error with message field', () => {
        const input = JSON.stringify({
            type: 'error',
            message: 'Error from message field',
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('error');
        expect((events[0] as { message: string }).message).toBe('Error from message field');
    });

    test('handles mixed content array', () => {
        const input = JSON.stringify({
            role: 'assistant',
            content: [
                { type: 'think', think: 'internal thought' },
                { type: 'text', text: 'Hello' },
                { type: 'text', text: 'World' },
            ],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(2);
        expect((events[0] as { content: string }).content).toBe('Hello');
        expect((events[1] as { content: string }).content).toBe('World');
    });

    test('handles function call without arguments', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{
                type: 'function',
                function: { name: 'ReadFile' },
            }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect(events[0]?.type).toBe('tool_use');
        expect((events[0] as { name: string }).name).toBe('ReadFile');
    });

    test('handles function call without name', () => {
        const input = JSON.stringify({
            role: 'tool',
            content: [{
                type: 'function',
                function: { arguments: '{}' },
            }],
        });
        const events = parseKimiJsonLine(input);
        expect(events.length).toBe(1);
        expect((events[0] as { name: string }).name).toBe('unknown');
    });
});

describe('parseKimiOutputToEvents', () => {
    test('parses multiple JSONL lines', () => {
        const lines = [
            JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Line 1' }] }),
            JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Line 2' }] }),
        ].join('\n');
        const events = parseKimiOutputToEvents(lines);
        expect(events.length).toBe(2);
        expect((events[0] as { content: string }).content).toBe('Line 1');
        expect((events[1] as { content: string }).content).toBe('Line 2');
    });

    test('handles empty lines', () => {
        const lines = '\n\n' + JSON.stringify({
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello' }],
        }) + '\n\n';
        const events = parseKimiOutputToEvents(lines);
        expect(events.length).toBe(1);
    });

    test('handles mixed valid and invalid lines', () => {
        const lines = [
            'some status text',
            JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Valid' }] }),
            'another status line',
        ].join('\n');
        const events = parseKimiOutputToEvents(lines);
        expect(events.length).toBe(1);
        expect((events[0] as { content: string }).content).toBe('Valid');
    });

    test('returns empty array for empty input', () => {
        expect(parseKimiOutputToEvents('')).toEqual([]);
    });
});
