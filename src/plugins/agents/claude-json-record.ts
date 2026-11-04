/**
 * ABOUTME: Bounded synchronous validation and metadata projection for oversized Claude JSONL records.
 */
import type { TransformCallback } from 'node:stream';
import Parser from 'stream-json/Parser.js';

const INPUT_CHARS = 8192;
const MAX_DEPTH = 64;
const MAX_KEY_CHARS = 256;
const MAX_NUMBER_CHARS = 1024;
const MAX_DIAGNOSTIC_CHARS = 1024;
const MAX_ERRORS = 16;
const MAX_RECORD_CHARS = 256 * 1024 * 1024;
const MAX_TOKENS = 1_000_000;
const fields = new Set(['type', 'subtype', 'is_error', 'error', 'errors', 'result']);
type Frame = { kind: 'object' | 'array'; key: string; role?: 'error' | 'errors'; items: number };
type Token = { name: string; value?: string | boolean | null };

class RecordTokenizer extends Parser {
  flushed = false;
  override _flush(callback: TransformCallback): void {
    super._flush((error) => {
      this.flushed = true;
      callback(error);
    });
  }
}

/**
 * Used only after the 2M-character JSONL buffer overflows; ordinary records still use JSON.parse.
 * No value packing or trees: 8K input slices, 64 frames, 256-character keys/type/subtype,
 * 1024-character numbers and diagnostic prefixes, at most 16 error entries. Payload strings
 * are discarded. Records exceeding 256Mi characters / 1M structural tokens or duplicating root metadata
 * fail closed. Transform writes and final syntax validation must complete synchronously.
 */
export class ClaudeJsonRecord {
  private readonly parser = new RecordTokenizer({ packValues: false, decodeStrings: false });
  private readonly stack: Frame[] = [];
  private readonly seen = new Set<string>();
  private readonly metadata: Record<string, unknown> = Object.create(null);
  private failure?: string;
  private key = false;
  private text = '';
  private textLength = 0;
  private numberLength = 0;
  private numberValue = '';
  private target?: string;
  private quoted = false;
  private escaped = false;
  private rootObject = false;
  private chars = 0;
  private tokens = 0;

  constructor() {
    this.parser.on('data', (token: Token) => { this.token(token); });
    // Transform errors are also exposed synchronously via .errored; never leave an unhandled event.
    this.parser.on('error', () => {});
  }

  write(data: string): void {
    if (this.failure) return;
    try {
      this.chars += data.length;
      if (this.chars > MAX_RECORD_CHARS) throw new Error('JSON record character limit exceeded');
      for (let offset = 0; offset < data.length; offset += INPUT_CHARS) {
        const part = data.slice(offset, offset + INPUT_CHARS);
        // stream-json 1.x accepts JS whitespace. JSON permits only ASCII space, TAB, CR and LF.
        for (const char of part) {
          if (this.quoted) {
            if (this.escaped) this.escaped = false;
            else if (char === '\\') this.escaped = true;
            else if (char === '"') this.quoted = false;
          } else if (char === '"') this.quoted = true;
          else {
            const code = char.charCodeAt(0);
            if (code > 127 || (code < 32 && char !== '\t' && char !== '\r' && char !== '\n')) {
              throw new Error('Non-JSON whitespace or character outside a string');
            }
          }
        }
        this.parser.write(part);
        if (this.parser.errored) throw this.parser.errored;
        if (this.parser.writableLength || this.parser.readableLength) throw new Error('Tokenizer did not drain synchronously');
      }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : 'Invalid JSON record';
      this.parser.destroy();
    }
  }

  finish(): { metadata: Record<string, unknown>; error?: string } {
    try {
      if (!this.failure) {
        this.parser.end();
        this.failure = this.parser.errored?.message;
        if (!this.failure && (!this.parser.flushed || !this.rootObject || this.stack.length)) {
          this.failure = 'Incomplete or unsupported JSON object';
        }
        if (!this.failure && (
          (this.seen.has('is_error') && typeof this.metadata.is_error !== 'boolean') ||
          (this.seen.has('subtype') && typeof this.metadata.subtype !== 'string')
        )) this.failure = 'Unsupported root metadata value';
      }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : 'Invalid JSON record';
    } finally {
      this.parser.destroy();
    }
    return { metadata: this.metadata, error: this.failure };
  }

