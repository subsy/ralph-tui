/**
 * ABOUTME: System info command for ralph-tui.
 * Outputs diagnostic information useful for bug reports.
 * Collects version info, config paths, environment details, and skills.
 */

import { platform, release, arch } from 'node:os';
import { dirname, join } from 'node:path';
import { access, constants, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadStoredConfigWithSource, getDefaultAgentConfig, CONFIG_PATHS } from '../config/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';
import { getUserConfigDir } from '../templates/engine.js';
import { listBundledSkills, resolveSkillsPath } from '../setup/skill-installer.js';
import { getEnvExclusionReport, formatEnvExclusionReport, type EnvExclusionReport } from '../plugins/agents/base.js';

/**
 * Compute the path to package.json based on the current module location.
 * Works in both development (src/) and bundled (dist/) environments.
 *
 * @param currentDir - The directory where the code is running from
 * @returns The computed path to package.json
 */
export function computePackageJsonPath(currentDir: string): string {
  // When bundled by bun, all code is in dist/cli.js (single file bundle).
  // package.json is at the package root (one level up from dist/).
  // In development, this file is at src/commands/info.ts,
  // and package.json is at the project root (up 2 levels).
  if (currentDir.endsWith('dist') || currentDir.includes('/dist/') || currentDir.includes('\\dist\\')) {
    return join(currentDir, '..', 'package.json');
  }
  return join(currentDir, '..', '..', 'package.json');
}

/**
 * Get the package version from package.json.
 * Uses import.meta.url for correct path resolution in ESM bundles.
 */
async function getPackageVersion(): Promise<string> {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = computePackageJsonPath(currentDir);
    const pkg = await readFile(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(pkg);
    if (parsed.name === 'ralph-tui' && parsed.version) {
      return parsed.version;
    }
  } catch {
    // Fall through to unknown
  }
  return 'unknown';
}

/**
 * Information about an agent's skills installation status.
 */
export interface AgentSkillsInfo {
  /** Agent plugin ID */
  id: string;
  /** Agent display name */
  name: string;
  /** Whether the agent is available/detected */
  available: boolean;
  /** Personal skills directory path */
  personalDir: string;
  /** Repo skills directory pattern */
  repoDir: string;
  /** Skills installed in personal directory */
  personalSkills: string[];
}

/**
 * Skills information for the system info output.
 */
export interface SkillsInfo {
  /** Bundled skills available for installation */
  bundled: string[];
  /** Custom skills directory (from config) */
  customDir: string | null;
  /** Skills found in custom directory */
  customSkills: string[];
  /** Per-agent skills information */
  agents: AgentSkillsInfo[];
}

/**
 * System info result
 */
export interface SystemInfo {
  /** ralph-tui version */
  version: string;

  /** Runtime info */
  runtime: {
    /** Bun or Node version */
    version: string;
    /** Runtime name */
    name: 'bun' | 'node';
  };

  /** Operating system info */
  os: {
    platform: string;
    release: string;
    arch: string;
  };

  /** Configuration info */
  config: {
    /** Global config path */
    globalPath: string;
    /** Global config exists */
    globalExists: boolean;
    /** Project config path (if found) */
    projectPath: string | null;
    /** Project config exists */
    projectExists: boolean;
  };

  /** Templates info */
  templates: {
    /** Global templates directory */
    globalDir: string;
    /** Templates found */
    installed: string[];
  };

  /** Agent info */
  agent: {
    /** Configured agent name */
    name: string;
    /** Custom command path (if configured) */
    command?: string;
    /** Agent detected/available */
    available: boolean;
    /** Agent version (if available) */
    version?: string;
    /** Detection error (if any) */
    error?: string;
  };

  /** Tracker info */
  tracker: {
    /** Configured tracker name */
    name: string;
  };

  /** Skills info */
  skills: SkillsInfo;

  /** Environment variable exclusion info */
  envExclusion: EnvExclusionReport;
}

/**
 * List skill directories found in a given path.
 * Skills are identified by having a SKILL.md file.
 */
