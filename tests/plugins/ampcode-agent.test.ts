/**
 * ABOUTME: Amp CLI contract, JSONL streaming, completion isolation, and subprocess lifecycle tests.
 * Uses deterministic local executables without requiring Amp accounts or model calls.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import createAmpcodeAgent, { AmpcodeAgentPlugin } from '../../src/plugins/agents/builtin/ampcode.js';
import { SubagentTraceParser } from '../../src/plugins/agents/tracing/parser.js';
import type { AgentExecuteOptions, AgentExecutionResult, AgentPlugin } from '../../src/plugins/agents/types.js';
import type { FormattedSegment } from '../../src/plugins/agents/output-formatting.js';

class TestableAmp extends AmpcodeAgentPlugin {
  args(options?: AgentExecuteOptions): string[] {
    return this.buildArgs('sensitive prompt', [{ path: 'ignored.ts' }], options);
  }
  stdin(prompt: string): string {
    return this.getStdinInput(prompt);
  }
}

const complete = '<promise>COMPLETE</promise>';
const completionPattern = /<promise>\s*COMPLETE\s*<\/promise>/i;
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'assistant', message: { role: 'assistant', content }, ...extra,
});
const text = (value: string) => ({ type: 'text', text: value });
const success = (result: string) => ({ type: 'result', subtype: 'success', is_error: false, result });
const jsonl = (...messages: unknown[]) => messages.map((message) => JSON.stringify(message)).join('\n');

let dir: string;
const plugins: AmpcodeAgentPlugin[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ralph-amp-'));
});
afterEach(async () => {
  for (const plugin of plugins.splice(0)) await plugin.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function fake(body: string, config: Record<string, unknown> = {}): Promise<TestableAmp> {
  const script = join(dir, `fake-${plugins.length}.ts`);
  await writeFile(script, body);
  const plugin = new TestableAmp();
  plugins.push(plugin);
  await plugin.initialize({ command: process.execPath, defaultFlags: [script], ...config });
  return plugin;
}

async function output(value: string, options?: AgentExecuteOptions): Promise<AgentExecutionResult> {
  const plugin = await fake(`process.stdout.write(${JSON.stringify(value)});`);
  return plugin.execute('test', undefined, options).promise;
}

describe('Amp CLI contract', () => {
  test('factory and metadata advertise supported capabilities', () => {
    const plugin = createAmpcodeAgent();
    expect(plugin).toBeInstanceOf(AmpcodeAgentPlugin);
    expect(plugin.meta).toMatchObject({ id: 'ampcode', defaultCommand: 'amp', supportsFileContext: false,
      supportsStreaming: true, supportsInterrupt: true, supportsSubagentTracing: true, structuredOutputFormat: 'jsonl' });
    expect(plugin.getSandboxRequirements().authPaths).toContain('~/.local/share/amp');
  });

  test('defaults to execute JSONL and never opts in to the legacy bypass', async () => {
    const plugin = new TestableAmp();
    await plugin.initialize({});
    expect(plugin.args()).toEqual(['--execute', '--stream-json', '--no-notifications']);
    expect(plugin.args().join(' ')).not.toContain('sensitive prompt');
  });

  test.each(['low', 'medium', 'high', 'ultra', 'claude-code', 'custom-reviewer', 'smart', 'free', 'rush'])(
    'passes mode %s verbatim for the installed CLI', async (mode) => {
      const plugin = new TestableAmp();
      await plugin.initialize({ mode });
      expect(plugin.args()).toContain(mode);
      expect(plugin.args()[plugin.args().indexOf('--mode') + 1]).toBe(mode);
      expect(await plugin.validateSetup({ mode })).toBeNull();
    }
  );

  test('empty or non-string mode uses Amp default; whitespace is trimmed', async () => {
    for (const mode of ['', '  ', 3]) {
      const plugin = new TestableAmp();
      await plugin.initialize({ mode });
      expect(plugin.args()).not.toContain('--mode');
    }
    const plugin = new TestableAmp();
    await plugin.initialize({ mode: ' high ' });
    expect(plugin.args()).toContain('high');
    expect(await plugin.validateSetup({ mode: 3 })).toContain('string');
    expect(plugin.validateModel('model-id')).toContain('mode');
    expect(plugin.validateModel('')).toBeNull();
  });

  test('legacy bypass requires a literal true and false does not claim modern protection', async () => {
    for (const dangerouslyAllowAll of [undefined, false, 'true']) {
      const plugin = new TestableAmp();
      await plugin.initialize({ dangerouslyAllowAll });
      expect(plugin.args()).not.toContain('--dangerously-allow-all');
    }
    const plugin = new TestableAmp();
    await plugin.initialize({ dangerouslyAllowAll: true, streamJson: false, timeout: 500 });
    expect(plugin.args()).toEqual(['--execute', '--dangerously-allow-all', '--no-notifications']);
    expect(plugin.args({ subagentTracing: true })).toContain('--stream-json');
    const question = plugin.getSetupQuestions().find(({ id }) => id === 'dangerouslyAllowAll');
    expect(question?.default).toBe(false);
    expect(question?.help).toContain('even when this is false');
    expect(plugin.getSetupQuestions().find(({ id }) => id === 'streamJson')?.default).toBe(true);
  });

  test('stdin is exact, including Unicode and shell metacharacters; EOF arrives', async () => {
    const captured = join(dir, 'input.json');
    const plugin = await fake(`const input = await Bun.stdin.text();
      await Bun.write(${JSON.stringify(captured)}, JSON.stringify({ input, args: process.argv.slice(2) }));
      process.stdout.write(JSON.stringify(${JSON.stringify(assistant([text('done')]))}));`);
    const prompt = 'Fix "quotes"\n$HOME $(touch pwned); café 🚀';
    expect(plugin.stdin(prompt)).toBe(prompt);
    const result = await plugin.execute(prompt).promise;
    const capture = JSON.parse(await readFile(captured, 'utf8'));
    expect(capture.input).toBe(prompt);
    expect(capture.args).toEqual(['--execute', '--stream-json', '--no-notifications']);
    expect(result.status).toBe('completed');
    expect(result.stdout).toBe('done');
  });

  test('plain-text mode remains available explicitly', async () => {
    const plugin = await fake(`process.stdout.write(${JSON.stringify(complete)});`, { streamJson: false });
    const chunks: string[] = [];
    const result = await plugin.execute('test', undefined, { onStdout: (chunk) => chunks.push(chunk) }).promise;
    expect(result.stdout).toBe(complete);
    expect(chunks.join('')).toBe(complete);
  });

  test('shared launch preserves argv ordering, cwd, stdin, and environment filtering', async () => {
    const captured = join(dir, 'launch.json');
    const plugin = await fake(`const input = await Bun.stdin.text();
      await Bun.write(${JSON.stringify(captured)}, JSON.stringify({ input, args: process.argv.slice(2),
        cwd: process.cwd(), allowed: process.env.AMP_FIXTURE_ALLOWED, blocked: process.env.AMP_FIXTURE_BLOCKED }));`,
      { mode: 'custom mode', envExclude: ['AMP_FIXTURE_BLOCKED'] });
    const original = process.env.AMP_FIXTURE_BLOCKED;
    process.env.AMP_FIXTURE_BLOCKED = 'synthetic-not-a-secret';
    try {
      const result = await plugin.execute('prompt with $shell; and "quotes"', undefined, {
        cwd: dir, flags: ['--fixture', 'one argument'], env: { AMP_FIXTURE_ALLOWED: 'allowed' },
      }).promise;
      expect(result.status).toBe('completed');
      expect(JSON.parse(await readFile(captured, 'utf8'))).toEqual({
        input: 'prompt with $shell; and "quotes"', cwd: dir, allowed: 'allowed',
        args: ['--fixture', 'one argument', '--execute', '--stream-json', '--mode', 'custom mode', '--no-notifications'],
      });
    } finally {
      if (original === undefined) delete process.env.AMP_FIXTURE_BLOCKED;
      else process.env.AMP_FIXTURE_BLOCKED = original;
    }
  });
});

describe('Amp JSONL parsers', () => {
  test.each(['', '  ', '{invalid', 'null', 'true', '42', '"text"', '[]'])(
    'rejects invalid protocol record %j', (line) => expect(AmpcodeAgentPlugin.parseJsonlLine(line).success).toBe(false)
  );

  test('normalizes session_id while preserving official nested messages and legacy fields', () => {
    const raw = { ...assistant([text('hello')]), session_id: 'thread-1', result: { x: 1 },
      tool: { name: 'Task', input: { prompt: 'inspect' } } };
    const result = AmpcodeAgentPlugin.parseJsonlLine(JSON.stringify(raw));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('parse failed');
    expect(result.message.sessionId).toBe('thread-1');
    expect(result.message.raw).toEqual(raw);
    expect(result.message.tool).toEqual(raw.tool);
    expect(result.message.result).toEqual({ x: 1 });
    expect(AmpcodeAgentPlugin.parseJsonlLine('{"message":"legacy","sessionId":"old"}')).toMatchObject({
      success: true, message: { message: 'legacy', sessionId: 'old' },
    });
    expect(AmpcodeAgentPlugin.parseJsonlLine('{"tool":{"name":42,"input":[]}}')).toMatchObject({
      success: true, message: { tool: { name: undefined, input: undefined } },
    });
    expect(AmpcodeAgentPlugin.parseJsonlLine('{"tool":[]}')).toMatchObject({ success: true, message: { raw: { tool: [] } } });
  });

  test('output parser skips blank lines and preserves fallback order', () => {
    const result = AmpcodeAgentPlugin.parseJsonlOutput('\n' + jsonl(success('ok')) + '\r\n{bad\nnotice\n\n');
    expect(result.messages).toHaveLength(1);
    expect(result.fallback).toEqual(['{bad', 'notice']);
  });

  test('stream parser accepts any chunk split, flushes once, and retains history', () => {
    const input = jsonl(assistant([text('hello')]), success('done'));
    for (let i = 0; i <= input.length; i++) {
      const parser = AmpcodeAgentPlugin.createStreamingJsonlParser();
      const records = [...parser.push(input.slice(0, i)), ...parser.push(input.slice(i)), ...parser.flush()];
      expect(records).toHaveLength(2);
      expect(parser.flush()).toEqual([]);
      expect(parser.getState().messages).toHaveLength(2);
    }
  });

  test('stream parser collects fallback without empty lines and supports history-free callbacks', () => {
    const parser = AmpcodeAgentPlugin.createStreamingJsonlParser();
    parser.push('notice\n\n{bad');
    expect(parser.flush()).toHaveLength(1);
    expect(parser.getState().fallback).toEqual(['notice', '{bad']);
    const streaming = AmpcodeAgentPlugin.createStreamingJsonlParser(false);
    expect(streaming.push(jsonl(success('ok')) + '\nnotice\n')).toHaveLength(2);
    expect(streaming.getState()).toEqual({ messages: [], fallback: [] });
  });
});

describe('Amp completion and streamed callbacks', () => {
  test('engine extraction fallback does not parse normalized narrative a second time', async () => {
    const narrative = JSON.stringify({ type: 'tool_use', input: { example: complete } });
    const plugin = await fake(`console.log(${JSON.stringify(jsonl(assistant([text(narrative)])))});`);
    const agent: AgentPlugin = plugin;
    const result = await agent.execute('test', undefined, { subagentTracing: true }).promise;
    const scan = agent.extractAgentText?.(result.stdout, { subagentTracing: true }) ?? result.stdout;
    expect(result.stdout).toBe(narrative);
    expect(completionPattern.test(scan)).toBe(true);
  });

  test('a streamed error survives bounded stdout truncation before later narrative', async () => {
    const records = jsonl(
      { type: 'result', subtype: 'error_during_execution', is_error: true, error: 'earlier failure' },
      assistant([{ type: 'tool_use', name: 'Read', input: { data: 'x'.repeat(2_000_000) } }]),
      assistant([text(complete)])
    );
    const result = await output(records);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('earlier failure');
    expect(result.stdout).toBe('');
  });

  test('a truncated oversized tool record cannot expose its marker-bearing tail', async () => {
    const result = await output(jsonl(assistant([
      { type: 'tool_use', name: 'Read', input: { data: 'x'.repeat(2_000_000) + complete } },
    ])));
    expect(result.status).toBe('completed');
    expect(completionPattern.test(result.stdout)).toBe(false);
  });
  test.each([
    ['assistant narrative', assistant([text(complete)]), true],
    ['successful result', success(complete), true],
    ['tool input', assistant([{ type: 'tool_use', name: 'Bash', input: { command: complete } }]), false],
    ['thinking', assistant([{ type: 'thinking', thinking: complete }]), false],
    ['tool result', { type: 'user', message: { content: [{ type: 'tool_result', content: complete }] } }, false],
    ['system metadata', { type: 'system', message: complete }, false],
    ['unknown event', { type: 'unknown', message: complete }, false],
    ['child assistant', assistant([text(complete)], { parent_tool_use_id: 'task-1' }), false],
    ['error result', { type: 'result', subtype: 'error', is_error: true, result: complete }, false],
    ['non-text blocks', assistant([null, 'ignored', [], 1, { type: 'text', text: 2 }]), false],
    ['malformed message', { type: 'assistant', message: null }, false],
    ['string content', { type: 'assistant', message: { content: complete } }, false],
    ['array message', { type: 'assistant', message: [] }, false],
  ] as const)('%s has expected completion visibility', async (_name, record, expected) => {
    const result = await output(jsonl(record));
    expect(result.stdout.includes(complete)).toBe(expected);
  });

  test('malformed protocol cannot forge completion but is still displayed for diagnostics', async () => {
    const chunks: string[] = [];
    const result = await output('startup: ' + complete + '\n', { onStdout: (chunk) => chunks.push(chunk) });
    expect(result.stdout).toBe('');
    expect(chunks.join('')).toContain(complete);
  });

  test('does not assemble completion across tool or hidden-content boundaries', async () => {
    const result = await output(jsonl(assistant([text('<promise>COM'), { type: 'tool_use', name: 'Read' }, text('PLETE</promise>')])));
    expect(result.stdout).not.toContain(complete);
  });

  test('joins adjacent text blocks within an official-format assistant message', async () => {
    const record = { type: 'assistant', session_id: 'T-test', parent_tool_use_id: null,
      message: { type: 'message', role: 'assistant', content: [text('<promise>COM'), text('PLETE</promise>')], stop_reason: 'end_turn' } };
    expect((await output(jsonl(record))).stdout).toBe(complete);
  });

  test.each([
    { type: 'thinking', thinking: 'hidden' }, { type: 'redacted_thinking', data: 'hidden' },
    { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
    null, 'invalid', [], { type: 'text', text: 12 },
  ].map((boundary) => [boundary]))('preserves non-text and malformed content boundaries: %j', async (boundary) => {
    const result = await output(jsonl(assistant([text('<promise>COM'), boundary, text('PLETE</promise>')])));
    expect(result.stdout).not.toContain(complete);
  });

  test('whole assistant messages are not treated as deltas across records', async () => {
    const result = await output(jsonl(assistant([text('<promise>COM')]), assistant([text('PLETE</promise>')])));
    expect(result.stdout).not.toContain(complete);
  });

  test.each([
    ['<promise>', 'COMPLETE</promise>'],
    ['<promise>COMPLETE', '</promise>'],
    ['<promise>COM', 'PLETE</promise>'],
  ])('engine matcher cannot cross boundaries between %s and %s', async (left, right) => {
    for (const boundary of [
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      { type: 'thinking', thinking: 'hidden' }, { type: 'redacted_thinking', data: 'hidden' },
      null, 'invalid', [], { type: 'text', text: 12 },
    ]) {
      const result = await output(jsonl(assistant([text(left), boundary, text(right)])));
      expect(completionPattern.test(result.stdout)).toBe(false);
    }
    for (const middle of [
      '', jsonl({ type: 'tool_result', content: 'tool output' }),
      jsonl({ type: 'system', subtype: 'init' }), jsonl(assistant([{ type: 'thinking', thinking: 'hidden' }])),
      'malformed JSONL',
    ]) {
      const result = await output([jsonl(assistant([text(left)])), middle, jsonl(assistant([text(right)]))].join('\n'));
      expect(completionPattern.test(result.stdout)).toBe(false);
    }
    const adjacent = await output(jsonl(assistant([text(left), text(right)])));
    expect(completionPattern.test(adjacent.stdout)).toBe(true);
  });

  test('flushes a split final line to raw callbacks, display segments and onEnd exactly once', async () => {
    const records = [assistant([{ type: 'tool_use', id: 't1', name: 'Task', input: { prompt: 'inspect', description: 'Inspect' } }]),
      assistant([text('finished ' + complete)]), success('all done')];
    const data = jsonl(...records);
    const split = data.indexOf('finished') + 4;
    const plugin = await fake(`process.stdout.write(${JSON.stringify(data.slice(0, split))});
      await Bun.sleep(20); process.stdout.write(${JSON.stringify(data.slice(split))});`);
    const raw: Record<string, unknown>[] = [];
    const chunks: string[] = [];
    const segments: FormattedSegment[] = [];
    const ended: AgentExecutionResult[] = [];
    const tracing = new SubagentTraceParser();
    const result = await plugin.execute('test', undefined, { subagentTracing: true,
      onJsonlMessage: (record) => {
        raw.push(record);
        const parsed = AmpcodeAgentPlugin.parseJsonlLine(JSON.stringify(record));
        if (parsed.success) tracing.processMessage(parsed.message);
      },
      onStdout: (chunk) => chunks.push(chunk),
      onStdoutSegments: (value) => segments.push(...value), onEnd: (value) => ended.push(value),
    }).promise;
    expect(raw).toEqual(records);
    expect(chunks.join('')).toContain('finished ' + complete);
    expect(chunks.join('')).not.toContain('"type"');
    expect(segments.map(({ text }) => text).join('')).toContain('finished');
    expect(tracing.getSummary().totalSpawned).toBe(1);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toBe(result);
    expect(result.stdout).toContain(complete);
    expect(result.stdout).not.toContain('inspect');
  });

  test('error result fails even with exit code zero and reaches the error renderer', async () => {
    const chunks: string[] = [];
    const result = await output(jsonl({ type: 'result', is_error: true, result: 'quota exhausted' }), {
      onStdout: (chunk) => chunks.push(chunk),
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBe('quota exhausted');
    expect(chunks.join('')).toContain('quota exhausted');
    expect(result.stdout).toBe('');
    expect((await output(jsonl({ type: 'result', is_error: true }))).error).toBe('Amp execute failed');
  });

  test('a later failure cannot complete a task from an earlier narrative marker', async () => {
    const result = await output(jsonl(assistant([text(complete)]), {
      type: 'result', is_error: true, result: 'cancelled by policy',
    }));
    expect(result.status).toBe('failed');
    expect(result.stdout).toBe('');
  });

  test('exit zero without a completion marker does not synthesize completion', async () => {
    const result = await output(jsonl(assistant([text('still working')]), success('not done')));
    expect(result.status).toBe('completed');
    expect(result.stdout).not.toContain(complete);
  });

  test.each(['stdout', 'segments', 'jsonl'])('final %s callback exceptions still call onEnd once with normalized output', async (callback) => {
    const ended: AgentExecutionResult[] = [];
    const fail = () => { throw new Error('consumer'); };
    const result = await output(jsonl(assistant([{ type: 'tool_use', name: 'Bash', input: { command: complete } }])), {
      onStdout: callback === 'stdout' ? fail : undefined,
      onStdoutSegments: callback === 'segments' ? fail : undefined,
      onJsonlMessage: callback === 'jsonl' ? fail : undefined,
      onEnd: (value) => ended.push(value),
    });
    expect(result.stdout).not.toContain(complete);
    expect(ended).toEqual([result]);
  });

  test.each(['error_during_execution', 'error_max_turns', 'error'])('explicit %s results cannot complete, even without is_error', async (subtype) => {
    const display: string[] = [];
    const result = await output(jsonl(assistant([text(complete)]), {
      type: 'result', subtype, error: 'execution failed',
    }), { onStdout: (chunk) => display.push(chunk) });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('execution failed');
    expect(result.stdout).toBe('');
    expect(display.join('')).toContain('execution failed');
  });

  test('official error shape preserves its error diagnostic', async () => {
    const result = await output(jsonl({ type: 'result', subtype: 'error_during_execution', is_error: true,
      error: 'API request failed', duration_ms: 1, num_turns: 1, session_id: 'T-test' }));
    expect(result.status).toBe('failed');
    expect(result.error).toBe('API request failed');
  });

  test.each([
    ['win32', 'Amp install.cmd', true], ['win32', 'Amp install.exe', false],
    ['win32', 'Amp install.com', false], ['linux', 'Amp install.cmd', false],
  ] as const)('version probing on %s handles %s with shell=%s', async (platform, name, shell) => {
    const path = join(dir, name);
    await writeFile(path, '');
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const probe = spyOn(childProcess, 'execFile').mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
      callback(null, 'amp 1.2.3', '');
      return {} as ReturnType<typeof childProcess.execFile>;
    });
    try {
      Object.defineProperty(process, 'platform', { value: platform });
      const plugin = await fake('', { command: path });
      expect(await plugin.detect()).toMatchObject({ available: true, version: '1.2.3', executablePath: path });
      expect(probe).toHaveBeenCalledWith(shell ? `"${path}"` : path, ['--version'],
        { shell, timeout: 5000, killSignal: 'SIGKILL' }, expect.any(Function));
    } finally {
      probe.mockRestore();
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});

describe('Amp subprocess lifecycle', () => {
  test.each([0, 7])('an actual timeout stays ineligible when SIGTERM exits %s after a marker', async (code) => {
    const plugin = await fake(`process.on('SIGTERM', () => process.exit(${code}));
      console.log(${JSON.stringify(jsonl(assistant([text(complete)])))});
      setInterval(() => {}, 1000);`, { timeout: 350 });
    const ended: AgentExecutionResult[] = [];
    const handle = plugin.execute('test', undefined, { onEnd: (result) => ended.push(result) });
    const result = await handle.promise;
    expect(result.status).toBe('timeout');
    expect(result.exitCode).toBe(code);
    expect(result.interrupted).toBe(false);
    expect(result.stdout).toBe('');
    expect(ended).toHaveLength(1);
    expect(handle.isRunning()).toBe(false);
  });

  test('an earlier narrative marker cannot complete after a nonzero child exit', async () => {
    const plugin = await fake(`console.log(${JSON.stringify(jsonl(assistant([text(complete)])))}); process.exit(7);`);
    const result = await plugin.execute('test').promise;
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe('');
  });

  test('nonzero exit captures stderr, preserves failed status and resolves once', async () => {
    const plugin = await fake(`console.error('auth failed'); process.exit(7);`);
    const ended: AgentExecutionResult[] = [];
    const handle = plugin.execute('test', undefined, { onEnd: (result) => ended.push(result) });
    const result = await handle.promise;
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('auth failed');
    expect(ended).toHaveLength(1);
    expect(handle.isRunning()).toBe(false);
  });

  test('spawn error resolves as failed instead of hanging', async () => {
    const plugin = await fake('', { command: join(dir, 'missing') });
    const result = await plugin.execute('test').promise;
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });

  test('timeout terminates the agent and flushes pending JSONL', async () => {
    const pidPath = join(dir, 'pid');
    const plugin = await fake(`await Bun.write(${JSON.stringify(pidPath)}, String(process.pid));
      process.stdout.write(${JSON.stringify(jsonl(assistant([text('waiting')])))});
      setInterval(() => {}, 1000);`, { timeout: 350 });
    const chunks: string[] = [];
    const handle = plugin.execute('test', undefined, { onStdout: (chunk) => chunks.push(chunk) });
    const result = await handle.promise;
    expect(result.status).toBe('timeout');
    expect(handle.isRunning()).toBe(false);
    expect(chunks.join('')).toContain('waiting');
    const pid = Number(await readFile(pidPath, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10000);

  test('immediate interrupt is honored and does not poison the next execution', async () => {
    const plugin = await fake(`await Bun.stdin.text(); console.log(${JSON.stringify(jsonl(assistant([text('done')])))});`);
    const first = plugin.execute('test');
    first.interrupt();
    expect((await first.promise).status).toBe('interrupted');
    const next = await plugin.execute('test').promise;
    expect(next.status).toBe('completed');
    expect(next.stdout).toBe('done');
  });

  test('concurrent executions do not share parser buffers or callbacks', async () => {
    const plugin = await fake(`const input = await Bun.stdin.text();
      const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: input }] } });
      process.stdout.write(line.slice(0, 15)); await Bun.sleep(20); process.stdout.write(line.slice(15));`);
    const results = await Promise.all(['first', 'second'].map((prompt) => plugin.execute(prompt).promise));
    expect(results.map(({ stdout }) => stdout)).toEqual(['first', 'second']);
  });

  test('detect respects command override and fails clearly for missing binaries', async () => {
    const plugin = await fake('', { command: process.execPath });
    expect(await plugin.detect()).toMatchObject({ available: true, executablePath: process.execPath });
    const missing = await fake('', { command: join(dir, 'does-not-exist') });
    expect(await missing.detect()).toMatchObject({ available: false });
  });

  test.skipIf(process.platform === 'win32')('blank command overrides detect and execute Amp from PATH', async () => {
    const executable = join(dir, 'amp');
    const which = Bun.which('which');
    expect(which).not.toBeNull();
    await symlink(which!, join(dir, 'which'));
    await writeFile(executable, `#!${process.execPath}\nif (process.argv.includes('--version')) {
      console.log('amp 1.2.3'); process.exit(0);
    }
    const input = await Bun.stdin.text();
    console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: input }] } }));\n`);
    await chmod(executable, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = dir;
    try {
      for (const command of ['', '  ']) {
        const plugin = new TestableAmp();
        plugins.push(plugin);
        await plugin.initialize({ command });
        expect(await plugin.detect()).toEqual({ available: true, version: '1.2.3', executablePath: executable });
        const result = await plugin.execute('literal PATH prompt').promise;
        expect(result.status).toBe('completed');
        expect(result.stdout).toBe('literal PATH prompt');
      }
      await rm(executable);
      const missing = new TestableAmp();
      plugins.push(missing);
      await missing.initialize({ command: '' });
      expect(await missing.detect()).toEqual({ available: false,
        error: 'Ampcode CLI not found in PATH. Install from: https://ampcode.com' });
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  test.skipIf(process.platform === 'win32')('detect reports CLI errors and kills a hung --version process', async () => {
    const script = join(dir, 'amp');
    await writeFile(script, '#!/bin/sh\necho version-failed >&2\nexit 1\n');
    await chmod(script, 0o755);
    const plugin = new TestableAmp();
    plugins.push(plugin);
    await plugin.initialize({ command: script });
    expect((await plugin.detect()).error).toContain('version-failed');
    const pidPath = join(dir, 'version-pid');
    await writeFile(script, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(pidPath)}, String(process.pid));\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    const start = Date.now();
    expect((await plugin.detect()).error).toContain('Timeout');
    expect(Date.now() - start).toBeLessThan(8000);
    const pid = Number(await readFile(pidPath, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 12000);
});
