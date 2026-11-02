/**
 * ABOUTME: Runs BaseAgentPlugin against the process lifecycle fixture.
 * This subprocess keeps the test independent from other tests' module mocks.
 */

import { BaseAgentPlugin } from '../../../../src/plugins/agents/base.js';
import type {
  AgentDetectResult,
  AgentExecuteOptions,
  AgentFileContext,
  AgentPluginMeta,
} from '../../../../src/plugins/agents/types.js';

class FixtureAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'fixture-agent',
    name: 'Fixture Agent',
    description: 'Process lifecycle test fixture',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: 'fixture-agent',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    return [prompt];
  }

  override async detect(): Promise<AgentDetectResult> {
    return {
      available: true,
      executablePath: this.meta.defaultCommand,
    };
  }
}

const mode = process.argv[2] ?? 'clean';
const fixturePath = process.env.AGENT_FIXTURE_PATH;

if (!fixturePath) {
  throw new Error('AGENT_FIXTURE_PATH is required');
}

const agent = new FixtureAgentPlugin();
await agent.initialize({ command: fixturePath });
const result = await agent.execute(mode, [], {
  env: process.env.AGENT_CHILD_PID_FILE
    ? { AGENT_CHILD_PID_FILE: process.env.AGENT_CHILD_PID_FILE }
    : undefined,
}).promise;

console.log(JSON.stringify(result));
