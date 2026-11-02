/**
 * ABOUTME: Runs DroidAgentPlugin against the process lifecycle fixture.
 * This subprocess keeps the test independent from other tests' module mocks.
 */

import { DroidAgentPlugin } from '../../../../src/plugins/agents/droid/index.js';
import { dirname } from 'node:path';
import * as os from 'node:os';
import { spyOn } from 'bun:test';

const mode = process.argv[2] ?? 'clean';
const fixturePath = process.env.AGENT_FIXTURE_PATH;
const scriptFixturePath = process.env.DROID_SCRIPT_FIXTURE_PATH;

if (!fixturePath) {
  throw new Error('AGENT_FIXTURE_PATH is required');
}

const agent = new DroidAgentPlugin();
await agent.initialize({
  command: fixturePath, defaultFlags: ['--default-flag'],
  envExclude: process.env.DROID_AUTH_CASE ? ['FACTORY_API_KEY'] : [],
  envPassthrough: process.env.DROID_AUTH_CASE === 'passthrough' ? ['FACTORY_API_KEY'] : [],
});
// Emulate direct Windows construction without claiming native Windows execution.
if (process.env.DROID_DIRECT_LAUNCH === '1') {
  spyOn(os, 'platform').mockReturnValue('win32');
}
let starts = 0;
let ends = 0;
let streamedStdout = '';
let streamedStderr = '';
let runningAtStart = false;
const currentPromises: Promise<unknown>[] = [];
const observeCurrent = () => {
  for (let i = 0; i < 2; i++) {
    const current = agent.getCurrentExecution();
    if (!current?.isRunning()) throw new Error('Missing running execution');
    currentPromises.push(current.promise);
  }
};
const handle = agent.execute(process.env.DROID_PROMPT ?? 'test prompt', [], {
  cwd: process.env.DROID_CWD,
  flags: ['--runtime-flag'],
  timeout: mode === 'timeout' ? 100 : 0,
  onStart: () => {
    starts++;
    runningAtStart = handle.isRunning();
    observeCurrent();
  },
  onEnd: () => { ends++; if (mode === 'throw-on-end') throw new Error('test callback'); },
  onStdout: (text) => {
    streamedStdout += text;
    observeCurrent();
    if (mode === 'interrupt') handle.interrupt();
    if (mode === 'interrupt-all') agent.interruptAll();
  },
  onStderr: (text) => { streamedStderr += text; },
  env: {
    SHELL: '/bin/bash',
    DROID_EXPLICIT_VALUE: 'explicit',
    CI: 'false',
    DROID_FIXTURE_MODE: mode,
    DROID_FIXTURE_PATH: fixturePath,
    ...(process.env.DROID_AUTH_CASE === 'explicit'
      ? { FACTORY_API_KEY: 'explicit-test-key' }
      : {}),
    ...(scriptFixturePath
      ? {
          PATH: `${dirname(scriptFixturePath)}:${process.env.PATH ?? ''}`,
        }
      : {}),
    ...(process.env.AGENT_CHILD_PID_FILE
      ? { AGENT_CHILD_PID_FILE: process.env.AGENT_CHILD_PID_FILE }
      : {}),
  },
});
if (mode === 'early-interrupt') handle.interrupt();
const result = await handle.promise;
const currentResults = await Promise.all(currentPromises);

console.log(JSON.stringify({ ...result, starts, ends, runningAtStart,
  runningAfterEnd: handle.isRunning(), streamedStdout, streamedStderr,
  currentAfterEnd: agent.getCurrentExecution() !== undefined,
  currentHandlesMatch: currentResults.every((value) => value === result),
  currentPromisesMatch: currentPromises.every((value) => value === handle.promise),
  currentObserverCount: currentPromises.length,
}));