async function listSkillsInDir(skillsDir: string): Promise<string[]> {
  const skills: string[] = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
        try {
          await access(skillMdPath, constants.F_OK);
          skills.push(entry.name);
        } catch {
          // Not a skill directory
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't read
  }
  return skills;
}

/**
 * Collect skills information from all sources.
 */
async function collectSkillsInfo(
  agentRegistry: ReturnType<typeof getAgentRegistry>,
  customSkillsDir: string | null,
  cwd: string
): Promise<SkillsInfo> {
  // Get bundled skills
  const bundledSkills = await listBundledSkills();
  const bundledNames = bundledSkills.map((s) => s.name);

  // Check custom skills directory
  let customSkills: string[] = [];
  let resolvedCustomDir: string | null = null;
  if (customSkillsDir) {
    resolvedCustomDir = resolveSkillsPath(customSkillsDir, cwd);
    customSkills = await listSkillsInDir(resolvedCustomDir);
  }

  // Get per-agent skills info
  const agents: AgentSkillsInfo[] = [];
  const plugins = agentRegistry.getRegisteredPlugins();

  for (const meta of plugins) {
    // Skip agents without skillsPaths defined
    if (!meta.skillsPaths) {
      continue;
    }

    // Check if agent is available
    const instance = agentRegistry.createInstance(meta.id);
    let available = false;
    if (instance) {
      try {
        const detectResult = await instance.detect();
        available = detectResult.available;
      } catch {
        available = false;
      } finally {
        await instance.dispose();
      }
    }

    // Get installed skills in personal directory
    const personalDir = resolveSkillsPath(meta.skillsPaths.personal);
    const personalSkills = await listSkillsInDir(personalDir);

    agents.push({
      id: meta.id,
      name: meta.name,
      available,
      personalDir,
      repoDir: meta.skillsPaths.repo,
      personalSkills,
    });
  }

  return {
    bundled: bundledNames,
    customDir: resolvedCustomDir,
    customSkills,
    agents,
  };
}

/**
 * Collect system information for bug reports
 */
export async function collectSystemInfo(cwd: string = process.cwd()): Promise<SystemInfo> {
  // Get version first (async)
  const version = await getPackageVersion();

  // Load config with source info
  const { config, source } = await loadStoredConfigWithSource(cwd);

  // Check global config exists
  let globalExists = false;
  try {
    await access(CONFIG_PATHS.global, constants.R_OK);
    globalExists = true;
  } catch {
    // Doesn't exist
  }

  // Check templates directory
  const templatesDir = join(getUserConfigDir(), 'templates');
  const installedTemplates: string[] = [];
  try {
    const files = await readdir(templatesDir);
    installedTemplates.push(...files.filter((f) => f.endsWith('.hbs')));
  } catch {
    // Directory doesn't exist or can't read
  }

  // Get agent info using centralized logic
  registerBuiltinAgents();
  const agentRegistry = getAgentRegistry();

  // Use centralized getDefaultAgentConfig to properly resolve agent from config
  const agentConfig = getDefaultAgentConfig(config, {});
  const agentName = agentConfig?.name ?? 'claude';
  const agentCommand = agentConfig?.command;
  let agentAvailable = false;
  let agentVersion: string | undefined;
  let agentError: string | undefined;

  try {
    if (agentConfig && agentRegistry.hasPlugin(agentConfig.plugin)) {
      // Pass the full agent config (including command) to getInstance
      const agent = await agentRegistry.getInstance(agentConfig);
      const detection = await agent.detect();
      agentAvailable = detection.available;
      agentVersion = detection.version;
      agentError = detection.error;
    } else if (!agentConfig) {
      agentError = 'No agent configured or available';
    } else {
      agentError = `Unknown agent plugin: ${agentConfig.plugin}`;
    }
  } catch (error) {
    agentError = error instanceof Error ? error.message : String(error);
  }

  // Get tracker info
  registerBuiltinTrackers();
  const trackerName = config.tracker ?? 'beads';

  // Collect skills info
  const skills = await collectSkillsInfo(agentRegistry, config.skills_dir ?? null, cwd);

  // Collect env exclusion info using resolved agent config
  // agentConfig already has the resolved env settings (agent-level or fallback to top-level)
  const envExclusion = getEnvExclusionReport(
    process.env,
    agentConfig?.envPassthrough,
    agentConfig?.envExclude
  );

  // Determine runtime
  const isBun = typeof Bun !== 'undefined';
  const runtimeVersion = isBun ? Bun.version : process.version;

  return {
    version,
    runtime: {
      name: isBun ? 'bun' : 'node',
      version: runtimeVersion,
    },
    os: {
      platform: platform(),
      release: release(),
      arch: arch(),
    },
    config: {
      globalPath: CONFIG_PATHS.global,
      globalExists,
      projectPath: source.projectPath,
      projectExists: source.projectLoaded,
    },
    templates: {
      globalDir: templatesDir,
      installed: installedTemplates,
    },
    agent: {
      name: agentName,
      command: agentCommand,
      available: agentAvailable,
      version: agentVersion,
      error: agentError,
    },
    tracker: {
      name: trackerName,
    },
    skills,
    envExclusion,
  };
}

