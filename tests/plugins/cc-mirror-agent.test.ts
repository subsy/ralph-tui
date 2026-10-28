/**
 * ABOUTME: Contract and subprocess tests for cc-mirror MiniMax and Z.ai agents.
 * Exercises shared Claude execution with deterministic local wrapper stand-ins.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createMiniMaxAgent, { MiniMaxAgentPlugin } from '../../src/plugins/agents/builtin/minimax.js';
import createZaiAgent, { ZaiAgentPlugin } from '../../src/plugins/agents/builtin/zai.js';
import { registerBuiltinAgents } from '../../src/plugins/agents/builtin/index.js';
import { getAgentRegistry } from '../../src/plugins/agents/registry.js';
import { BaseAgentPlugin } from '../../src/plugins/agents/base.js';
import type { AgentExecuteOptions, AgentExecutionResult, AgentFileContext } from '../../src/plugins/agents/types.js';

const wrapperSource = `#!/usr/bin/env bun
if (process.argv.includes('--version')) {
  console.log('cc-mirror provider');
  process.exit(0);
}
if (process.argv.includes('--fail-provider')) {
  console.error('Provider authentication failed');
  process.exit(1);
}
const mode = process.env.FAKE_MODE;
const text = (value) => JSON.stringify({type:'assistant',message:{content:[{type:'text',text:value}]}});
if (mode === 'exact-limit') {
  const line = text('At limit');
  process.stdout.write(' '.repeat(2_000_000 - line.length) + line);
} else if (mode?.startsWith('overflow')) {
  process.stdout.write('x' + ' '.repeat(2_000_000));
  await Bun.sleep(60);
  process.stdout.write(text('Spoofed truncated tail'));
  if (mode !== 'overflow-eof') {
    process.stdout.write('\\n' + text('After delimiter') + '\\n' + text('Final valid record'));
  }
} else if (mode?.startsWith('structured-error')) {
  process.stdout.write(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,errors:['Provider auth failed',42,'Retry exhausted']}));
  if (mode === 'structured-error-hang') {
    process.stdout.write('\\n');
    setInterval(() => {}, 100);
  }
} else if (mode === 'tool-only') {
  console.log(JSON.stringify({type:'user',message:{content:[{type:'tool_result',is_error:true,content:'Recoverable tool error'}]}}));
  process.stdout.write(text('Recovered'));
} else if (mode === 'hang') {
  console.log(JSON.stringify({type:'system',subtype:'init'}));
  setInterval(() => {}, 100);
} else {
  const prompt = await Bun.stdin.text();
  console.log(JSON.stringify({type:'system',subtype:'init',args:process.argv.slice(2),prompt,cwd:process.cwd(),sandbox:process.env.IS_SANDBOX}));
  if (process.env.FAKE_MODE === 'plain') {
    console.log('Plain output');
  } else {
    const line = JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Narrative response'},{type:'tool_use',name:'Read',input:{file_path:'file.ts'}}]}});
    process.stdout.write(line.slice(0, 30));
    await Bun.sleep(30);
    process.stdout.write(line.slice(30) + '\\n');
    console.log(JSON.stringify({type:'user',message:{content:[{type:'tool_result',is_error:true,content:'Tool failed'}]}}));
    console.log('invalid JSON');
    console.log(JSON.stringify({type:'result',subtype:'success',result:'Narrative response'}));
    process.stdout.write(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'Provider failed'}));
  }
}
`;

for (const [id, factory] of [['minimax', createMiniMaxAgent], ['zai', createZaiAgent]] as const) {
  describe(`${id} contract`, () => {
    test('factory metadata describes an isolated Claude wrapper', () => {
      const plugin = factory();
      expect(plugin.meta.id).toBe(id);
      expect(plugin.meta.defaultCommand).toBe(id);
      expect(plugin.meta.structuredOutputFormat).toBe('jsonl');
      expect(plugin.meta.supportsSubagentTracing).toBe(true);
      expect(plugin.meta.skillsPaths).toEqual({ personal: `~/.cc-mirror/${id}/config/skills`, repo: '.claude/skills' });
      const sandbox = plugin.getSandboxRequirements!();
      expect(sandbox.authPaths).toEqual([`~/.cc-mirror/${id}/config`]);
      expect(sandbox.binaryPaths).toContain(`~/.cc-mirror/${id}/native`);
      expect(sandbox.binaryPaths).toContain('~/.cc-mirror/bin');
      expect(JSON.stringify(sandbox)).not.toContain('/Users/');
    });

    test('setup uses configured model slots without a stale model allowlist', async () => {
      const plugin = factory();
      const questions = plugin.getSetupQuestions();
      expect(questions.find((question) => question.id === 'printMode')?.default).toBe('stream');
      expect(questions.find((question) => question.id === 'model')?.type).toBe('text');
      for (const model of ['', 'sonnet', 'opus', 'haiku', 'MiniMax-M2.7', 'glm-5.1', 'future-provider-model']) {
        expect(plugin.validateModel!(model)).toBeNull();
        expect(await plugin.validateSetup({ model })).toBeNull();
      }
      expect(await plugin.validateSetup({})).toBeNull();
      expect(await plugin.validateSetup({ model: 42 })).toContain('string');
      expect(await plugin.validateSetup({ model: '   ' })).not.toBeNull();
      expect(await plugin.validateSetup({ printMode: 'invalid' })).toContain('print mode');
      expect(plugin.listModels!()).toEqual(['sonnet', 'opus', 'haiku']);
    });

    test('delivers complete JSONL records before bounding an oversized pending line', async () => {
      const plugin = factory();
      await plugin.initialize({});
      const messages: Record<string, unknown>[] = [];
      let display = '';
      const execution = spyOn(BaseAgentPlugin.prototype, 'execute').mockImplementation((_prompt, _files, options) => {
        const first = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'First record' }] } });
        const middle = JSON.stringify({ type: 'system', subtype: 'init', padding: 'x'.repeat(2_000_000) });
        const last = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Last record' }] } });
        options?.onStdout?.(`${first}\n${middle}\n${last}\n${'x'.repeat(2_000_001)}`);
        const result = { executionId: 'buffer-test', status: 'completed' as const, stdout: '', stderr: '', durationMs: 0, interrupted: false, startedAt: '', endedAt: '' };
        options?.onEnd?.(result);
        return { executionId: result.executionId, promise: Promise.resolve(result), interrupt() {}, isRunning: () => false };
      });
      try {
        await plugin.execute('test', undefined, { onStdout: (data) => { display += data; }, onJsonlMessage: (message) => { messages.push(message); } }).promise;
        expect(messages.map((message) => message.type)).toEqual(['assistant', 'system', 'assistant']);
        expect(display).toContain('First record');
        expect(display).toContain('Last record');
      } finally {
        execution.mockRestore();
        await plugin.dispose();
      }
    });
  });
}

test('registers both provider factories additively alongside existing agents', () => {
  registerBuiltinAgents();
  const ids = getAgentRegistry().getRegisteredPlugins().map((meta) => meta.id);
  for (const id of ['claude', 'opencode', 'droid', 'kimi', 'antigravity', 'minimax', 'zai']) {
    expect(ids).toContain(id);
  }
});

for (const Plugin of [MiniMaxAgentPlugin, ZaiAgentPlugin]) {
  describe.skipIf(process.platform === 'win32')(`${Plugin.name} subprocess`, () => {
    let directory: string;
    let command: string;
    let plugin: MiniMaxAgentPlugin | ZaiAgentPlugin;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'cc-mirror-test-'));
      command = join(directory, 'wrapper with spaces;literal');
      await writeFile(command, wrapperSource);
      await chmod(command, 0o755);
      plugin = new Plugin();
    });

    afterEach(async () => {
      await plugin.dispose();
      await rm(directory, { recursive: true, force: true });
    });

    test('detects label-only --version and retains the resolved executable', async () => {
      await plugin.initialize({ command });
      const result = await plugin.detect();
      expect(result.available).toBe(true);
      expect(result.executablePath).toBe(command);
      expect(result.version).toBeUndefined();
    });

    test('missing-wrapper guidance points to cc-mirror, not vanilla Claude', async () => {
      await plugin.initialize({ command: join(directory, 'missing') });
      const result = await plugin.detect();
      expect(result.available).toBe(false);
      expect(result.error).toContain(`--provider ${plugin.meta.id}`);
      expect(result.error).toContain('numman-ali/cc-mirror');
    });

    test('shares stdin, argv, JSONL buffering, errors and subagent callbacks', async () => {
      await plugin.initialize({ command, model: 'provider-model' });
      const messages: Record<string, unknown>[] = [];
      const output: string[] = [];
      const segments: unknown[] = [];
      let ended = false;
      const prompt = 'literal $(touch unwanted) "quotes"\n- multiline prompt';
      const result = await plugin.execute(prompt, [{ path: '/context/file.ts' } as AgentFileContext], {
        cwd: directory,
        onJsonlMessage: (message) => messages.push(message),
        onStdout: (data) => output.push(data),
        onStdoutSegments: (data) => segments.push(...data),
        onEnd: () => { ended = true; },
      }).promise;
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Provider failed');
      expect(ended).toBe(true);
      expect(messages[0]).toMatchObject({ prompt, cwd: directory, sandbox: '1' });
      expect(messages[0].args).toEqual(['--print', '--verbose', '--output-format', 'stream-json', '--model', 'provider-model', '--dangerously-skip-permissions', '--add-dir', '/context']);
      expect(messages.map((message) => message.type)).toEqual(['system', 'assistant', 'user', 'result', 'result']);
      expect(output.join('')).toContain('Narrative response');
      expect(output.join('').match(/Narrative response/g)).toHaveLength(1);
      expect(output.join('')).toContain('Tool failed');
      expect(output.join('').match(/Provider failed/g)).toHaveLength(1);
      expect(segments.length).toBeGreaterThan(0);
      expect(result.stdout).toContain('invalid JSON');
    });

    test('honors plain output and permission overrides', async () => {
      await plugin.initialize({ command, printMode: 'text', skipPermissions: false });
      const output: string[] = [];
      const result = await plugin.execute('hello', [], {
        env: { FAKE_MODE: 'plain', IS_SANDBOX: 'custom' },
        onStdout: (data) => output.push(data),
      }).promise;
      expect(output.join('')).toContain('Plain output');
      expect(result.stdout).not.toContain('--output-format');
      expect(result.stdout).not.toContain('--dangerously-skip-permissions');
      expect(result.stdout).toContain('custom');
    });

    for (const mode of ['overflow-delimited', 'overflow-eof']) {
      test(`${mode} diagnoses a discarded record without parsing its truncated suffix`, async () => {
        await plugin.initialize({ command });
        let display = '';
        const messages: Record<string, unknown>[] = [];
        const ended: AgentExecutionResult[] = [];
        const result = await plugin.execute('test', [], {
          env: { FAKE_MODE: mode },
          onStdout: (text) => { display += text; },
          onJsonlMessage: (message) => { messages.push(message); },
          onEnd: (result) => { ended.push({ ...result }); },
        }).promise;
        expect(display).not.toContain('Spoofed truncated tail');
        expect(JSON.stringify(messages)).not.toContain('Spoofed truncated tail');
        expect(result.status).toBe('failed');
        expect(result.error).toContain('2000000');
        expect(result.error).toContain('discard');
        expect(display.match(/buffer limit/g)).toHaveLength(1);
        expect(ended).toHaveLength(1);
        expect(ended[0].status).toBe('failed');
        expect(ended[0].error).toBe(result.error);
        if (mode === 'overflow-delimited') {
          expect(messages).toHaveLength(2);
          expect(display).toContain('After delimiter');
          expect(display).toContain('Final valid record');
        } else {
          expect(messages).toHaveLength(0);
        }
      });
    }

    test('structured result errors fail even with exit zero and no observers', async () => {
      await plugin.initialize({ command });
      const result = await plugin.execute('test', [], { env: { FAKE_MODE: 'structured-error' } }).promise;
      expect(result.exitCode).toBe(0);
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Provider auth failed\nRetry exhausted');
    });

    test('a record at the pending limit survives final flushing', async () => {
      await plugin.initialize({ command });
      let display = '';
      const result = await plugin.execute('test', [], { env: { FAKE_MODE: 'exact-limit' }, onStdout: (text) => { display += text; } }).promise;
      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
      expect(display).toContain('At limit');
      expect(display).not.toContain('buffer limit');
    });

    test('overflow status reaches onEnd even when the recovered final display throws', async () => {
      await plugin.initialize({ command });
      const ended: AgentExecutionResult[] = [];
      const result = await plugin.execute('test', [], {
        env: { FAKE_MODE: 'overflow-delimited' },
        onStdout: (text) => { if (text.includes('Final valid record')) throw new Error('display failed'); },
        onEnd: (result) => { ended.push({ ...result }); },
      }).promise;
      expect(ended).toHaveLength(1);
      expect(ended[0].status).toBe('failed');
      expect(ended[0].error).toContain('buffer limit');
      expect(result.error).toBe(ended[0].error);
    });

    for (const callback of ['onStdout', 'onStdoutSegments', 'onJsonlMessage'] as const) {
      test(`final ${callback} throwing cannot skip onEnd or error normalization`, async () => {
        await plugin.initialize({ command });
        const ended: AgentExecutionResult[] = [];
        let calls = 0;
        const result = await plugin.execute('test', [], {
          env: { FAKE_MODE: 'structured-error' },
          [callback]: () => { calls++; throw new Error('display failed'); },
          onEnd: (result) => { ended.push({ ...result }); },
        }).promise;
        expect(calls).toBe(1);
        expect(ended).toHaveLength(1);
        expect(ended[0].status).toBe('failed');
        expect(ended[0].error).toBe('Provider auth failed\nRetry exhausted');
        expect(result.status).toBe('failed');
        expect(result.error).toBe(ended[0].error);
      });
    }

    test('caller onEnd can throw without duplicate delivery or a rejected promise', async () => {
      await plugin.initialize({ command });
      let calls = 0;
      let status: string | undefined;
      const result = await plugin.execute('test', [], {
        env: { FAKE_MODE: 'structured-error' },
        onEnd: (result) => { calls++; status = result.status; throw new Error('end failed'); },
      }).promise;
      expect(calls).toBe(1);
      expect(status).toBe('failed');
      expect(result.status).toBe('failed');
    });

    test('tool errors are recoverable and execution state does not leak', async () => {
      await plugin.initialize({ command });
      await plugin.execute('test', [], { env: { FAKE_MODE: 'structured-error' } }).promise;
      let display = '';
      const result = await plugin.execute('test', [], { env: { FAKE_MODE: 'tool-only' }, onStdout: (data) => { display += data; } }).promise;
      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
      expect(display).toContain('Recoverable tool error');
      expect(display).toContain('Recovered');
    });

    test('structured error diagnostics are displayed without Unknown error', async () => {
      await plugin.initialize({ command });
      let display = '';
      const result = await plugin.execute('test', [], { env: { FAKE_MODE: 'structured-error' }, onStdout: (text) => { display += text; } }).promise;
      expect(result.status).toBe('failed');
      expect(display).toContain('Provider auth failed');
      expect(display).toContain('Retry exhausted');
      expect(display).not.toContain('Unknown error');
    });

    test('a structured error does not replace a subsequent timeout', async () => {
      await plugin.initialize({ command, timeout: 200 });
      const result = await plugin.execute('test', [], { env: { FAKE_MODE: 'structured-error-hang' } }).promise;
      expect(result.status).toBe('timeout');
    });

    test('a structured error does not replace interruption', async () => {
      await plugin.initialize({ command });
      let handle: ReturnType<typeof plugin.execute>;
      handle = plugin.execute('test', [], {
        env: { FAKE_MODE: 'structured-error-hang' },
        onJsonlMessage: () => { handle.interrupt(); },
      });
      const result = await handle.promise;
      expect(result.status).toBe('interrupted');
      expect(result.interrupted).toBe(true);
    });

    test('preflight rejects a result error even when the wrapper exits zero', async () => {
      await writeFile(command, wrapperSource.replace('const mode = process.env.FAKE_MODE;', "const mode = 'structured-error';"));
      await plugin.initialize({ command });
      const result = await plugin.preflight();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.error).toContain('Provider auth failed');
      expect(result.stdout).toContain('Retry exhausted');
    });

    for (const [event, error] of [
      [{ type: 'result', subtype: 'error_max_turns', errors: [' ', 'Too many turns', null] }, 'Too many turns'],
      [{ type: 'result', is_error: true, result: 'Preferred result', errors: ['Other diagnostic'] }, 'Preferred result'],
      [{ type: 'result', is_error: true, result: {}, errors: ['Array fallback'] }, 'Array fallback'],
      [{ type: 'result', is_error: true, errors: [null, 42, ' '] }, 'Unknown error'],
      [{ type: 'error', error: { message: 'Nested error' } }, 'Nested error'],
    ] as const) {
      test(`preserves the structured diagnostic ${error}`, async () => {
        await writeFile(command, `#!/usr/bin/env bun\nprocess.stdout.write(${JSON.stringify(JSON.stringify(event))});\n`);
        await plugin.initialize({ command });
        const result = await plugin.execute('test').promise;
        expect(result.status).toBe('failed');
        expect(result.error).toBe(error);
      });
    }

    test('plain output is not reclassified as structured failure', async () => {
      await plugin.initialize({ command, printMode: 'text' });
      const result = await plugin.execute('test', [], { env: { FAKE_MODE: 'structured-error' } }).promise;
      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
    });

    test('subagent tracing requests structured output even in text mode', async () => {
      await plugin.initialize({ command, printMode: 'text' });
      const result = await plugin.execute('hello', [], { subagentTracing: true }).promise;
      expect(result.stdout).toContain('stream-json');
    });

    test('configuration timeout is enforced through the base lifecycle', async () => {
      await plugin.initialize({ command, timeout: 150 });
      const result = await plugin.execute('hello', [], { env: { FAKE_MODE: 'hang' } }).promise;
      expect(result.status).toBe('timeout');
      expect(result.interrupted).toBe(false);
      expect(result.durationMs).toBeLessThan(2000);
    });

    test('failed preflight suggests the provider wrapper and doctor', async () => {
      await plugin.initialize({ command, defaultFlags: ['--fail-provider'] });
      const result = await plugin.preflight();
      expect(result.success).toBe(false);
      expect(result.suggestion).toContain(`${plugin.meta.defaultCommand} --print`);
      expect(result.suggestion).toContain('cc-mirror doctor');
      expect(result.stderr).toContain('Provider authentication failed');
    });

    test('interruption is tracked by the base execution handle', async () => {
      await plugin.initialize({ command });
      let handle: ReturnType<typeof plugin.execute>;
      const options: AgentExecuteOptions = {
        env: { FAKE_MODE: 'hang' },
        onJsonlMessage: () => handle.interrupt(),
      };
      handle = plugin.execute('hello', [], options);
      const result = await handle.promise;
      expect(result.interrupted).toBe(true);
      expect(handle.isRunning()).toBe(false);
    });
  });
}
