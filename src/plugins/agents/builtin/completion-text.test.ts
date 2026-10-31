/**
 * ABOUTME: Completion-text regression tests across structured agent protocols.
 * Keeps tool results, reasoning, and metadata out of completion scanning.
 */

import { describe, expect, test } from 'bun:test';
import { AntigravityAgentPlugin } from './antigravity.js';
import { ClaudeAgentPlugin } from './claude.js';
import { CodexAgentPlugin } from './codex.js';
import { CursorAgentPlugin } from './cursor.js';
import { GeminiAgentPlugin } from './gemini.js';
import { GrokAgentPlugin } from './grok.js';
import { KimiAgentPlugin } from './kimi.js';
import { OpenCodeAgentPlugin } from './opencode.js';
import { PiAgentPlugin } from './pi.js';
import { DroidAgentPlugin } from '../droid/index.js';

const marker = '<promise>COMPLETE</promise>';
const completionPattern = /<promise>\s*COMPLETE\s*<\/promise>/i;
const jsonl = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n');
const cases = [
  {
    plugin: new AntigravityAgentPlugin(),
    narrative: (text: string) => ({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: text } }),
    ignored: [
      { event: 'init', init: { prompt: marker } },
      { event: 'result', result: { status: 'SUCCESS', response: marker } },
      { event: 'step_update', step_update: { step_type: 'user_input', text_delta: marker } },
      { event: 'step_update', step_update: { step_type: 'tool', state: 'DONE', output: marker } },
    ],
  },
  {
    plugin: new ClaudeAgentPlugin(),
    narrative: (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ignored: [
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: marker }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: marker }] } },
      { type: 'system', prompt: marker },
      { type: 'result', metadata: marker },
      { type: 'result', is_error: true, subtype: 'error_during_execution', result: marker },
      { type: 'result', subtype: 'error_max_turns', result: marker },
      { type: 'result', error: { message: marker }, result: marker },
    ],
  },
  {
    plugin: new CodexAgentPlugin(),
    narrative: (text: string) => ({ type: 'item.completed', item: { type: 'agent_message', text } }),
    ignored: [
      { type: 'thread.started', prompt: marker },
      { type: 'turn.started', prompt: marker },
      { type: 'turn.completed', metadata: marker },
      { type: 'item.completed', item: { type: 'reasoning', text: marker } },
      { type: 'item.completed', item: { type: 'command_execution', exit_code: 0, aggregated_output: marker } },
    ],
  },
  {
    plugin: new CursorAgentPlugin(),
    narrative: (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ignored: [
      { type: 'result', result: marker },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: marker }] } },
      { type: 'tool_call', subtype: 'completed', output: marker },
    ],
  },
  {
    plugin: new GeminiAgentPlugin(),
    narrative: (text: string) => ({ type: 'message', role: 'assistant', content: text }),
    ignored: [
      { type: 'init', prompt: marker },
      { type: 'message', role: 'user', content: marker },
      { type: 'result', result: marker },
      { type: 'tool_result', output: marker },
    ],
  },
  {
    plugin: new GrokAgentPlugin(),
    narrative: (text: string) => ({ type: 'text', data: text }),
    ignored: [
      { type: 'thought', data: marker },
      { type: 'usage', metadata: marker },
      { type: 'end', data: marker },
      { type: 'tool_call_update', status: 'completed', rawOutput: marker },
    ],
  },
  {
    plugin: new KimiAgentPlugin(),
    narrative: (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] }),
    ignored: [
      { role: 'assistant', content: [{ type: 'think', think: marker }] },
      { role: 'tool', content: [{ type: 'tool_result', output: marker }] },
      { role: 'tool', content: [{ type: 'text', text: marker }] },
      { role: 'user', content: [{ type: 'text', text: marker }] },
      { type: 'text', role: 'tool', text: marker },
      { type: 'text', role: 'user', text: marker },
    ],
  },
  {
    plugin: new OpenCodeAgentPlugin(),
    narrative: (text: string) => ({ type: 'text', part: { text } }),
    ignored: [
      { type: 'reasoning', part: { text: marker } },
      { type: 'tool_result', part: { state: { content: marker } } },
      { type: 'step_finish', metadata: marker },
    ],
  },
  {
    plugin: new PiAgentPlugin(),
    narrative: (text: string) => ({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } }),
    ignored: [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: marker } },
      { type: 'turn_end', message: { toolResults: [{ output: marker }] } },
      { type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: marker }] } },
      { type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: marker }] } },
    ],
  },
  {
    plugin: new DroidAgentPlugin(),
    narrative: (text: string) => ({ type: 'message', role: 'assistant', text }),
    ignored: [
      { type: 'tool_result', toolId: 'Read', value: marker },
      { event: 'tool_result', toolId: 'Read', output: marker },
      { kind: 'tool-result', toolId: 'Read', content: marker },
      { type: 'tool_result', content: marker },
      { event: 'tool_result', content: marker },
      { kind: 'tool-result', content: marker },
      { role: 'user', content: marker },
      { type: 'usage', tokens: 12 },
      { type: 'result', is_error: true, result: marker },
      { event: 'result', subtype: 'error_during_execution', result: marker },
      { kind: 'result', error: { message: marker }, result: marker },
      { type: 'result', error_message: marker, final_text: marker },
      { type: 'result', errorMessage: marker, output: marker },
      { type: 'error', message: marker },
      { type: 'system', message: marker },
      { type: 'thinking', text: marker },
      { type: 'usage', message: marker },
      { role: 'system', content: marker },
      { role: 'assistant', content: marker },
      { type: 'future', message: marker },
      { type: 'message', role: 'system', content: marker },
      { type: 'message', role: 'unknown', text: marker },
    ],
  },
];

