/**
 * ABOUTME: Contract and subprocess tests for cc-mirror MiniMax and Z.ai agents.
 * Exercises shared Claude execution with deterministic local wrapper stand-ins.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createMiniMaxAgent, { MiniMaxAgentPlugin } from '../../src/plugins/agents/builtin/minimax.js';
import createZaiAgent, { ZaiAgentPlugin } from '../../src/plugins/agents/builtin/zai.js';
import { registerBuiltinAgents } from '../../src/plugins/agents/builtin/index.js';
import { getAgentRegistry } from '../../src/plugins/agents/registry.js';
import type { AgentExecuteOptions, AgentFileContext } from '../../src/plugins/agents/types.js';

const wrapperSource = `#!/usr/bin/env bun
if (process.argv.includes('--version')) {
  console.log('cc-mirror provider');
  process.exit(0);
}
if (process.argv.includes('--fail-provider')) {
  console.error('Provider authentication failed');
  process.exit(1);
}
if (process.env.FAKE_MODE === 'hang') {
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
      expect(result.status).toBe('completed');
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