/**
 * Format system info for display
 */
export function formatSystemInfo(info: SystemInfo): string {
  const lines: string[] = [];

  lines.push('ralph-tui System Information');
  lines.push('============================');
  lines.push('');

  // Version info
  lines.push(`ralph-tui version: ${info.version}`);
  lines.push(`Runtime: ${info.runtime.name} ${info.runtime.version}`);
  lines.push(`OS: ${info.os.platform} ${info.os.release} (${info.os.arch})`);
  lines.push('');

  // Config info
  lines.push('Configuration:');
  lines.push(`  Global config: ${info.config.globalPath}`);
  lines.push(`    Exists: ${info.config.globalExists ? 'yes' : 'no'}`);
  if (info.config.projectPath) {
    lines.push(`  Project config: ${info.config.projectPath}`);
    lines.push(`    Exists: ${info.config.projectExists ? 'yes' : 'no'}`);
  } else {
    lines.push('  Project config: (none found)');
  }
  lines.push('');

  // Templates info
  lines.push('Templates:');
  lines.push(`  Directory: ${info.templates.globalDir}`);
  if (info.templates.installed.length > 0) {
    lines.push(`  Installed: ${info.templates.installed.join(', ')}`);
  } else {
    lines.push('  Installed: (none)');
  }
  lines.push('');

  // Agent info
  lines.push('Agent:');
  lines.push(`  Configured: ${info.agent.name}`);
  if (info.agent.command) {
    lines.push(`  Command: ${info.agent.command}`);
  }
  lines.push(`  Available: ${info.agent.available ? 'yes' : 'no'}`);
  if (info.agent.version) {
    lines.push(`  Version: ${info.agent.version}`);
  }
  if (info.agent.error) {
    lines.push(`  Error: ${info.agent.error}`);
  }
  lines.push('');

  // Tracker info
  lines.push('Tracker:');
  lines.push(`  Configured: ${info.tracker.name}`);
  lines.push('');

  // Skills info
  lines.push('Skills:');
  lines.push(`  Bundled: ${info.skills.bundled.length > 0 ? info.skills.bundled.join(', ') : '(none)'}`);

  if (info.skills.customDir) {
    lines.push(`  Custom directory: ${info.skills.customDir}`);
    lines.push(`    Installed: ${info.skills.customSkills.length > 0 ? info.skills.customSkills.join(', ') : '(none)'}`);
  }

  for (const agent of info.skills.agents) {
    const status = agent.available ? '' : ' (not detected)';
    lines.push(`  ${agent.name}${status}:`);
    lines.push(`    Path: ${agent.personalDir}`);
    lines.push(`    Installed: ${agent.personalSkills.length > 0 ? agent.personalSkills.join(', ') : '(none)'}`);
  }

  // Environment variable exclusion info
  lines.push('');
  const envLines = formatEnvExclusionReport(info.envExclusion);
  for (const line of envLines) {
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Format system info as copyable bug report snippet
 */
export function formatForBugReport(info: SystemInfo): string {
  const lines: string[] = [];

  lines.push('```');
  lines.push(`ralph-tui: ${info.version}`);
  lines.push(`runtime: ${info.runtime.name} ${info.runtime.version}`);
  lines.push(`os: ${info.os.platform} ${info.os.release} (${info.os.arch})`);
  lines.push(`agent: ${info.agent.name}${info.agent.version ? ` v${info.agent.version}` : ''}${info.agent.available ? '' : ' (unavailable)'}`);
  lines.push(`tracker: ${info.tracker.name}`);
  lines.push(`global-config: ${info.config.globalExists ? 'yes' : 'no'}`);
  lines.push(`project-config: ${info.config.projectExists ? 'yes' : 'no'}`);
  lines.push(`templates: ${info.templates.installed.length > 0 ? info.templates.installed.join(', ') : 'none'}`);
  lines.push(`bundled-skills: ${info.skills.bundled.length}`);

  // Summarize installed skills per agent
  const skillsSummary = info.skills.agents
    .map((a) => `${a.id}:${a.personalSkills.length}`)
    .join(', ');
  lines.push(`skills-installed: ${skillsSummary || 'none'}`);

  lines.push('```');

  return lines.join('\n');
}

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

/**
 * Parse --cwd argument from args array.
 * Handles both '--cwd path' and '--cwd=path' forms.
 * Uses indexOf to avoid truncating paths containing '=' characters.
 */
export function parseCwdArg(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --cwd=path form (use indexOf to preserve '=' in path)
    if (arg.startsWith('--cwd=')) {
      return arg.substring('--cwd='.length);
    }

    // Handle --cwd path form
    if (arg === '--cwd' && i + 1 < args.length) {
      return args[i + 1];
    }
  }

  return process.cwd();
}

/**
 * Execute the info command
 */
export async function executeInfoCommand(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json');
  const copyable = args.includes('--copyable') || args.includes('-c');
  const cwd = parseCwdArg(args);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${BOLD}ralph-tui info${RESET} - Display system information for bug reports

${BOLD}Usage:${RESET} ralph-tui info [options]

${BOLD}Options:${RESET}
  ${DIM}--json${RESET}            Output in JSON format
  ${DIM}--copyable, -c${RESET}    Output in copyable format for bug reports
  ${DIM}--cwd <path>${RESET}      Working directory (default: current directory)
  ${DIM}-h, --help${RESET}        Show this help message

${BOLD}Description:${RESET}
  Collects and displays diagnostic information about your ralph-tui
  installation. This is useful for including in bug reports.

  Information collected:
  - ralph-tui version
  - Runtime (Bun/Node) version
  - Operating system details
  - Configuration file locations and status
  - Installed templates
  - Agent detection status
  - Tracker configuration
  - Installed skills (per agent and custom directory)

${BOLD}Examples:${RESET}
  ${CYAN}ralph-tui info${RESET}              # Display system info
  ${CYAN}ralph-tui info --json${RESET}       # JSON output for scripts
  ${CYAN}ralph-tui info -c${RESET}           # Copyable format for bug reports
`);
    return;
  }

  try {
    const info = await collectSystemInfo(cwd);

    if (jsonOutput) {
      console.log(JSON.stringify(info, null, 2));
    } else if (copyable) {
      console.log(formatForBugReport(info));
    } else {
      console.log();
      console.log(formatSystemInfo(info));
      console.log();
      console.log(`${DIM}Tip: Use ${CYAN}ralph-tui info -c${RESET}${DIM} for a copyable bug report format${RESET}`);
      console.log();
    }
  } catch (error) {
    console.error(`${YELLOW}Error collecting system info:${RESET}`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
