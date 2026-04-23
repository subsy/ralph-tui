/**
 * ABOUTME: Skills command for managing agent skills.
 * Provides ralph-tui skills list and ralph-tui skills install commands.
 * Install delegates to Vercel's add-skill CLI for ecosystem compatibility.
 */

import { spawn } from 'node:child_process';
import {
  getSkillSearchPaths,
  listBundledSkills,
  getSkillStatusForAgent,
  AGENT_ID_MAP,
  resolveAddSkillAgentId,
  isEloopOnlyFailure,
} from '../setup/skill-installer.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type { AgentPluginMeta, AgentSkillsPaths } from '../plugins/agents/types.js';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

/**
 * Information about an agent that supports skills.
 */
interface SkillCapableAgent {
  meta: AgentPluginMeta;
  available: boolean;
  skillsPaths: AgentSkillsPaths;
}

interface VerifiedInstallSummary {
  skillCount: number;
  agentNames: string[];
}

/**
 * Get all agents that support skills, along with their availability status.
 */
async function getSkillCapableAgents(): Promise<SkillCapableAgent[]> {
  // Ensure built-in agents are registered
  registerBuiltinAgents();

  const registry = getAgentRegistry();
  const plugins = registry.getRegisteredPlugins();
  const agents: SkillCapableAgent[] = [];

  for (const meta of plugins) {
    // Skip agents without skillsPaths defined
    if (!meta.skillsPaths) {
      continue;
    }

    // Check if agent is available
    const instance = registry.createInstance(meta.id);
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

    agents.push({
      meta,
      available,
      skillsPaths: meta.skillsPaths,
    });
  }

  return agents;
}

/**
 * Format one or more discovery paths for display.
 */
function formatSkillPaths(paths: string[]): string {
  return paths.join(', ');
}

/**
 * Verify install results against the actual agent discovery paths we support.
 * This is used as a fallback when the upstream skills CLI output is not parseable.
 */
async function verifyInstalledSkills(options: {
  skillName: string | null;
  agentId: string | null;
  local: boolean;
}, agents: SkillCapableAgent[]): Promise<VerifiedInstallSummary | null> {
  const targetAgents = options.agentId
    ? agents.filter((agent) => agent.available && agent.meta.id === options.agentId)
    : agents.filter((agent) => agent.available);

  if (targetAgents.length === 0) {
    return null;
  }

  const skillNames = options.skillName
    ? [options.skillName]
    : (await listBundledSkills()).map((skill) => skill.name);

  const agentNames: string[] = [];
  for (const agent of targetAgents) {
    const status = await getSkillStatusForAgent(agent.skillsPaths, process.cwd(), agent.meta.id);
    const installedInRequestedScope = skillNames.every((skillName) => {
      const skillStatus = status.get(skillName);
      return options.local
        ? skillStatus?.repo === true
        : skillStatus?.personal === true;
    });

    if (installedInRequestedScope) {
      agentNames.push(agent.meta.name);
    }
  }

  return {
    skillCount: skillNames.length,
    agentNames,
  };
}

/**
 * Execute the skills command.
 * @param args Command arguments: ['list'] or ['install', options...]
 */
export async function executeSkillsCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  // Check for help flag
  if (subcommand === '--help' || subcommand === '-h' || !subcommand) {
    printSkillsHelp();
    return;
  }

  if (subcommand === 'list') {
    if (args.includes('--help') || args.includes('-h')) {
      printSkillsHelp();
      return;
    }
    await handleListSkills();
    return;
  }

  if (subcommand === 'install') {
    if (args.includes('--help') || args.includes('-h')) {
      printSkillsHelp();
      return;
    }
    await handleInstallSkills(args.slice(1));
    return;
  }

  // Unknown subcommand
  console.error(`${RED}Unknown subcommand:${RESET} ${subcommand}`);
  printSkillsHelp();
  process.exit(1);
}

/**
 * Print help for the skills command.
 */
export function printSkillsHelp(): void {
  console.log(`
${BOLD}ralph-tui skills${RESET} - Manage agent skills

${BOLD}Commands:${RESET}
  ${CYAN}list${RESET}              List bundled skills and installation status per agent
  ${CYAN}install${RESET}           Install skills via add-skill (supports 20+ agents)

${BOLD}Install Options:${RESET}
  ${DIM}<name>${RESET}             Install a specific skill by name
  ${DIM}--all${RESET}              Install all bundled skills (default if no name given)
  ${DIM}--agent <id>${RESET}       Install only to specific agent (claude, opencode, codex, gemini, kiro)
  ${DIM}--local${RESET}            Install to project-local directory
  ${DIM}--global${RESET}           Install to personal/global directory (default)
  ${DIM}--copy${RESET}             Copy skills instead of symlinking (useful if symlink install fails)

${BOLD}Examples:${RESET}
  ralph-tui skills list                    # List all skills per agent
  ralph-tui skills install                 # Install all skills globally
  ralph-tui skills install --local         # Install all skills to local project
  ralph-tui skills install ralph-tui-prd   # Install specific skill
  ralph-tui skills install --agent claude  # Install only to Claude Code

${BOLD}Direct add-skill usage:${RESET}
  bunx add-skill subsy/ralph-tui --all     # Install to all agents globally
  bunx add-skill subsy/ralph-tui -s ralph-tui-prd -a claude-code -g -y

${BOLD}Supported Agents:${RESET}
  claude (claude-code), opencode, codex, gemini, kiro, and any agent
  supported by add-skill (cursor, cline, openhands, windsurf, etc.)
`);
}

