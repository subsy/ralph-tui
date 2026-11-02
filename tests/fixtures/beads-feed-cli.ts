/**
 * ABOUTME: Real child-process bd journal fixture controlled by a scratch workspace.
 * Records invocation scopes and exercises framing, exits, hangs and termination.
 */

import { appendFileSync, readFileSync } from 'node:fs';

interface Stream {
  parts?: string[];
  intervalMs?: number;
  exit?: boolean;
  ignoreTerm?: boolean;
}
interface Settings {
  mode?: string;
  branch?: string;
  database?: string;
  beadsDir?: string;
  probe?: string;
  probeCode?: number;
  probeBySince?: Record<string, string>;
  envelope?: boolean;
  context?: Record<string, unknown>;
  stream?: Stream;
  streamBySince?: Record<string, Stream>;
}

const settings: Settings = JSON.parse(readFileSync('fixture.json', 'utf8'));
const args = process.argv.slice(2);
const since = args[args.indexOf('--since') + 1] ?? '';
appendFileSync('calls.jsonl', JSON.stringify({
  args, since, pid: process.pid, cwd: process.cwd(), beadsDir: process.env.BEADS_DIR,
}) + '\n');

if (args.includes('--version')) {
  console.log('bd version 1.3.0');
} else if (args[0] === 'context') {
  const context = {
    beads_dir: settings.beadsDir ?? process.cwd(), backend: 'dolt',
    database: settings.database ?? 'beads', dolt_mode: 'embedded', project_id: 'fixture-project',
    ...settings.context,
  };
  console.log(JSON.stringify(settings.envelope ? { schema_version: 1, data: context } : context));
} else if (args[0] === 'branch') {
  const branch = { current: settings.mode === 'unknown-scope' ? '' : settings.branch ?? 'main' };
  console.log(JSON.stringify(settings.envelope ? { schema_version: 1, data: branch } : branch));
} else if (args.includes('--help')) {
  if (settings.mode === 'unsupported') process.exit(1);
  if (settings.mode === 'hang-help') setInterval(() => {}, 1000);
  else console.log('--follow --since --limit');
} else if (args.includes('--follow')) {
  const stream = settings.streamBySince?.[since] ?? settings.stream ?? {};
  if (stream.ignoreTerm) process.on('SIGTERM', () => {});
  const parts = stream.parts ?? [];
  let index = 0;
  const timer = setInterval(() => {
    if (index < parts.length) process.stdout.write(parts[index++]!);
    else if (stream.exit) process.exit(1);
  }, stream.intervalMs ?? 10);
  process.on('exit', () => clearInterval(timer));
} else if (args[0] === 'events') {
  if (settings.mode === 'disabled') console.error('note: the events journal is disabled for this workspace');
  process.stdout.write(settings.probeBySince?.[since] ?? settings.probe ?? '');
  process.exitCode = settings.probeCode ?? 0;
} else if (args[0] === 'list') {
  console.log('[]');
} else {
  process.exitCode = 1;
}
