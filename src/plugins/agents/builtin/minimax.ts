/**
 * ABOUTME: MiniMax agent plugin for the cc-mirror minimax wrapper.
 * Uses the shared Claude Code lifecycle and stream-json protocol.
 */

import { CcMirrorAgentPlugin } from './cc-mirror.js';
import type { AgentPluginFactory, AgentPluginMeta } from '../types.js';

export class MiniMaxAgentPlugin extends CcMirrorAgentPlugin {
  override readonly meta: AgentPluginMeta = {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax coding assistant via cc-mirror',
    author: 'MiniMax',
    version: '1.0.0',
    defaultCommand: 'minimax',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.cc-mirror/minimax/config/skills',
      repo: '.claude/skills',
    },
  };
}

const createMiniMaxAgent: AgentPluginFactory = () => new MiniMaxAgentPlugin();
export default createMiniMaxAgent;
