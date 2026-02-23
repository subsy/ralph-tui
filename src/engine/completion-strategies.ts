/**
 * ABOUTME: Pluggable completion detection strategies.
 * Provides multiple methods for detecting when an agent has finished a task.
 */

import type { AgentExecutionResult } from '../plugins/agents/types.js';

export interface CompletionStrategy {
  name: string;
  detect(agentResult: AgentExecutionResult): boolean;
}

/**
 * Original strategy: explicit <promise>COMPLETE</promise> tag.
 */
export const promiseTagStrategy: CompletionStrategy = {
  name: 'promise-tag',
  detect(result) {
    return /<promise>\s*COMPLETE\s*<\/promise>/i.test(result.stdout);
  },
};

/**
 * Relaxed tag strategy: catches common agent mutations like
 * wrapping in code fences, adding quotes, or slight formatting changes.
 */
export const relaxedTagStrategy: CompletionStrategy = {
  name: 'relaxed-tag',
  detect(result) {
    // Match even inside markdown code blocks, or alternate "promise: complete" phrasing
    return /<promise>\s*COMPLETE\s*<\/promise>/i.test(result.stdout) ||
      /\bpromise\s*:\s*complete\b/i.test(result.stdout);
  },
};

/**
 * Detect completion based on the agent's final lines containing
 * clear completion language and exit code 0.
 * Only used as a fallback — never as primary.
 */
export const heuristicStrategy: CompletionStrategy = {
  name: 'heuristic',
  detect(result) {
    if (result.exitCode !== 0) return false;
    // Check last 500 chars for strong completion signals
    const tail = result.stdout.slice(-500).toLowerCase();
    const completionPhrases = [
      'all acceptance criteria met',
      'all tasks complete',
      'implementation complete',
      'all checks pass',
    ];
    return completionPhrases.some(phrase => tail.includes(phrase));
  },
};

export type CompletionStrategyName = 'promise-tag' | 'relaxed-tag' | 'heuristic';

const strategyMap: Record<CompletionStrategyName, CompletionStrategy> = {
  'promise-tag': promiseTagStrategy,
  'relaxed-tag': relaxedTagStrategy,
  'heuristic': heuristicStrategy,
};

/**
 * Run strategies in order, return true on first match.
 */
export function detectCompletion(
  agentResult: AgentExecutionResult,
  strategies: CompletionStrategyName[] = ['promise-tag'],
): { completed: boolean; matchedStrategy: string | null } {
  for (const name of strategies) {
    const strategy = strategyMap[name];
    if (strategy && strategy.detect(agentResult)) {
      return { completed: true, matchedStrategy: name };
    }
  }
  return { completed: false, matchedStrategy: null };
}