/**
 * Handle the 'skills list' command.
 * Lists all bundled skills and their installation status per agent.
 */
async function handleListSkills(): Promise<void> {
  const skills = await listBundledSkills();
  const cwd = process.cwd();

  if (skills.length === 0) {
    console.log(`${YELLOW}No bundled skills found.${RESET}`);
    return;
  }

  const agents = await getSkillCapableAgents();

  console.log(`${BOLD}Bundled Skills${RESET}`);
  console.log(`${DIM}${'─'.repeat(70)}${RESET}\n`);

  // Show skills
  for (const skill of skills) {
    console.log(`${CYAN}${skill.name}${RESET}`);
    console.log(`  ${DIM}${skill.description}${RESET}`);
    console.log();
  }

  console.log(`${DIM}${'─'.repeat(70)}${RESET}`);
  console.log(`${BOLD}Installation Status by Agent${RESET}\n`);

  // Show status for each agent
  for (const agent of agents) {
    const statusIcon = agent.available ? `${GREEN}✓${RESET}` : `${DIM}○${RESET}`;
    const availableText = agent.available ? '' : ` ${DIM}(not installed)${RESET}`;
    const searchPaths = getSkillSearchPaths(agent.skillsPaths, cwd, agent.meta.id);
    console.log(`${statusIcon} ${BOLD}${agent.meta.name}${RESET}${availableText}`);
    console.log(`  ${DIM}Global: ${formatSkillPaths(searchPaths.personal)}${RESET}`);
    console.log(`  ${DIM}Local:  ${formatSkillPaths(searchPaths.repo)}${RESET}`);

    if (agent.available) {
      const status = await getSkillStatusForAgent(agent.skillsPaths, cwd, agent.meta.id);
      for (const skill of skills) {
        const skillStatus = status.get(skill.name);
        const globalInstalled = skillStatus?.personal ?? false;
        const localInstalled = skillStatus?.repo ?? false;

        let statusText: string;
        if (localInstalled && globalInstalled) {
          statusText = `${GREEN}✓ local${RESET} ${DIM}+${RESET} ${GREEN}global${RESET}`;
        } else if (localInstalled) {
          statusText = `${GREEN}✓ local${RESET}`;
        } else if (globalInstalled) {
          statusText = `${GREEN}✓ global${RESET}`;
        } else {
          statusText = `${DIM}not installed${RESET}`;
        }
        console.log(`    ${skill.name}: ${statusText}`);
      }
    }
    console.log();
  }

  console.log(`${DIM}${'─'.repeat(70)}${RESET}`);
  console.log(`${DIM}Use 'ralph-tui skills install' for global, '--local' for project-local${RESET}`);
}

/**
 * Parse arguments for the install command.
 */
export function parseInstallArgs(args: string[]): {
  skillName: string | null;
  agentId: string | null;
  local: boolean;
  global: boolean;
  copy: boolean;
} {
  let skillName: string | null = null;
  let agentId: string | null = null;
  let local = false;
  let global = false;
  let copy = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--local' || arg === '-l') {
      local = true;
    } else if (arg === '--global' || arg === '-g') {
      global = true;
    } else if (arg === '--copy') {
      copy = true;
    } else if (arg === '--all' || arg === '-a') {
      // Accepted for backwards compat but is now the default
    } else if (arg === '--force' || arg === '-f') {
      // Accepted for backwards compat; add-skill always overwrites
    } else if (arg === '--agent') {
      if (i + 1 < args.length) {
        agentId = args[++i];
      }
    } else if (arg.startsWith('--agent=')) {
      agentId = arg.substring('--agent='.length);
    } else if (!arg.startsWith('-')) {
      skillName = arg;
    }
  }

  // If neither --local nor --global specified, default to global
  if (!local && !global) {
    global = true;
  }

  return { skillName, agentId, local, global, copy };
}

/**
 * Build the bunx add-skill command arguments from parsed install options.
 */
export function buildAddSkillArgs(options: {
  skillName: string | null;
  agentId: string | null;
  local: boolean;
  global: boolean;
  copy?: boolean;
}): string[] {
  const args = ['add-skill', 'subsy/ralph-tui'];

  // Skill selection
  if (options.skillName) {
    args.push('-s', options.skillName);
  }

  // Agent targeting
  if (options.agentId) {
    args.push('-a', resolveAddSkillAgentId(options.agentId));
  }

  // Global vs local
  if (options.global) {
    args.push('-g');
  }

  // Copy mode avoids symlink strategy for environments where symlinks are problematic
  if (options.copy) {
    args.push('--copy');
  }

  // Non-interactive
  args.push('-y');

  return args;
}

/**
 * Parse the add-skill CLI output to extract installation results.
 */