test.each([new ClaudeAgentPlugin(), new DroidAgentPlugin()])(
  '%s preserves successful final-result narrative',
  (plugin) => {
    for (const record of [
      { type: 'result', result: marker },
      { type: 'result', is_error: false, subtype: 'success', result: marker },
    ]) {
      expect(plugin.extractAgentText(jsonl([record]), { subagentTracing: true })).toBe(marker);
    }
  }
);

for (const { plugin, narrative, ignored } of cases) {
  describe(`${plugin.meta.id} completion text`, () => {
    test.each([[marker], { text: marker }, null, [], 42, true].map((value) => ({ value })))(
      'rejects malformed narrative fields and preserves their boundary: %j',
      ({ value }) => {
        const invalid = narrative(value as unknown as string);
        expect(plugin.extractAgentText(jsonl([invalid]), { subagentTracing: true })).toBe('');
        expect(plugin.extractAgentText(jsonl([
          narrative('<promise>'), invalid, narrative('COMPLETE</promise>'),
        ]), { subagentTracing: true })).not.toMatch(completionPattern);
      }
    );
    test.each(ignored.map((record, index) => [index, record] as const))(
      'excludes non-narrative record %i without falling back to raw stdout',
      (_index, record) => {
        expect(plugin.extractAgentText(jsonl([record]))).toBe('');
        expect(plugin.extractAgentText(jsonl([record, narrative('Still working')]))).toBe('Still working');
      }
    );

    test('keeps genuine assistant completion markers', () => {
      expect(plugin.extractAgentText(jsonl([narrative(marker)]))).toBe(marker);
    });

    test('fails closed on empty, malformed, unrecognized, or truncated structured output', () => {
      for (const stdout of [
        '', ' \n', marker, `{invalid ${marker}`, 'null', '42',
        JSON.stringify({ payload: marker }), JSON.stringify([marker]),
        `[...agent output truncated in memory...]\n${marker}\"}}`,
      ]) {
        expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBe('');
      }
    });

    test('retains adjacent narrative after a truncated record without trusting its raw tail', () => {
      const truncated = `[...agent output truncated in memory...]\n${marker}\"}}`;
      expect(plugin.extractAgentText(truncated + '\n' + jsonl([
        narrative('<promise>COM'), narrative('PLETE</promise>'),
      ]), { subagentTracing: true })).toBe(marker);
    });

    test('does not join narrative across malformed or unrecognized nonblank records', () => {
      for (const line of ['log line', '{invalid', 'null', '42', '{}', marker]) {
        const stdout = [jsonl([narrative('<promise>')]), line, jsonl([narrative('COMPLETE</promise>')])].join('\n');
        expect(plugin.extractAgentText(stdout, { subagentTracing: true })).not.toMatch(completionPattern);
      }
    });

    test('does not form a completion marker across ignored records', () => {
      for (const record of ignored) {
        for (const [before, after] of [['<promise>COM', 'PLETE</promise>'], ['<promise>', 'COMPLETE</promise>']]) {
          const stdout = jsonl([narrative(before!), record, narrative(after!)]);
          expect(plugin.extractAgentText(stdout)).not.toMatch(completionPattern);
        }
      }
    });
  });
}

