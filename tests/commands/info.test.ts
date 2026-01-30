/**
 * ABOUTME: Tests for collectSystemInfo that require real registry access.
 * These tests are in tests/commands/ to isolate them from mock pollution.
 *
 * Other test files (doctor.test.ts, create-prd.test.tsx) mock the agent registry
 * at the module level. Bun's mock.restore() doesn't properly restore module mocks,
 * which causes the collectSystemInfo function to fail because it depends on
 * getDefaultAgentConfig which uses registry.hasPlugin().
 *
 * By placing these tests in a separate file and importing the modules fresh
 * with unique query strings, we bypass the polluted module cache.
 */

import { describe, expect, test, beforeEach, afterEach, beforeAll } from 'bun:test'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Import types from the original module (types are safe, no runtime dependencies)
import type { SystemInfo } from '../../src/commands/info.js'

// These will be populated in beforeAll with fresh imports
let collectSystemInfo: (cwd?: string) => Promise<SystemInfo>

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

  beforeAll(async () => {
    // Reset the registry singleton to clear any pollution
    // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
    const { AgentRegistry } = await import('../../src/plugins/agents/registry.js?test-reload')
    AgentRegistry.resetInstance()

    // Register builtin agents fresh
    // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
    const { registerBuiltinAgents } = await import('../../src/plugins/agents/builtin/index.js?test-reload')
    registerBuiltinAgents()

    // Import collectSystemInfo so it uses the fresh registry
    // @ts-expect-error - Bun supports query strings in imports to get fresh module instances
    const infoModule = await import('../../src/commands/info.js?test-reload')
    collectSystemInfo = infoModule.collectSystemInfo
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
