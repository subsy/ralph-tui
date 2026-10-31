/**
 * ABOUTME: Tests Droid's declared output format across command, config, and setup.
 * Keeps launch argument ordering and completion extraction on the same contract.
 */

import { describe, expect, test } from 'bun:test';
import { buildDroidCommandArgs, getDroidOutputFormat } from './commandBuilder.js';
import { DroidAgentPlugin } from './index.js';
import { BaseAgentPlugin } from '../base.js';
import { AgentRegistry } from '../registry.js';
import { DroidAgentConfigSchema } from './schema.js';
import type { AgentExecuteOptions } from '../types.js';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class TestDroid extends DroidAgentPlugin {
  args(prompt: string, options?: AgentExecuteOptions): string[] {
    return this.buildArgs(prompt, undefined, options);
  }
}

describe('Droid output format contract', () => {
  test('inherits the base execution lifecycle', () => {
    expect(DroidAgentPlugin.prototype.execute).toBe(BaseAgentPlugin.prototype.execute);
  });

  test('requests stream-json by default before explicit flags and preserves the prompt', () => {
    expect(buildDroidCommandArgs({ prompt: '--output-format=text', cwd: '/workspace' })).toEqual([
      'exec', '--output-format', 'stream-json', '--cwd', '/workspace', '--output-format=text',
    ]);
    expect(buildDroidCommandArgs({
      prompt: 'task', cwd: '/workspace', outputFormat: 'text', flags: ['-o', 'json'],
      model: 'model-1', reasoningEffort: 'high', skipPermissions: true,
    })).toEqual([
      'exec', '--output-format', 'text', '-o', 'json', '--model', 'model-1',
      '--reasoning-effort', 'high', '--skip-permissions-unsafe', '--cwd', '/workspace', 'task',
    ]);
  });

  test('validates the typed format configuration with a structured default', () => {
    expect(DroidAgentConfigSchema.parse({}).outputFormat).toBe('stream-json');
    for (const outputFormat of ['stream-json', 'json', 'text'] as const) {
      expect(DroidAgentConfigSchema.parse({ outputFormat }).outputFormat).toBe(outputFormat);
    }
    for (const outputFormat of ['', 'future', 'stream-jsonrpc', null, []]) {
      expect(DroidAgentConfigSchema.safeParse({ outputFormat }).success).toBe(false);
    }
  });

  test('exposes the default and explicit plaintext opt-out during setup', async () => {
    const plugin = new TestDroid();
    const question = plugin.getSetupQuestions().find((item) => item.id === 'outputFormat');
    expect(question?.default).toBe('stream-json');
    expect(question?.choices?.map((choice) => choice.value)).toEqual(['stream-json', 'json', 'text']);
    for (const outputFormat of question!.choices!.map((choice) => choice.value)) {
      await plugin.initialize({ outputFormat });
      expect(plugin.args('task').slice(0, 3)).toEqual(['exec', '--output-format', outputFormat]);
    }
  });

  test.each(['', 'future', 'stream-jsonrpc', null, []])(
    'rejects invalid outputFormat %j before becoming ready or cacheable', async (outputFormat) => {
      const plugin = new TestDroid();
      await expect(plugin.initialize({ outputFormat, skipPermissions: false })).rejects.toThrow('outputFormat');
      expect(await plugin.isReady()).toBe(false);

      AgentRegistry.resetInstance();
      const registry = AgentRegistry.getInstance();
      registry.registerBuiltin(() => new TestDroid());
      const config = { name: 'format-validation', plugin: 'droid', options: { outputFormat, skipPermissions: false } };
      try {
        await expect(registry.getInstance(config)).rejects.toThrow('outputFormat');
        const corrected = await registry.getInstance({
          ...config, options: { outputFormat: 'text', skipPermissions: false },
        }) as TestDroid;
        expect(corrected.args('task')).toEqual(['exec', '--output-format', 'text', '--cwd', process.cwd(), 'task']);
        expect(await registry.getInstance(config)).toBe(corrected);
      } finally {
        await registry.disposeAll();
        AgentRegistry.resetInstance();
      }
    },
  );

  test.each([true, false])('does not derive output format from tracing: %s', async (enableTracing) => {
    const plugin = new TestDroid();
    await plugin.initialize({ enableTracing });
    expect(plugin.meta.supportsSubagentTracing).toBe(false);
    for (const subagentTracing of [true, false]) {
      expect(plugin.args('task', { subagentTracing }).slice(0, 3)).toEqual(['exec', '--output-format', 'stream-json']);
      expect(plugin.extractAgentText('<promise>COMPLETE</promise>', { subagentTracing })).toBe('');
    }
  });

  test.each([
    { outputFormat: 'stream-json', defaultFlags: [], flags: [], effective: 'stream-json' },
    { outputFormat: 'text', defaultFlags: [], flags: [], effective: 'text' },
    { outputFormat: 'text', defaultFlags: ['-o', 'json'], flags: [], effective: 'json' },
    { outputFormat: 'stream-json', defaultFlags: ['-o', 'json'], flags: ['--output-format', 'text'], effective: 'text' },
    { outputFormat: 'text', defaultFlags: ['--output-format=text'], flags: ['-o=stream-json'], effective: 'stream-json' },
    { outputFormat: 'text', defaultFlags: ['-o', 'json'], flags: ['--', '-o=text'], effective: 'json' },
    { outputFormat: 'stream-json', defaultFlags: ['--'], flags: ['-o=text'], effective: 'stream-json' },
    { outputFormat: 'stream-json', defaultFlags: [], flags: ['--output-format', '--', '-o', 'text'], effective: '' },
    { outputFormat: 'stream-json', defaultFlags: [], flags: ['-o', 'future'], effective: 'future' },
  ])('uses configured flags then per-call overrides in exact argv: %j', async ({ outputFormat, defaultFlags, flags, effective }) => {
    const plugin = new TestDroid();
    await plugin.initialize({ outputFormat, defaultFlags, enableTracing: false });
    const args = plugin.args('task', { flags: [...flags], cwd: '/workspace', subagentTracing: true });
    expect(args).toEqual([
      'exec', '--output-format', outputFormat, ...defaultFlags, ...flags,
      '--skip-permissions-unsafe', '--cwd', '/workspace', 'task',
    ]);
    expect(getDroidOutputFormat(args.slice(1, -1))).toBe(effective);
    expect(plugin.extractAgentText('{"type":"example"}\n<promise>COMPLETE</promise>', { flags: [...flags] }))
      .toBe(effective === 'text' ? undefined : '');
  });

  test('does not reinterpret generated values or prompt text as format flags', async () => {
    const plugin = new TestDroid();
    await plugin.initialize({ model: '--output-format=text', reasoningEffort: 'high' });
    const options = { flags: ['--append-system-prompt', '--output-format=text'], cwd: '-o=text' };
    const args = plugin.args('--output-format=text', options);
    expect(args.at(-1)).toBe('--output-format=text');
    expect(getDroidOutputFormat(args.slice(1, -1))).toBe('stream-json');
    expect(plugin.extractAgentText('<promise>COMPLETE</promise>', options)).toBe('');
    for (const flag of ['--model', '-m', '--cwd', '--reasoning-effort', '-r', '--file', '-f', '--tag']) {
      expect(getDroidOutputFormat(['--output-format', 'stream-json', flag, '--output-format=text'])).toBe('stream-json');
    }
    expect(getDroidOutputFormat(['--worktree', '--output-format', 'text'])).toBe('text');
  });

  test.each(['--restrict-tools', '--additional-tools', '--disabled-tools'])(
    'keeps %s values out of format selection', async (flag) => {
      const plugin = new TestDroid();
      await plugin.initialize({ defaultFlags: [flag, '--output-format=text'] });
      expect(getDroidOutputFormat(plugin.args('task').slice(1, -1))).toBe('stream-json');
      expect(plugin.extractAgentText('<promise>COMPLETE</promise>')).toBe('');
      expect(plugin.extractAgentText('{"type":"message","text":"<promise>COMPLETE</promise>"}'))
        .toBe('<promise>COMPLETE</promise>');
      expect(plugin.extractAgentText('<promise>COMPLETE</promise>', { flags: ['-o=text'] })).toBeUndefined();
    },
  );

  test.skipIf(process.platform === 'win32')('launches per-call format overrides in the same order extraction uses', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'droid-format-'));
    const capture = join(cwd, 'argv.txt');
    const command = join(cwd, 'fake-droid');
    const stdout = '{"type":"example"}\n<promise>COMPLETE</promise>';
    await writeFile(command, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(capture)}\nprintf '%s\\n' '${stdout}'\n`);
    await chmod(command, 0o755);
    try {
      for (const { outputFormat, defaultFlags, flags, text } of [
        { outputFormat: 'stream-json', defaultFlags: [], flags: [], text: false },
        { outputFormat: 'stream-json', defaultFlags: [], flags: ['--output-format', 'text'], text: true },
        { outputFormat: 'stream-json', defaultFlags: ['-o', 'json'], flags: ['-o=text'], text: true },
        { outputFormat: 'text', defaultFlags: ['--output-format=text'], flags: ['-o', 'stream-json'], text: false },
        { outputFormat: 'stream-json', defaultFlags: ['--'], flags: ['-o=text'], text: false },
        { outputFormat: 'stream-json', defaultFlags: [], flags: ['--output-format', '--', '-o', 'text'], text: false },
        ...['--restrict-tools', '--additional-tools', '--disabled-tools'].flatMap((flag) => [
          { outputFormat: 'stream-json', defaultFlags: [flag, '--output-format=text'], flags: [], text: false },
          { outputFormat: 'stream-json', defaultFlags: [], flags: [flag, '--output-format=text'], text: false },
          { outputFormat: 'stream-json', defaultFlags: [flag, '--output-format=text'], flags: ['-o=text'], text: true },
        ]),
      ]) {
        const plugin = new TestDroid();
        await plugin.initialize({ command, outputFormat, defaultFlags, enableTracing: false });
        const options = { cwd, flags, subagentTracing: true };
        const result = await plugin.execute('task', undefined, options).promise;
        expect(result.exitCode).toBe(0);
        expect((await readFile(capture, 'utf8')).trimEnd().split('\n')).toEqual(plugin.args('task', options));
        expect(result.stdout).toContain('<promise>COMPLETE</promise>');
        expect(plugin.extractAgentText(result.stdout, options)).toBe(text ? undefined : '');
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