export function parseAddSkillOutput(output: string): {
  skillCount: number;
  agentCount: number;
  agents: string[];
  installed: boolean;
  failureCount: number;
  eloopOnly: boolean;
} {
  const skillMatch = output.match(/Found (\d+) skills?/);
  const agentCountMatch = output.match(/Detected (\d+) agents?/);
  const agentsMatch = output.match(/Installing to: (.+)/);
  const failMatch = output.match(/Failed to install (\d+)/);

  const agents = agentsMatch
    ? agentsMatch[1].split(',').map(a => a.trim()).filter(a => a.length > 0)
    : [];

  const failureCount = failMatch ? parseInt(failMatch[1], 10) : 0;
  const detectedAgentCount = agentCountMatch ? parseInt(agentCountMatch[1], 10) : null;

  return {
    skillCount: skillMatch ? parseInt(skillMatch[1], 10) : 0,
    // add-skill output for targeted installs may omit "Detected X agents".
    // Fall back to parsed agent names from "Installing to:" for accurate summaries.
    agentCount: detectedAgentCount ?? agents.length,
    agents,
    installed: output.includes('Installation complete'),
    failureCount,
    eloopOnly: failureCount > 0 && isEloopOnlyFailure(output),
  };
}

/**
 * Handle the 'skills install' command.
 * Delegates to bunx add-skill for actual installation.
 */
async function handleInstallSkills(args: string[]): Promise<void> {
  const options = parseInstallArgs(args);

  // Warn if agent ID is not in our known map (will be passed through)
  if (options.agentId && !AGENT_ID_MAP[options.agentId]) {
    console.log(`${DIM}Note: Passing '${options.agentId}' directly to add-skill.${RESET}\n`);
  }

  const addSkillArgs = buildAddSkillArgs(options);

  // Show what we're doing
  const skillText = options.skillName
    ? `skill: ${CYAN}${options.skillName}${RESET}`
    : 'all skills';
  const agentText = options.agentId
    ? `to ${CYAN}${options.agentId}${RESET}`
    : 'to all detected agents';
  const locationText = options.local ? 'local (project)' : 'global';
  const modeText = options.copy ? ', copy mode' : ', symlink mode';
  console.log(`${BOLD}Installing ${skillText} ${agentText} [${locationText}${modeText}]${RESET}`);
  console.log(`${DIM}$ bunx ${addSkillArgs.join(' ')}${RESET}\n`);

  // Spawn bunx add-skill with piped output
  const { exitCode, output } = await new Promise<{ exitCode: number; output: string }>((resolve) => {
    const child = spawn('bunx', addSkillArgs, {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    let captured = '';

    child.stdout?.on('data', (data: Buffer) => {
      captured += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      captured += data.toString();
    });

    child.on('error', (err) => {
      resolve({
        exitCode: 1,
        output: `Failed to run add-skill: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output: captured });
    });
  });

  // Handle spawn/execution errors before attempting to parse output
  if (exitCode !== 0 && !output) {
    console.error(`${RED}Error:${RESET} No output from add-skill`);
    console.log(`${DIM}Run directly for details: bunx ${addSkillArgs.join(' ')}${RESET}`);
    return;
  } else if (output.startsWith('Failed to run add-skill')) {
    console.error(`${RED}Error:${RESET} ${output}`);
    console.log(`${DIM}Ensure bun is installed. You can also run directly:${RESET}`);
    console.log(`${DIM}  bunx ${addSkillArgs.join(' ')}${RESET}`);
    return;
  }

  const result = parseAddSkillOutput(output);
  const agents = result.installed && result.agentCount === 0
    ? await getSkillCapableAgents()
    : [];
  const verifiedResult = agents.length > 0
    ? await verifyInstalledSkills(options, agents)
    : null;

  if (result.installed) {
    const summary = verifiedResult && verifiedResult.agentNames.length > 0
      ? {
          skillCount: verifiedResult.skillCount,
          agentCount: verifiedResult.agentNames.length,
          agents: verifiedResult.agentNames,
        }
      : {
          skillCount: result.skillCount,
          agentCount: result.agentCount,
          agents: result.agents,
        };

    console.log(`${GREEN}✓${RESET} ${BOLD}Installed ${summary.skillCount} skill${summary.skillCount !== 1 ? 's' : ''} to ${summary.agentCount} agent${summary.agentCount !== 1 ? 's' : ''}${RESET}`);
    if (summary.agents.length > 0) {
      console.log(`  ${DIM}Agents: ${summary.agents.join(', ')}${RESET}`);
    }
    if (result.eloopOnly) {
      console.log(`  ${DIM}(Some agents share skill directories via symlinks — skills already accessible)${RESET}`);
      if (!options.copy) {
        console.log(`  ${DIM}(If you need physical files instead, rerun with: ralph-tui skills install --copy)${RESET}`);
      }
    }
  } else if (exitCode !== 0) {
    console.error(`${RED}✗${RESET} Installation failed`);
    console.log(`${DIM}Run directly for details: bunx ${addSkillArgs.join(' ')}${RESET}`);
  }

  console.log(`\n${DIM}Verify with: ralph-tui skills list${RESET}`);
}
