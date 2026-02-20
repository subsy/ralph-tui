/**
 * ABOUTME: Tests for collectSystemInfo that require real registry access.
 * These tests are in tests/commands/ to isolate them from mock pollution.
 *
 * Other test files (doctor.test.ts, create-prd.test.tsx) mock the agent registry
 * at the module level. Bun's mock.restore() doesn't properly restore module mocks,
 * which causes the collectSystemInfo function to fail because it depends on
 * getDefaultAgentConfig which uses registry.hasPlugin().
 *
 * By placing these tests in a separate file and resetting the registry singleton
 * before registering builtins, we ensure a clean state.
 */

import { describe, expect, test, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRegistry } from '../../src/plugins/agents/registry.js'
import { registerBuiltinAgents } from '../../src/plugins/agents/builtin/index.js'
import { collectSystemInfo } from '../../src/commands/info.js'

// Helper to create a temp directory for each test
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ralph-tui-info-test-'))
}

// Helper to write a TOML config file
async function writeConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  const configDir = join(dir, '.ralph-tui')
  await mkdir(configDir, { recursive: true })

  const lines: string[] = []
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      lines.push(`${key} = "${value}"`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key} = ${value}`)
    }
  }

  await writeFile(join(configDir, 'config.toml'), lines.join('\n'), 'utf-8')
}

describe('collectSystemInfo', () => {
  let tempDir: string

  beforeAll(() => {
    // Reset the registry singleton to clear any pollution from other tests,
    // then register builtin agents fresh. Using direct imports ensures all
    // modules share the same singleton instance.
    AgentRegistry.resetInstance()
    registerBuiltinAgents()
  })

  afterAll(() => {
    // Clean up after tests
    AgentRegistry.resetInstance()
  })

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('collects basic system info', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
      tracker: 'beads',
    })

    const info = await collectSystemInfo(tempDir)

    expect(info).toHaveProperty('version')
    expect(info).toHaveProperty('runtime')
    expect(info).toHaveProperty('os')
    expect(info).toHaveProperty('config')
    expect(info).toHaveProperty('templates')
    expect(info).toHaveProperty('agent')
    expect(info).toHaveProperty('tracker')
    expect(info).toHaveProperty('skills')
  })

  test('collects skills info', async () => {
    await writeConfig(tempDir, {
      agent: 'claude',
    })

    const info = await collectSystemInfo(tempDir)

    expect(info.skills).toHaveProperty('bundled')
    expect(info.skills).toHaveProperty('customDir')
    expect(info.skills).toHaveProperty('customSkills')
    expect(info.skills).toHaveProperty('agents')
    expect(Array.isArray(info.skills.bundled)).toBe(true)
    expect(Array.isArray(info.skills.agents)).toBe(true)
  })

  test('collects custom skills from symlinked skill directories', async () => {
    const customSkillsDir = join(tempDir, 'custom-skills')
    const realSkillDir = join(tempDir, 'real-skills', 'ralph-tui-prd')
    const symlinkedSkillDir = join(customSkillsDir, 'ralph-tui-prd')

    await mkdir(realSkillDir, { recursive: true })
    await writeFile(join(realSkillDir, 'SKILL.md'), '# test skill', 'utf-8')
    await mkdir(customSkillsDir, { recursive: true })
    await symlink(realSkillDir, symlinkedSkillDir, 'dir')

    await writeConfig(tempDir, {
      agent: 'claude',
      skills_dir: customSkillsDir,
    })

    const info = await collectSystemInfo(tempDir)

    expect(info.skills.customDir).toBe(customSkillsDir)
    expect(info.skills.customSkills).toContain('ralph-tui-prd')
  })

  test('detects runtime correctly', async () => {
    await writeConfig(tempDir, { agent: 'claude' })

    const info = await collectSystemInfo(tempDir)

    expect(info.runtime.name).toBe('bun')
    expect(info.runtime.version).toBeTruthy()
  })

  test('collects OS info', async () => {
    await writeConfig(tempDir, { agent: 'claude' })

    const info = await collectSystemInfo(tempDir)

    expect(info.os.platform).toBeTruthy()
    expect(info.os.release).toBeTruthy()
    expect(info.os.arch).toBeTruthy()
  })

  test('detects project config', async () => {
    await writeConfig(tempDir, { agent: 'claude' })

    const info = await collectSystemInfo(tempDir)

    expect(info.config.projectPath).toBe(join(tempDir, '.ralph-tui', 'config.toml'))
    expect(info.config.projectExists).toBe(true)
  })

  test('uses configured agent name', async () => {
    await writeConfig(tempDir, { agent: 'opencode' })

    const info = await collectSystemInfo(tempDir)

    expect(info.agent.name).toBe('opencode')
  })

  test('command is undefined when not configured', async () => {
    await writeConfig(tempDir, { agent: 'claude' })

    const info = await collectSystemInfo(tempDir)

    expect(info.agent.command).toBeUndefined()
  })
})
