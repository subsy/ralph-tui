/**
 * ABOUTME: Syntax, metadata projection and resource-limit tests for oversized JSONL validation.
 */
import { expect, test } from 'bun:test';
import { ClaudeJsonRecord } from './claude-json-record.js';

function validate(text: string, size = 8192) {
  const validator = new ClaudeJsonRecord();
  for (let offset = 0; offset < text.length; offset += size) validator.write(text.slice(offset, offset + size));
  return validator.finish();
}

for (const size of [1, 2, 7, 8192]) {
  test(`projects escaped metadata and validates payload syntax in ${size}-character chunks`, () => {
    const text = '{"payload":[null,true,false,-1.23e+7,{"unicode":"é😀\\uD800\\u2028","escaped":"\\\"\\\\\\/\\n\\t"}],"t\\u0079pe":"u\\u0073er","is_error":false}';
    expect(() => JSON.parse(text)).not.toThrow();
    const result = validate(text, size);
    expect(result.error).toBeUndefined();
    expect(result.metadata).toEqual({ type: 'user', is_error: false });
  });
  for (const text of [
    '{', '{"type":"user"', '{"a":"unterminated', '{"a":"\\x00"}', '{"a":"\\u123Z"}',
    '{"a":"unescaped\nnewline"}', '{"a":undefined}', '{"a":NaN}', '{"a":Infinity}',
    '{"a":01}', '{"a":1.}', '{"a":1e}', '{"a":1e+}', '{"a":+1}', '{"a":.1}',
    '{"a":truefalse}', '{"a":tru}', '{"a" 1}', '{"a":1,}', '{a:1}',
    '{"a":[1,]}', '{"a":[1}', '{"a":{]}', '{"a":1}{}', '{"a":1}false',
    '{"a":1}\u00a0', '\uFEFF{}', '{\v"type":"user"}', '[{}]', 'null', '42',
  ]) {
    test(`rejects malformed/unsupported ${JSON.stringify(text)} at chunk size ${size}`, () => {
      expect(validate(text, size).error).toBeDefined();
    });
  }
}

test('keeps late failure metadata and bounded error prefixes without assembling payloads', () => {
  const result = validate(JSON.stringify({ payload: 'x'.repeat(2_100_000), error: { message: 'Fatal'.repeat(2000) }, type: 'error' }), 16384);
  expect(result.error).toBeUndefined();
  expect(result.metadata.type).toBe('error');
  expect((result.metadata.error as { message: string }).message).toHaveLength(1024 + ' [truncated]'.length);
  expect(JSON.stringify(result.metadata).length).toBeLessThan(1200);
});

for (const [name, text] of [
  ['key', JSON.stringify({ ['k'.repeat(257)]: 0, type: 'user' })],
  ['metadata', JSON.stringify({ type: 'u'.repeat(257) })],
  ['number', '{"a":' + '1'.repeat(1025) + ',"type":"user"}'],
  ['nesting', '{"a":' + '['.repeat(64) + '0' + ']'.repeat(64) + ',"type":"user"}'],
  ['error metadata', JSON.stringify({ errors: Array(17).fill('failure'), type: 'error' })],
  ['duplicate metadata', '{"type":"error","type":"user"}'],
  ['unsupported metadata', '{"type":"user","is_error":"true"}'],
  ['unsupported metadata container', '{"type":{"value":"user"}}'],
  ['tokens', '{"a":[' + '0,'.repeat(500_001) + '0],"type":"user"}'],
] as const) {
  test(`fails closed at the ${name} bound`, () => {
    expect(validate(text).error).toBeDefined();
  });
}

test('the maximum supported nesting/key/number bounds are inclusive', () => {
  expect(validate('{"' + 'k'.repeat(256) + '":' + '['.repeat(63) + '1'.repeat(1024) + ']'.repeat(63) + ',"type":"user"}').error).toBeUndefined();
});

test('primitive fragmentation cannot change the structural token budget', () => {
  const text = JSON.stringify({ payload: 'x'.repeat(1_100_000), type: 'user' });
  expect(validate(text, 1)).toEqual(validate(text, 8192));
  expect(validate(text, 1).error).toBeUndefined();
});

test('bounded numeric error metadata preserves JSON.parse truthiness', () => {
  for (const value of ['0', '-0', '1e-999', '1', '-2', '1e999']) {
    const text = '{"error":' + value + ',"type":"user"}';
    expect(validate(text, 1).metadata.error).toBe(JSON.parse(text).error);
  }
});

test('diagnostic arrays are bounded and metadata fields are order independent', () => {
  const meta = { type: 'result', is_error: true, subtype: 'error_max_turns', errors: ['fatal', null, 42, 'second'] };
  for (const fields of [meta, Object.fromEntries(Object.entries(meta).reverse())]) {
    expect(validate(JSON.stringify(fields), 1)).toEqual({ metadata: { ...meta, errors: ['fatal', 'second'] }, error: undefined });
  }
});
