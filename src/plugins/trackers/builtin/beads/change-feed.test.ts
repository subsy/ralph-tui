/**
 * ABOUTME: Real-process tests for optional native bd journal invalidations.
 * Covers framing, cursor recovery, fallback and bounded follower cleanup.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { BeadsChangeFeed } from './change-feed.js';
import { BeadsTrackerPlugin } from './index.js';

const fixture = resolve(import.meta.dir, '../../../../../tests/fixtures/beads-feed-cli.ts');
const event = (seq: number, op = 'update'): string => JSON.stringify({
  seq, ts: '2026-01-01T00:00:00Z', op, issue_id: 'bd-1', issue: op === 'delete' ? null : { title: '日本語' },
}) + '\n';
const gap = (floor = 10): string => JSON.stringify({
  code: 'events_journal_truncated', since: 0, floor, head: floor + 5,
});

interface Call { args: string[]; since: string; pid: number }

describe('native bd change feed (real CLI)', () => {
  let cwd: string;
  let feed: BeadsChangeFeed;
  let changes: number;
  const originalPath = process.env.PATH;
  let plugin: BeadsTrackerPlugin | undefined;

  const configure = async (settings: Record<string, unknown>): Promise<void> => {
    await writeFile(join(cwd, 'fixture.next'), JSON.stringify(settings));
    await rename(join(cwd, 'fixture.next'), join(cwd, 'fixture.json'));
  };
  const calls = async (): Promise<Call[]> => {
    try {
      return (await readFile(join(cwd, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((s) => JSON.parse(s) as Call);
    } catch { return []; }
  };
  const followers = async (): Promise<Call[]> => (await calls()).filter((c) => c.args.includes('--follow'));
  const until = async (check: () => boolean | Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + 4000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for fixture');
      await Bun.sleep(10);
    }
  };
  const start = (overrides: Partial<ConstructorParameters<typeof BeadsChangeFeed>[0]> = {}): void => {
    feed = new BeadsChangeFeed({
      cwd, command: process.execPath, prefixArgs: [fixture], onChange: () => changes++,
      commandTimeoutMs: 500, retryMs: 5, scopeIntervalMs: 100,
      ...overrides,
    });
    feed.start();
  };

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ralph-beads-events-'));
    changes = 0;
    await configure({});
  });
  afterEach(async () => {
    await plugin?.dispose();
    plugin = undefined;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await feed?.dispose();
    const invocations = await calls();
    for (const pid of new Set(invocations.map((c) => c.pid))) {
      expect(() => process.kill(pid, 0)).toThrow();
    }
    await rm(cwd, { recursive: true, force: true });
  });

  test('coalesces partial chunks, UTF-8, missing is_blocked, unknown ops and deletes', async () => {
    const first = event(1);
    await configure({ stream: { parts: [first.slice(0, 25), first.slice(25) + event(2, 'future_op') + event(3, 'delete')] } });
    start();
    await until(async () => (await followers()).length === 1);
    await until(() => changes >= 2);
    expect((feed as unknown as { cursor: number }).cursor).toBe(3);
    expect(changes).toBeLessThanOrEqual(3);
  });

  test.each(['unsupported', 'disabled', 'unknown-scope', 'hang-help'])('falls back for %s without a follower', async (mode) => {
    await configure({ mode });
    start({ commandTimeoutMs: 100 });
    await (feed as unknown as { run: Promise<void> }).run;
    expect(await followers()).toHaveLength(0);
  });

  test('falls back when executable is absent', async () => {
    start({ command: join(cwd, 'not-a-binary') });
    await (feed as unknown as { run: Promise<void> }).run;
  });

  test('supports enveloped identity and truncation responses', async () => {
    await configure({ envelope: true, probeBySince: {
      '0': JSON.stringify({ schema_version: 1, data: JSON.parse(gap()) }),
    }, stream: { parts: [event(10)] } });
    start();
    await until(() => (feed as unknown as { cursor: number }).cursor === 10);
    expect((await followers())[0]!.since).toBe('9');
  });

  test('falls back on failed probes and invalid truncation bounds', async () => {
    await configure({ probe: gap(Number.MAX_SAFE_INTEGER + 1), probeCode: 1 });
    start();
    await (feed as unknown as { run: Promise<void> }).run;
    expect(await followers()).toHaveLength(0);
  });

  test('accepts enveloped follow records and truncation notifications', async () => {
    const envelope = (value: string): string => JSON.stringify({
      schema_version: 1, data: JSON.parse(value),
    }) + '\n';
    await configure({ probe: event(1), probeBySince: { '9': '' }, streamBySince: {
      '1': { parts: [envelope(event(2)), envelope(gap())] },
      '9': { parts: [envelope(event(10))] },
    } });
    start();
    await until(() => (feed as unknown as { cursor: number }).cursor === 10);
    expect((await followers()).map((c) => c.since)).toEqual(['1', '9']);
  });

  test.each(['not json\n', 'x'.repeat(1024 * 1024 + 1),
    event(Number.MAX_SAFE_INTEGER + 1), '{}\n', event(2) + event(1)])('rejects invalid streams without reconnecting (%#)', async (data) => {
    await configure({ stream: { parts: [data] } });
    start();
    await (feed as unknown as { run: Promise<void> }).run;
    expect(await followers()).toHaveLength(1);
  });

  test('reconnects only from a fully processed checkpoint and ignores duplicate delivery', async () => {
    await configure({ streamBySince: {
      '0': { parts: [event(1) + event(1) + event(2) + '{"seq":3'], exit: true },
      '2': { parts: [event(3)] },
    } });
    start();
    await until(async () => (await followers()).length >= 2);
    expect((await followers()).slice(0, 2).map((c) => c.since)).toEqual(['0', '2']);
    await until(() => (feed as unknown as { cursor: number }).cursor === 3);
  });

  test('bounds reconnect attempts after repeated EOF', async () => {
    await configure({ stream: { exit: true } });
    start();
    await (feed as unknown as { run: Promise<void> }).run;
    expect(await followers()).toHaveLength(5);
  });

  test('does not accumulate fast-failure counts across healthy idle streams', async () => {
    await configure({ stream: { parts: [''], intervalMs: 30, exit: true } });
    start({ healthyStreamMs: 20 });
    await until(async () => (await followers()).length >= 6);
    await feed.dispose();
    expect((feed as unknown as { cursor: number }).cursor).toBe(0);
  });

  test('invalidates and rebaselines a pruned initial journal without skipping its retained suffix', async () => {
    await configure({ probeBySince: { '0': gap() }, streamBySince: { '9': { parts: [event(10)] } } });
    start();
    await until(() => (feed as unknown as { cursor: number }).cursor === 10);
    expect((await followers())[0]!.since).toBe('9');
    expect(changes).toBeGreaterThan(0);
  });

  test('handles truncation after valid follow records, including pretty startup errors', async () => {
    await configure({ streamBySince: {
      '0': { parts: [event(1) + gap() + '\n'] },
      '9': { parts: [JSON.stringify(JSON.parse(gap(20)), null, 2) + '\n'] },
      '19': { parts: [event(20)] },
    } });
    start();
    await until(() => (feed as unknown as { cursor: number }).cursor === 20);
    expect((await followers()).map((c) => c.since)).toEqual(['0', '9', '19']);
  });

  test('resets cursor on branch/store changes and stops old follower', async () => {
    await configure({ stream: { parts: [event(30)] } });
    start();
    await until(() => (feed as unknown as { cursor: number }).cursor === 30);
    await configure({ branch: 'other', database: 'new-clone', stream: { parts: [event(1)] } });
    await until(async () => (await followers()).length >= 2);
    expect((await followers())[1]!.since).toBe('0');
    await until(() => (feed as unknown as { cursor: number }).cursor === 1);
  });

  test('immediate and double disposal do not start a follow process', async () => {
    start();
    await Promise.all([feed.dispose(), feed.dispose()]);
    feed.start();
    expect(await followers()).toHaveLength(0);
    expect(changes).toBe(0);
  });

  test.each([
    { dolt_mode: 'unknown' }, { project_id: '' }, { project_id: null },
    { beads_dir: 'relative/store' }, { data_dir: {} },
    { dolt_mode: 'server', server_port: 3307 },
    { dolt_mode: 'server', server_host: '127.0.0.1' },
    { dolt_mode: 'server', server_host: '127.0.0.1', server_port: 0 },
    { dolt_mode: 'proxied-server' },
  ])('falls back on unverifiable native scope (%#)', async (context) => {
    await configure({ context });
    start();
    await (feed as unknown as { run: Promise<void> }).run;
    expect(await followers()).toHaveLength(0);
  });

  test.each(['server', 'proxied-server'])('accepts a complete %s identity', async (mode) => {
    await configure({ context: {
      dolt_mode: mode, server_host: '127.0.0.1', server_port: 3307, proxied_dir: cwd,
    }, stream: { parts: [event(1)] } });
    start();
    await until(() => (feed as unknown as { cursor: number }).cursor === 1);
    expect(await followers()).toHaveLength(1);
  });

  test('resets a cursor when the server endpoint changes at the same workspace path', async () => {
    const settings = (host: string): Record<string, unknown> => ({
      context: { dolt_mode: 'server', server_host: host, server_port: 3307 },
      streamBySince: { '0': { parts: [event(3)] } },
    });
    await configure(settings('one.example'));
    start({ scopeIntervalMs: 50 });
    await until(() => (feed as unknown as { cursor: number }).cursor === 3);
    await configure(settings('two.example'));
    await until(async () => (await followers()).length === 2);
    expect((await followers()).map((c) => c.since)).toEqual(['0', '0']);
  });

  test('disposal cancels a pending retry', async () => {
    await configure({ stream: { exit: true } });
    start({ retryMs: 5000 });
    await until(() => Boolean((feed as unknown as { cancelDelay?: () => void }).cancelDelay));
    await feed.dispose();
    expect(await followers()).toHaveLength(1);
  });

  test('disposal kills an uncooperative follower and cancels callbacks', async () => {
    await configure({ stream: { ignoreTerm: true, parts: [event(1)] } });
    start();
    await until(async () => (await followers()).length === 1);
    const before = changes;
    await Promise.all([feed.dispose(), feed.dispose()]);
    expect(changes).toBe(before);
  });

  test('native tracker subscription preserves store env, isolates listeners and disposes idempotently', async () => {
    if (process.platform === 'win32') return;
    await writeFile(join(cwd, 'bd'), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
    await chmod(join(cwd, 'bd'), 0o755);
    process.env.PATH = cwd + delimiter + originalPath;
    plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: cwd, beadsDir: cwd, changeFeed: true });
    const unsubscribeFirst = plugin.subscribeChanges(() => { throw new Error('listener failure'); });
    const unsubscribeSecond = plugin.subscribeChanges(() => changes++);
    await until(async () => (await followers()).length === 1);
    await until(() => changes > 0);
    expect((await calls()).every((c) => (c as Call & { beadsDir?: string }).beadsDir === cwd)).toBe(true);
    await unsubscribeFirst();
    expect((await followers()).length).toBe(1);
    await Promise.all([unsubscribeSecond(), unsubscribeSecond(), plugin.dispose()]);
    await plugin.subscribeChanges(() => changes++)();
    expect(await followers()).toHaveLength(1);
  });

  test('native tracker defaults off and does not probe events for existing users', async () => {
    if (process.platform === 'win32') return;
    await writeFile(join(cwd, 'bd'), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
    await chmod(join(cwd, 'bd'), 0o755);
    process.env.PATH = cwd + delimiter + originalPath;
    plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: cwd, beadsDir: cwd });
    await plugin.subscribeChanges(() => changes++)();
    expect((await calls()).map((c) => c.args)).toEqual([['--version']]);
  });

  test('native tracker serializes resubscription behind old follower termination', async () => {
    if (process.platform === 'win32') return;
    await writeFile(join(cwd, 'bd'), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
    await chmod(join(cwd, 'bd'), 0o755);
    process.env.PATH = cwd + delimiter + originalPath;
    await configure({ stream: { ignoreTerm: true } });
    plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: cwd, beadsDir: cwd, changeFeed: true });
    const first = plugin.subscribeChanges(() => {});
    await until(async () => (await followers()).length === 1);
    const oldPid = (await followers())[0]!.pid;
    const cleaning = first();
    const second = plugin.subscribeChanges(() => {});
    await Bun.sleep(50);
    expect(await followers()).toHaveLength(1);
    await cleaning;
    expect(() => process.kill(oldPid, 0)).toThrow();
    await until(async () => (await followers()).length === 2);
    await second();
  });
});
