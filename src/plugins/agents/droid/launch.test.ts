/**
 * ABOUTME: Tests Droid launch construction independently of its inherited lifecycle.
 * Covers platform wrappers, flag ordering, shell escaping, and base launch defaults.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { BaseAgentPlugin } from '../base.js';
import { SandboxWrapper } from '../../../sandbox/wrapper.js';
import type { AgentExecuteOptions } from '../types.js';
import { DroidAgentPlugin } from './index.js';

class LaunchProbe extends DroidAgentPlugin {
  launch(command: string, prompt: string, options?: AgentExecuteOptions) {
    return this.buildLaunchInvocation(command, this.buildArgs(prompt, [], options), options);
  }

  baseLaunch(command: string, args: string[], options?: AgentExecuteOptions) {
    return BaseAgentPlugin.prototype['buildLaunchInvocation'].call(this, command, args, options);
  }
}

let platform = spyOn(os, 'platform');
beforeEach(() => { platform = spyOn(os, 'platform'); });
afterEach(() => platform.mockRestore());

describe('Droid launch invocation', () => {
  test('inherits execution, interruption, and disposal from the base', () => {
    for (const method of ['execute', 'interrupt', 'interruptAll', 'getCurrentExecution', 'dispose'] as const) {
      expect(DroidAgentPlugin.prototype[method]).toBe(BaseAgentPlugin.prototype[method]);
      expect(Object.hasOwn(DroidAgentPlugin.prototype, method)).toBe(false);
    }
  });

  test('base launch preserves executable, arguments, and generic flag ordering', async () => {
    const agent = new LaunchProbe();
    await agent.initialize({ defaultFlags: ['--default'] });
    expect(agent.baseLaunch('/agent', ['run', 'prompt'], { flags: ['--extra'] })).toEqual({
      command: '/agent', args: ['--default', '--extra', 'run', 'prompt'],
    });
  });

  for (const currentPlatform of ['linux', 'darwin', 'win32'] as const) {
    test(`preserves ${currentPlatform} wrapper syntax, environment, and flag placement`, async () => {
      platform.mockReturnValue(currentPlatform);
      const agent = new LaunchProbe();
      await agent.initialize({ defaultFlags: ['--default', "it's"], model: 'model' });
      const invocation = agent.launch('/opt/agent path/droid', "line'\\\n\r\t$(touch sentinel)", {
        cwd: "/project's dir", flags: ['--extra', 'a b'],
      });
      expect(invocation.stdin).toBe('ignore');
      expect(invocation.env).toEqual({
        CI: 'true', TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', INK_DISABLE_INPUT: '1',
      });
      if (currentPlatform === 'win32') {
        expect(invocation.command).toBe('/opt/agent path/droid');
        expect(invocation.shell).toBe(true);
        expect(invocation.args).toEqual([
          'exec', '--output-format', 'stream-json', '--default', "it's", '--extra', 'a b',
          '--model', 'model', '--skip-permissions-unsafe', '--cwd', "/project's dir",
          "line'\\\n\r\t$(touch sentinel)",
        ]);
        expect(invocation.args.at(-1)).toBe("line'\\\n\r\t$(touch sentinel)");
      } else {
        expect(invocation.command).toBe('script');
        expect(invocation.shell).toBeUndefined();
        const shellCommand = currentPlatform === 'darwin' ? invocation.args[4] : invocation.args[2];
        expect(invocation.args).toEqual(currentPlatform === 'darwin'
          ? ['-q', '/dev/null', 'sh', '-c', shellCommand]
          : ['-q', '-c', shellCommand, '/dev/null']);
        expect(shellCommand).toStartWith("stty -echo 2>/dev/null; cd '/project'\\''s dir' && '/opt/agent path/droid' 'exec' '--output-format' 'stream-json' '--default' 'it'\\''s' '--extra' 'a b'");
        expect(shellCommand).toEndWith("$'line\\'\\\\\\n\\r\\t$(touch sentinel)'");
      }
    });
  }

  test('uses the effective process cwd when none is specified', () => {
    platform.mockReturnValue('linux');
    const invocation = new LaunchProbe().launch('droid', 'prompt');
    expect(invocation.args[2]).toContain(`cd '${process.cwd()}' &&`);
  });

  for (const currentPlatform of ['linux', 'win32'] as const) {
    test(`base spawn applies ${currentPlatform} launch options and sandbox ordering`, async () => {
      platform.mockReturnValue(currentPlatform);
      const proc = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), stdin: null,
      });
      const spawn = spyOn(childProcess, 'spawn').mockImplementation((() => {
        queueMicrotask(() => proc.emit('close', 0, null));
        return proc as unknown as childProcess.ChildProcess;
      }) as typeof childProcess.spawn);
      const wrap = spyOn(SandboxWrapper.prototype, 'wrapCommand').mockReturnValue({
        command: '/sandbox wrapper', args: ['wrapped'],
      });
      try {
        const agent = new LaunchProbe();
        await agent.initialize({ command: '/agent path/droid' });
        const result = await agent.execute('prompt', [], {
          cwd: '/working dir', timeout: 0, env: { CI: 'false', CUSTOM_VALUE: 'kept' },
          sandbox: { enabled: true, mode: 'bwrap' },
        }).promise;
        expect(result.status).toBe('completed');
        expect(wrap.mock.calls[0][0]).toBe(currentPlatform === 'linux' ? 'script' : '/agent path/droid');
        expect(wrap.mock.calls[0][1][0]).toBe(currentPlatform === 'linux' ? '-q' : 'exec');
        const [command, args, options] = spawn.mock.calls[0];
        expect(command).toBe(currentPlatform === 'win32' ? '"/sandbox wrapper"' : '/sandbox wrapper');
        expect(args).toEqual(['wrapped']);
        expect(options).toMatchObject({
          cwd: '/working dir', stdio: ['ignore', 'pipe', 'pipe'], shell: currentPlatform === 'win32',
          env: { CI: 'true', TERM: 'dumb', INK_DISABLE_INPUT: '1', CUSTOM_VALUE: 'kept' },
        });
      } finally {
        spawn.mockRestore();
        wrap.mockRestore();
      }
    });
  }
});