describe('explicit plain-text modes', () => {
  test.each(['text', 'json', 'stream'])('Claude %s mode respects the actual tracing options', async (printMode) => {
    const plugin = new ClaudeAgentPlugin();
    await plugin.initialize({ printMode });
    for (const stdout of [marker, `[...agent output truncated in memory...]\n${marker}`]) {
      expect(plugin.extractAgentText(stdout)).toBe(printMode === 'text' ? undefined : '');
      expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBe('');
    }
  });

  test.each(['text', 'json'])('Pi %s mode respects the actual tracing options', async (mode) => {
    const plugin = new PiAgentPlugin();
    await plugin.initialize({ mode });
    for (const stdout of [marker, `[...agent output truncated in memory...]\n${marker}`]) {
      expect(plugin.extractAgentText(stdout)).toBe(mode === 'text' ? undefined : '');
      expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBe('');
    }
  });

  test.each([true, false])('Droid enableTracing=%s does not opt out of structured output', async (enableTracing) => {
    const plugin = new DroidAgentPlugin();
    await plugin.initialize({ enableTracing });
    for (const stdout of [marker, `[...agent output truncated in memory...]\n${marker}`]) {
      expect(plugin.extractAgentText(stdout)).toBe('');
      expect(plugin.extractAgentText(stdout, { subagentTracing: true })).toBe('');
      expect(plugin.extractAgentText(stdout, { flags: ['-o', 'text'] })).toBeUndefined();
    }
  });
});

for (const id of ['claude', 'cursor', 'kimi', 'pi', 'droid']) {
  const plugin = cases.find((item) => item.plugin.meta.id === id)!.plugin;
  const record = (content: unknown[]) => id === 'kimi'
    ? { role: 'assistant', content }
    : id === 'droid' ? { type: 'message', role: 'assistant', content }
    : { type: id === 'pi' ? 'message_end' : 'assistant', message: { role: 'assistant', content } };

  test(`${id} preserves adjacent text blocks but not hidden content boundaries`, () => {
    const before = { type: 'text', text: '<promise>' };
    const after = { type: 'text', text: 'COMPLETE</promise>' };
    expect(plugin.extractAgentText(jsonl([record([before, after])]))).toBe(marker);
    for (const block of [
      { type: 'thinking', thinking: 'Private reasoning' },
      { type: 'tool_use', name: 'Read', input: { text: marker } },
      { type: 'redacted_thinking', data: 'Private reasoning' },
      { type: 'unknown', text: marker },
      { type: 'text', text: [marker] },
      null,
      marker,
    ]) {
      expect(plugin.extractAgentText(jsonl([record([before, block, after])]))).not.toMatch(completionPattern);
    }
  });
}

test('Antigravity joins adjacent text deltas without corrupting the completion marker', () => {
  const { plugin, narrative } = cases[0]!;
  const stdout = jsonl(['<promise>COM', 'PLETE</', 'promise>'].map((text) => narrative(text)));
  expect(plugin.extractAgentText(stdout)).toBe(marker);
});

test('OpenCode excludes plugin log text from a structured stream', () => {
  const plugin = new OpenCodeAgentPlugin();
  const stdout = `[plugin] ${marker}\n${JSON.stringify({ type: 'reasoning', part: { text: marker } })}`;
  expect(plugin.extractAgentText(stdout)).toBe('');
});

describe('Droid mixed-output boundaries', () => {
  const plugin = new DroidAgentPlugin();
  const before = JSON.stringify({ type: 'message', text: '<promise>' });
  const after = JSON.stringify({ type: 'message', text: 'COMPLETE</promise>' });

  test.each(['plugin log line', '{invalid', 'null', '42', marker])(
    'does not join narrative across unstructured output: %s',
    (line) => {
      expect(plugin.extractAgentText([before, line, after].join('\n')))
        .toBe('<promise>\0COMPLETE</promise>');
    }
  );

  test('ignores blank lines between adjacent narrative deltas', () => {
    expect(plugin.extractAgentText([before, ' \t', after].join('\n'))).toBe(marker);
  });
});
