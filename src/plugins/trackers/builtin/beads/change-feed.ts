/**
 * ABOUTME: Bounded, optional native bd journal invalidations with polling fallback.
 * Keeps only a session-local cursor and never materializes journal issue snapshots.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { unwrapBeadsEnvelope } from '../../beads-json.js';

const MAX_OUTPUT = 1024 * 1024;
const MAX_STDERR = 8192;

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface FeedOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onChange: () => void;
  command?: string;
  prefixArgs?: string[];
  commandTimeoutMs?: number;
  retryMs?: number;
  scopeIntervalMs?: number;
  healthyStreamMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A follower belongs to one subscription lifetime, not a persisted tracker cache. */
export class BeadsChangeFeed {
  private stopped = false;
  private children = new Set<ChildProcess>();
  private run: Promise<void> | undefined;
  private cancelDelay: (() => void) | undefined;
  private notification: ReturnType<typeof setTimeout> | undefined;
  private cursor = 0;
  private scope: string | undefined;

  constructor(private readonly options: FeedOptions) {}

  start(): void {
    if (!this.run && !this.stopped) {
      this.run = this.follow().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    this.cancelDelay?.();
    clearTimeout(this.notification);
    this.notification = undefined;
    for (const child of this.children) child.kill('SIGTERM');
    const reaper = setTimeout(() => {
      for (const child of this.children) child.kill('SIGKILL');
    }, 500);
    await this.run;
    await Promise.all([...this.children].map((child) => new Promise<void>((resolve) => {
      child.once('close', resolve);
    })));
    clearTimeout(reaper);
  }

  private invalidate(): void {
    if (this.stopped || this.notification) return;
    this.notification = setTimeout(() => {
      this.notification = undefined;
      if (!this.stopped) this.options.onChange();
    }, 25);
  }

  private spawn(args: string[]): ChildProcess {
    const child = spawn(this.options.command ?? 'bd', [
      ...(this.options.prefixArgs ?? []), ...args,
    ], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.children.add(child);
    child.once('close', () => this.children.delete(child));
    return child;
  }

  private command(args: string[]): Promise<CommandResult> {
    if (this.stopped) return Promise.resolve({ stdout: '', stderr: '', code: 1 });
    return new Promise((resolve) => {
      const child = this.spawn(args);
      let stdout = '';
      let stderr = '';
      let failed = false;
      const kill = setTimeout(() => {
        failed = true;
        child.kill('SIGKILL');
      }, this.options.commandTimeoutMs ?? 3000);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (data: string) => {
        if (stdout.length + data.length > MAX_OUTPUT) {
          failed = true;
          child.kill('SIGKILL');
        } else stdout += data;
      });
      child.stderr!.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-MAX_STDERR);
      });
      child.once('error', () => { failed = true; });
      child.once('close', (code) => {
        clearTimeout(kill);
        resolve({ stdout, stderr, code: failed ? 1 : code ?? 1 });
      });
    });
  }

  private async readScope(): Promise<string | undefined> {
    const context = await this.command(['context', '--json']);
    const branch = await this.command(['branch', '--json']);
    if (context.code !== 0 || branch.code !== 0) return;
    try {
      const c = unwrapBeadsEnvelope(JSON.parse(context.stdout));
      const b = unwrapBeadsEnvelope(JSON.parse(branch.stdout));
      if (!object(c) || !object(b) || !nonEmpty(c.beads_dir) || !isAbsolute(c.beads_dir) ||
          !nonEmpty(c.database) || !nonEmpty(c.project_id) || c.backend !== 'dolt' ||
          !nonEmpty(b.current) || (c.data_dir !== undefined && !nonEmpty(c.data_dir))) return;
      let store: unknown[];
      if (c.dolt_mode === 'embedded') {
        store = [resolve(c.beads_dir, nonEmpty(c.data_dir) ? c.data_dir : 'dolt')];
      } else if (c.dolt_mode === 'server') {
        if (!nonEmpty(c.server_host) || !sequence(c.server_port) ||
            c.server_port < 1 || c.server_port > 65535) return;
        store = [c.server_host, c.server_port, c.data_dir];
      } else if (c.dolt_mode === 'proxied-server') {
        if (!nonEmpty(c.proxied_dir) || !isAbsolute(c.proxied_dir)) return;
        store = [c.proxied_dir, c.data_dir];
      } else return;
      return JSON.stringify([
        c.beads_dir, c.backend, c.dolt_mode, c.database, c.project_id, b.current, store,
      ]);
    } catch { return; }
  }

  private truncated(value: unknown): boolean {
    if (!object(value) || value.code !== 'events_journal_truncated') return false;
    if (!sequence(value.floor) || value.floor < 1 || !sequence(value.head) ||
        value.head < value.floor) throw new Error('Invalid journal window');
    // This is an invalidation consumer, not a mirror accepting missing history.
    // Re-read authoritative state and replay the entire retained suffix.
    this.invalidate();
    this.cursor = value.floor - 1;
    return true;
  }

  private record(value: unknown): void {
    if (this.truncated(value)) return;
    if (!object(value) || !sequence(value.seq) || value.seq < 1 ||
        typeof value.op !== 'string' || typeof value.ts !== 'string' ||
        typeof value.issue_id !== 'string' ||
        !(value.issue === null || object(value.issue))) {
      throw new Error('Invalid journal record');
    }
    if (value.seq < this.cursor) throw new Error('Journal order changed');
    if (value.seq === this.cursor) return;
    // Processing is latching an invalidation, not applying issue/is_blocked state.
    this.invalidate();
    this.cursor = value.seq;
  }

  private async follow(): Promise<void> {
    const help = await this.command(['events', 'tail', '--help']);
    if (help.code !== 0 || !help.stdout.includes('--follow') ||
        !help.stdout.includes('--since')) return;

    let failures = 0;
    while (!this.stopped) {
      const scope = await this.readScope();
      if (!scope || this.stopped) return;
      if (scope !== this.scope) {
        this.scope = scope;
        this.cursor = 0;
        this.invalidate();
      }
      const probe = await this.command([
        'events', 'tail', '--json', '--since', String(this.cursor), '--limit', '1',
      ]);
      if (/journal is disabled/i.test(probe.stderr)) return;
      let truncated = false;
      if (probe.stdout.trim()) {
        try {
          const value = unwrapBeadsEnvelope(JSON.parse(probe.stdout));
          truncated = this.truncated(value);
          if (!truncated && probe.code === 0) this.record(value);
        } catch { return; }
      }
      if (probe.code !== 0 && !truncated) return;
      // A store/branch change between commands must not inherit the old cursor.
      if (await this.readScope() !== scope) {
        this.scope = undefined;
        continue;
      }
      if (this.stopped) return;
      const before = this.cursor;
      const startedAt = performance.now();
      const result = await this.stream(scope);
      if (result === 'fallback' || this.stopped) return;
      if (result === 'scope') {
        this.scope = undefined;
        continue;
      }
      const healthy = this.cursor > before ||
        performance.now() - startedAt >= (this.options.healthyStreamMs ?? 60_000);
      failures = healthy ? 0 : failures + 1;
      if (failures >= 5) return;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          this.cancelDelay = undefined;
          resolve();
        };
        const timer = setTimeout(done, Math.min(30_000,
          (this.options.retryMs ?? 500) * 2 ** failures));
        this.cancelDelay = done;
      });
    }
  }

  private stream(scope: string): Promise<'retry' | 'fallback' | 'scope'> {
    return new Promise((resolve) => {
      const child = this.spawn([
        'events', 'tail', '--json', '--since', String(this.cursor), '--follow',
      ]);
      let pending = '';
      let pretty = '';
      let stderr = '';
      let result: 'retry' | 'fallback' | 'scope' = 'retry';
      let terminating = false;
      let checking = false;
      const stop = (reason: typeof result): void => {
        if (terminating) return;
        terminating = true;
        result = reason;
        if (!this.stopped) this.invalidate();
        child.kill('SIGTERM');
      };
      const monitor = setInterval(() => {
        if (this.stopped) { stop('fallback'); return; }
        if (checking) return;
        checking = true;
        void this.readScope().then((current) => {
          if (current !== scope) stop('scope');
        }).finally(() => { checking = false; });
      }, this.options.scopeIntervalMs ?? 30_000);
      // A bounded lifetime also guarantees termination of an uncooperative child.
      const reaper = setInterval(() => {
        if (this.stopped || child.killed) child.kill('SIGKILL');
      }, 500);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (data: string) => {
        if (this.stopped || terminating) return;
        pending += data;
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (line.length + pretty.length > MAX_OUTPUT) { stop('fallback'); return; }
          if (!line) continue;
          if (pretty || line === '{') {
            pretty += line;
            if (line !== '}') continue;
          }
          try {
            const value = unwrapBeadsEnvelope(JSON.parse(pretty || line));
            pretty = '';
            if (this.truncated(value)) { stop('retry'); return; }
            this.record(value);
          } catch { stop('fallback'); return; }
        }
        if (pending.length + pretty.length > MAX_OUTPUT) stop('fallback');
      });
      child.stderr!.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-MAX_STDERR);
        if (/journal is disabled/i.test(stderr)) stop('fallback');
      });
      child.once('error', () => { result = 'fallback'; });
      child.once('close', () => {
        clearInterval(monitor);
        clearInterval(reaper);
        // A trailing partial record is never a processed checkpoint.
        resolve(result);
      });
    });
  }
}
