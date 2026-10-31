/**
 * ABOUTME: Z.ai agent plugin for the cc-mirror zai wrapper.
 * Uses the shared Claude Code lifecycle and stream-json protocol.
 */

import { CcMirrorAgentPlugin } from './cc-mirror.js';
import type { AgentPluginFactory, AgentPluginMeta } from '../types.js';

export class ZaiAgentPlugin extends CcMirrorAgentPlugin {
  override readonly meta: AgentPluginMeta = {
    id: 'zai',
    name: 'Z.ai',
    description: 'Z.ai coding assistant via cc-mirror',
    author: 'Z.ai',
    version: '1.0.0',
    defaultCommand: 'zai',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.cc-mirror/zai/config/skills',
      repo: '.claude/skills',
    },
  };
}

const createZaiAgent: AgentPluginFactory = () => new ZaiAgentPlugin();
export default createZaiAgent;
