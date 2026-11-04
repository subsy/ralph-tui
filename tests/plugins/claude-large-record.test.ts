/**
 * ABOUTME: Subprocess coverage for bounded large-record handling in Claude-compatible agents.
 */
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeAgentPlugin } from '../../src/plugins/agents/builtin/claude.js';
import { MiniMaxAgentPlugin } from '../../src/plugins/agents/builtin/minimax.js';
import { ZaiAgentPlugin } from '../../src/plugins/agents/builtin/zai.js';
import { BaseAgentPlugin } from '../../src/plugins/agents/base.js';

let directory: string;
let command: string;
const marker = '<promise>COMPLETE</promise>';
const narrative = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: marker }] } });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'claude-large-record-'));
  command = join(directory, 'agent');
  await writeFile(command, `#!${process.execPath}
await Bun.stdin.text();
const output = Buffer.from(await Bun.file(process.env.PAYLOAD!).arrayBuffer()).toString('utf8');
const split = Number(process.env.SPLIT ?? 2000001);
await new Promise(resolve => process.stdout.write(output.slice(0, split), resolve));
await Bun.sleep(30);
process.stdout.write(output.slice(split));
`, { mode: 0o755 });
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

for (const Agent of [ClaudeAgentPlugin, MiniMaxAgentPlugin, ZaiAgentPlugin]) {
  for (const mode of ['direct', 'subprocess']) {
    for (const prefix of ['\uFEFF', '\u00A0', ' \t']) {
      for (const kind of ['error', 'result']) {
        for (const ending of ['newline', 'eof']) {
          test(`${new Agent().meta.id}: ${mode} trimmed ${kind}, prefix ${JSON.stringify(prefix)}, ${ending}`, async () => {
            const failure = { type: kind, ...(kind === 'error' ? { error: 'Prefixed fatal' } : { is_error: true, errors: ['Prefixed fatal'] }) };
            const record = prefix + JSON.stringify(failure) + prefix;
            const output = ending === 'newline' ? record + '\n' + narrative + '\n' : narrative + '\n' + record;
            const path = join(directory, `${new Agent().meta.id}-${mode}-${Buffer.from(prefix).toString('hex')}-${kind}-${ending}.jsonl`);
            await writeFile(path, output);
            const plugin = new Agent();
            await plugin.initialize({ command, printMode: 'stream' });
            const execution = mode === 'direct' ? spyOn(BaseAgentPlugin.prototype, 'execute').mockImplementation((_prompt, _files, options) => {
              options?.onStdout?.(output);
              const result = { executionId: 'trim-test', status: 'completed' as const, stdout: output, stderr: '', durationMs: 0, exitCode: 0, interrupted: false, startedAt: '', endedAt: '' };
              options?.onEnd?.(result);
              return { executionId: result.executionId, promise: Promise.resolve(result), interrupt() {}, isRunning: () => false };
            }) : undefined;
            try {
              let settled = false;
              const ended: { status: string; error?: string; settled: boolean }[] = [];
              const messages: Record<string, unknown>[] = [];
              let display = '';
              const result = await plugin.execute('test', [], {
                env: { PAYLOAD: path },
                onStdout: (text) => { display += text; },
                onJsonlMessage: (message) => { messages.push(message); },
                onEnd: ({ status, error }) => { ended.push({ status, error, settled }); },
              }).promise.then((result) => { settled = true; return result; });
              expect(result.exitCode).toBe(0);
              expect(result.stdout).toBe(output);
              expect(result.status).toBe('failed');
              expect(result.error).toBe('Prefixed fatal');
              expect(ended).toEqual([{ status: 'failed', error: 'Prefixed fatal', settled: false }]);
              expect(messages).toContainEqual(failure);
              expect(display).toContain('Prefixed fatal');
            } finally {
              execution?.mockRestore();
            }
          });
        }
      }
    }
  }
  for (const kind of ['tool_progress', 'rate_limit_event', 'task_progress', 'progress']) {
    for (const order of ['first', 'last']) {
      for (const split of [2_000_001, 9_000_000]) {
        test(`${new Agent().meta.id}: oversized ${kind}, metadata ${order}, split ${split}`, async () => {
          const meta = { type: kind === 'task_progress' ? 'system' : kind, ...(kind === 'task_progress' ? { subtype: 'task_progress' } : {}) };
          const payload = { uuid: 'fixture', session_id: 'fixture', tool_use_id: 'fixture', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 1, rate_limit_info: { status: 'allowed' }, description: 'x'.repeat(2_100_000) + marker };
          const path = join(directory, `${new Agent().meta.id}-${kind}-${order}-${split}.jsonl`);
          await writeFile(path, JSON.stringify(order === 'first' ? { ...meta, ...payload } : { ...payload, ...meta }) + '\n' + narrative);
          const plugin = new Agent();
          await plugin.initialize({ command, printMode: 'stream' });
          const result = await plugin.execute('test', [], { env: { PAYLOAD: path, SPLIT: String(split) } }).promise;
          expect(result.status).toBe(kind === 'progress' ? 'failed' : 'completed');
          expect(result.exitCode).toBe(0);
        });
      }
    }
  }
  for (const prefix of ['\uFEFF', '\u00A0']) {
    test(`${new Agent().meta.id}: oversized ${JSON.stringify(prefix)} whitespace remains invalid`, async () => {
      const path = join(directory, `${new Agent().meta.id}-strict-${Buffer.from(prefix).toString('hex')}.jsonl`);
      await writeFile(path, prefix + JSON.stringify({ type: 'user', padding: 'x'.repeat(2_100_000) }) + '\n' + narrative);
      const plugin = new Agent();
      await plugin.initialize({ command, printMode: 'stream' });
      const result = await plugin.execute('test', [], { env: { PAYLOAD: path } }).promise;
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Non-JSON whitespace');
    });
  }
  for (const order of ['first', 'last']) {
    for (const kind of ['user', 'assistant', 'error', 'result', 'unknown', 'malformed']) {
      test(`${new Agent().meta.id}: oversized ${kind}, metadata ${order}`, async () => {
        const content = 'x'.repeat(2_100_000) + marker;
        const payload = kind === 'user'
          ? { message: { content: [{ type: 'tool_result', content }] } }
          : { message: { content: [{ type: 'thinking', thinking: content }] } };
        const meta = { type: kind, ...(kind === 'result' ? { is_error: true, subtype: 'error_during_execution', errors: ['Fatal result'] } : {}), ...(kind === 'error' ? { error: 'Fatal provider' } : {}) };
        let record = JSON.stringify(order === 'first' ? { ...meta, ...payload } : { ...payload, ...meta });
        if (kind === 'malformed') record = record.slice(0, -1) + ',INVALID}';
        const path = join(directory, `${new Agent().meta.id}-${kind}-${order}.jsonl`);
        await writeFile(path, record + '\n' + narrative);
        const plugin = new Agent();
        await plugin.initialize({ command, printMode: 'stream' });
        const ended: string[] = [];
        let display = '';
        const result = await plugin.execute('test', [], {
          env: { PAYLOAD: path },
          onStdout: (text) => { display += text; },
          onEnd: (result) => { ended.push(result.status); },
        }).promise;
        const expected = kind === 'user' || kind === 'assistant' ? 'completed' : 'failed';
        expect(result.exitCode).toBe(0);
        expect(result.status).toBe(expected);
        expect(ended).toEqual([expected]);
        expect(display).toContain('buffer limit');
        expect(display).toContain(marker);
        expect(result.stdout.length).toBeLessThanOrEqual(2_000_000);
        if (kind === 'result') expect(result.error).toContain('Fatal result');
        if (kind === 'error') expect(result.error).toContain('Fatal provider');
      });
    }
  }
  for (const split of [1, 2_000_001, 9_000_000]) {
    for (const kind of ['image', 'document', 'tool_use']) {
      test(`${new Agent().meta.id}: ${kind} payload and escaped Unicode, split ${split}`, async () => {
        const content = 'é😀"\\\t'.repeat(270_000) + marker;
        const block = kind === 'tool_use' ? { type: kind, input: { content } }
          : { type: kind, source: { type: 'base64', data: content } };
        const record = JSON.stringify({ message: { content: [block] }, type: kind === 'tool_use' ? 'assistant' : 'user' });
        const path = join(directory, `${new Agent().meta.id}-${kind}-${split}.jsonl`);
        await writeFile(path, record + '\n' + narrative + '\n');
        const plugin = new Agent();
        await plugin.initialize({ command, printMode: 'stream' });
        const result = await plugin.execute('test', [], { env: { PAYLOAD: path, SPLIT: String(split) } }).promise;
        expect(result.status).toBe('completed');
        expect(result.error).toBeUndefined();
        expect(plugin.extractAgentText(result.stdout)).toContain(marker);
      });
    }
  }
  for (const callback of ['onStdout', 'onStdoutSegments'] as const) {
    for (const malformed of [false, true]) {
      test(`${new Agent().meta.id}: EOF validation precedes throwing ${callback}, malformed=${malformed}`, async () => {
        let record = JSON.stringify({ payload: 'x'.repeat(2_100_000), type: 'result', is_error: true, errors: ['EOF fatal'] });
        if (malformed) record = record.slice(0, -1);
        const path = join(directory, `${new Agent().meta.id}-${callback}-${malformed}.jsonl`);
        await writeFile(path, record);
        const plugin = new Agent();
        await plugin.initialize({ command, printMode: 'stream' });
        const ended: { status: string; error?: string }[] = [];
        let calls = 0;
        const result = await plugin.execute('test', [], {
          env: { PAYLOAD: path },
          [callback]: () => { calls++; throw new Error('display failed'); },
          onEnd: ({ status, error }) => { ended.push({ status, error }); },
        }).promise;
        expect(calls).toBe(1);
        expect(ended).toEqual([{ status: 'failed', error: result.error }]);
        expect(result.status).toBe('failed');
        expect(result.error).toContain(malformed ? 'Parser cannot parse' : 'EOF fatal');
      });
    }
  }
  test(`${new Agent().meta.id}: huge hidden-only completion does not become authored text`, async () => {
    const path = join(directory, `${new Agent().meta.id}-hidden.jsonl`);
    await writeFile(path, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x'.repeat(2_100_000) + marker }] } }));
    const plugin = new Agent();
    await plugin.initialize({ command, printMode: 'stream' });
    const result = await plugin.execute('test', [], { env: { PAYLOAD: path } }).promise;
    expect(result.status).toBe('completed');
    expect(plugin.extractAgentText(result.stdout) ?? '').not.toContain(marker);
  });
}