  private valueTarget(): string | undefined {
    const parent = this.stack.at(-1);
    if (this.stack.length === 1 && parent?.kind === 'object' && fields.has(parent.key)) {
      if (this.seen.has(parent.key)) throw new Error('Duplicate root metadata field');
      this.seen.add(parent.key);
      return parent.key;
    }
    if (parent?.role === 'error' && parent.key === 'message') return 'error.message';
    if (parent?.role === 'errors') {
      if (++parent.items > MAX_ERRORS) throw new Error('Error metadata item limit exceeded');
      return 'errors.item';
    }
    return undefined;
  }

  private scalar(target: string | undefined, value: unknown): void {
    if (!target) return;
    if (target === 'error.message') this.metadata.error = { message: value };
    else if (target === 'errors.item') {
      if (typeof value === 'string') (this.metadata.errors as string[]).push(value);
    } else this.metadata[target] = value;
  }

  private token({ name, value }: Token): void {
    // Primitive chunks depend on write boundaries; count only structural tokens for a stable limit.
    if (name !== 'stringChunk' && name !== 'numberChunk' && ++this.tokens > MAX_TOKENS) {
      throw new Error('JSON token limit exceeded');
    }
    if (name === 'startObject' || name === 'startArray') {
      const target = this.valueTarget();
      if (this.stack.length >= MAX_DEPTH) throw new Error('JSON nesting limit exceeded');
      if (!this.stack.length) this.rootObject = name === 'startObject';
      if (target === 'type' || target === 'subtype' || target === 'is_error') throw new Error('Unsupported metadata value');
      const role = target === 'error' && name === 'startObject' ? 'error'
        : target === 'errors' && name === 'startArray' ? 'errors' : undefined;
      if (target === 'error') this.metadata.error = true;
      if (role === 'errors') this.metadata.errors = [];
      this.stack.push({ kind: name === 'startObject' ? 'object' : 'array', key: '', role, items: 0 });
    } else if (name === 'endObject' || name === 'endArray') {
      this.stack.pop();
    } else if (name === 'startKey' || name === 'startString') {
      this.key = name === 'startKey';
      this.target = this.key ? undefined : this.valueTarget();
      this.text = '';
      this.textLength = 0;
    } else if (name === 'stringChunk') {
      const chunk = value as string;
      this.textLength += chunk.length;
      if ((this.key || this.target === 'type' || this.target === 'subtype') && this.textLength > MAX_KEY_CHARS) {
        throw new Error('JSON key or metadata token limit exceeded');
      }
      if (this.key || this.target) this.text += chunk.slice(0, Math.max(0, MAX_DIAGNOSTIC_CHARS - this.text.length));
    } else if (name === 'endKey') {
      this.stack[this.stack.length - 1].key = this.text;
    } else if (name === 'endString') {
      this.scalar(this.target, this.text + (this.textLength > MAX_DIAGNOSTIC_CHARS ? ' [truncated]' : ''));
      this.text = '';
      this.target = undefined;
    } else if (name === 'startNumber') {
      this.target = this.valueTarget();
      this.numberLength = 0;
      this.numberValue = '';
    } else if (name === 'numberChunk') {
      this.numberLength += (value as string).length;
      if (this.numberLength > MAX_NUMBER_CHARS) throw new Error('JSON number token limit exceeded');
      if (this.target) this.numberValue += value as string;
    } else if (name === 'endNumber') {
      this.scalar(this.target, Number(this.numberValue));
      this.numberValue = '';
      this.target = undefined;
    } else if (name === 'trueValue' || name === 'falseValue' || name === 'nullValue') {
      this.scalar(this.valueTarget(), value);
    }
  }
}
