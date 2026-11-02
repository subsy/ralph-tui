/**
 * ABOUTME: CLI regressions for tracked custom progress files in parallel mode.
 * Runs a local fake agent in scratch Git repositories without provider credentials.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(import.meta.dir, '../../src/cli.tsx');
const history = 'Existing main history\n';

describe('parallel run with tracked custom progress', () => {
  test.each([false, true])('preserves dirty-tree safety with reset=%j', async (reset) => {
    const clean = await runFixture({ reset });
    expect(clean.exitCode).toBe(0);
    expect(clean.content.startsWith(history)).toBe(!reset);
    for (const id of ['A', 'B', 'C']) {
      expect(clean.content.split(`UNIQUE-${id}`)).toHaveLength(2);
    }
    expect(clean.progressCommits).toBe('1');
    expect(clean.tasks.every((task: { passes: boolean }) => task.passes)).toBe(true);
    expect(clean.executions).toHaveLength(3);
    for (const execution of clean.executions) {
      expect(execution.args).toEqual([
        '--print', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions',
      ]);
      expect(execution.exitCode).toBe(0);
    }

    const dirty = await runFixture({ reset, dirty: true });
    expect(dirty.exitCode).toBe(1);
    expect(dirty.output).toContain('Tracked working tree is not clean');
    expect(dirty.content).toBe(history);
    expect(dirty.progressCommits).toBe('1');
  });
});

async function runFixture({ reset, dirty = false }: { reset: boolean; dirty?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'ralph-run-progress-'));
  const cwd = join(root, 'project');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  };
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd, env });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  try {
    await mkdir(join(cwd, '.ralph-tui'), { recursive: true });
    await mkdir(join(cwd, 'notes'));
    const command = join(root, 'fake-agent');
    const childCommand = join(root, 'fake-agent-child');
    await writeFile(command, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('local-fake 1.0'); process.exit(0); }
const child = Bun.spawn([process.execPath, ${JSON.stringify(childCommand)}, ...args], {
  stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
});
const exitCode = await child.exited;
writeFileSync(${JSON.stringify(root)} + '/execution-' + process.pid + '.json', JSON.stringify({ args, exitCode }));
process.exit(exitCode);
`, { mode: 0o755 });
    await writeFile(childCommand, `#!${process.execPath}
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
if (process.argv.includes('--version')) { console.log('local-fake 1.0'); process.exit(0); }
if (process.argv[process.argv.indexOf('--output-format') + 1] !== 'stream-json') {
  throw new Error('Fixture requires the requested structured output format');
}
const prompt = readFileSync(0, 'utf8');
const id = prompt.match(/## Your Task: ([^ ]+)/)[1];
const target = prompt.match(/APPEND to \x60([^\x60]+)\x60/)[1];
if (target !== '.ralph-tui/progress.md') throw new Error('Worker progress must be isolated');
mkdirSync(dirname(target), { recursive: true });
appendFileSync(target, '\\nUNIQUE-' + id + '\\n');
writeFileSync('source-' + id + '.txt', 'implemented');
console.log(JSON.stringify({ type: 'assistant', message: { content: [
  { type: 'text', text: '<promise>COMPLETE</promise>' },
] } }));
`, { mode: 0o755 });
    await writeFile(join(cwd, '.ralph-tui/config.toml'), `agent = "claude"
command = ${JSON.stringify(command)}
tracker = "json"
autoCommit = true
progressFile = "notes/progress.md"
iterationDelay = 0
`);
    await writeFile(join(cwd, '.gitignore'), '.ralph-tui/\n');
    await writeFile(join(cwd, 'notes/progress.md'), history);
    await writeFile(join(cwd, 'README.md'), 'baseline');
    await writeFile(join(cwd, 'prd.json'), JSON.stringify({
      name: 'Progress fixture',
      userStories: ['A', 'B', 'C'].map((id) => ({ id, title: `Story ${id}`, passes: false, priority: 1 })),
    }));
    git('init');
    git('add', '-A');
    git('commit', '-m', 'Fixture baseline');
    expect(git('status', '--porcelain', '--untracked-files=no')).toBe('');
    if (dirty) await writeFile(join(cwd, 'README.md'), 'uncommitted user change');
    const proc = Bun.spawn([
      process.execPath, cli, 'run', '--cwd', cwd, '--prd', join(cwd, 'prd.json'),
      '--no-setup', '--headless', '--force', '--no-sandbox', '--iterations', '2',
      '--parallel', '2', '--direct-merge', ...(reset ? ['--reset-progress'] : []),
    ], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    if (dirty) expect(await readFile(join(cwd, 'README.md'), 'utf-8')).toBe('uncommitted user change');
    return {
      exitCode, output: stdout + stderr,
      content: await readFile(join(cwd, 'notes/progress.md'), 'utf-8'),
      tasks: JSON.parse(await readFile(join(cwd, 'prd.json'), 'utf-8')).userStories,
      executions: await Promise.all((await readdir(root))
        .filter((file) => file.startsWith('execution-') && file.endsWith('.json'))
        .map(async (file) => JSON.parse(await readFile(join(root, file), 'utf-8')) as {
          args: string[]; exitCode: number;
        })),
      progressCommits: git('rev-list', '--all', '--count', 'HEAD', '--', 'notes/progress.md'),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
