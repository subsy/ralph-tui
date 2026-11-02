/**
 * ABOUTME: Runs DroidAgentPlugin against the process lifecycle fixture.
 * This subprocess keeps the test independent from other tests' module mocks.
 */

import { DroidAgentPlugin } from '../../../../src/plugins/agents/droid/index.js';
import { dirname } from 'node:path';

const mode = process.argv[2] ?? 'clean';
const fixturePath = process.env.AGENT_FIXTURE_PATH;
const scriptFixturePath = process.env.DROID_SCRIPT_FIXTURE_PATH;

if (!fixturePath) {
  throw new Error('AGENT_FIXTURE_PATH is required');
}

const agent = new DroidAgentPlugin();
await agent.initialize({ command: fixturePath });
const result = await agent.execute('test prompt', [], {
  env: {
    DROID_FIXTURE_MODE: mode,
    DROID_FIXTURE_PATH: fixturePath,
    ...(scriptFixturePath
      ? {
          PATH: `${dirname(scriptFixturePath)}:${process.env.PATH ?? ''}`,
        }
      : {}),
    ...(process.env.AGENT_CHILD_PID_FILE
      ? { AGENT_CHILD_PID_FILE: process.env.AGENT_CHILD_PID_FILE }
      : {}),
  },
}).promise;

console.log(JSON.stringify(result));
