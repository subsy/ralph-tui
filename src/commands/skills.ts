/**
 * ABOUTME: Skills command for managing agent skills.
 * Provides ralph-tui skills list and ralph-tui skills install commands.
 * Supports multiple agents (Claude Code, OpenCode, Factory Droid) via plugin-defined paths.
 */

import {
  listBundledSkills,
  resolveSkillsPath,
  installSkillsForAgent,
  getSkillStatusForAgent,
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
  ${CYAN}install${RESET}           Install skills to detected agents

${BOLD}Install Options:${RESET}
  ${DIM}<name>${RESET}             Install a specific skill by name
  ${DIM}--all${RESET}              Install all bundled skills (default if no name given)
  ${DIM}--force${RESET}            Overwrite existing skills
  ${DIM}--agent <id>${RESET}       Install only to specific agent (claude, opencode, droid)

${BOLD}Examples:${RESET}
  ralph-tui skills list                    # List all skills per agent
  ralph-tui skills install                 # Install all skills to all agents
  ralph-tui skills install --force         # Force reinstall all skills
  ralph-tui skills install ralph-tui-prd   # Install specific skill
  ralph-tui skills install --agent claude  # Install only to Claude Code
  ralph-tui skills install --agent opencode --force  # Force reinstall to OpenCode

${BOLD}Supported Agents:${RESET}
  ${CYAN}claude${RESET}    Claude Code     ~/.claude/skills/
  ${CYAN}opencode${RESET}  OpenCode        ~/.config/opencode/skills/
  ${CYAN}droid${RESET}     Factory Droid   ~/.factory/skills/

${BOLD}Note:${RESET}
  Skills are installed to the personal (global) directory by default.
  These skills are then available to the agent across all projects.
`);
}

/**
 * Handle the 'skills list' command.
 * Lists all bundled skills and their installation status per agent.
 */
async function handleListSkills(): Promise<void> {
  const skills = await listBundledSkills();

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
    console.log(`${statusIcon} ${BOLD}${agent.meta.name}${RESET}${availableText}`);
    console.log(`  ${DIM}Personal: ${resolveSkillsPath(agent.skillsPaths.personal)}${RESET}`);

    if (agent.available) {
      const status = await getSkillStatusForAgent(agent.skillsPaths);
      for (const skill of skills) {
        const skillStatus = status.get(skill.name);
        const installed = skillStatus?.personal ?? false;
        const statusText = installed
          ? `${GREEN}✓ installed${RESET}`
          : `${DIM}not installed${RESET}`;
        console.log(`    ${skill.name}: ${statusText}`);
      }
    }
    console.log();
  }

  console.log(`${DIM}${'─'.repeat(70)}${RESET}`);
  console.log(`${DIM}Use 'ralph-tui skills install' to install skills${RESET}`);
}

/**
 * Parse arguments for the install command.
 */
function parseInstallArgs(args: string[]): {
  skillName: string | null;
  all: boolean;
  force: boolean;
  agentId: string | null;
} {
  let skillName: string | null = null;
  let all = false;
  let force = false;
  let agentId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--all' || arg === '-a') {
      all = true;
    } else if (arg === '--agent') {
      // Next arg is the agent ID
      if (i + 1 < args.length) {
        agentId = args[++i];
      }
    } else if (arg.startsWith('--agent=')) {
      agentId = arg.substring('--agent='.length);
    } else if (!arg.startsWith('-')) {
      // Positional argument = skill name
      skillName = arg;
    }
  }

  // If no skill name and no --all flag, default to --all
  if (!skillName && !all) {
    all = true;
  }

  return { skillName, all, force, agentId };
}

/**
 * Handle the 'skills install' command.
 * Installs skills to all detected agents (or a specific agent).
 */
async function handleInstallSkills(args: string[]): Promise<void> {
  const { skillName, force, agentId } = parseInstallArgs(args);

  const skills = await listBundledSkills();

  if (skills.length === 0) {
    console.log(`${YELLOW}No bundled skills found.${RESET}`);
    return;
  }

  // Validate skill name if provided
  if (skillName) {
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
      console.error(`${RED}Error:${RESET} Skill '${skillName}' not found.`);
      console.log(`${DIM}Available skills: ${skills.map((s) => s.name).join(', ')}${RESET}`);
      process.exit(1);
    }
  }

  // Get agents to install to
  let agents = await getSkillCapableAgents();

  // Filter by agent ID if specified
  if (agentId) {
    const matchingAgent = agents.find((a) => a.meta.id === agentId);
    if (!matchingAgent) {
      console.error(`${RED}Error:${RESET} Unknown agent '${agentId}'.`);
      console.log(`${DIM}Available agents: ${agents.map((a) => a.meta.id).join(', ')}${RESET}`);
      process.exit(1);
    }
    agents = [matchingAgent];
  }

  // Filter to only available agents (unless specific agent requested)
  const availableAgents = agentId
    ? agents // If specific agent requested, include it even if not available
    : agents.filter((a) => a.available);

  if (availableAgents.length === 0) {
    console.log(`${YELLOW}No supported agents detected.${RESET}`);
    console.log(`${DIM}Install Claude Code, OpenCode, or Factory Droid to use skills.${RESET}`);
    return;
  }

  // Show what we're installing
  const skillText = skillName ? `skill: ${CYAN}${skillName}${RESET}` : 'all skills';
  const agentText = agentId
    ? `to ${CYAN}${agentId}${RESET}`
    : `to ${availableAgents.length} agent(s)`;
  console.log(`${BOLD}Installing ${skillText} ${agentText}...${RESET}\n`);

  let totalInstalled = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  // Install to each agent
  for (const agent of availableAgents) {
    console.log(`${BOLD}${agent.meta.name}${RESET}`);
    console.log(`${DIM}${resolveSkillsPath(agent.skillsPaths.personal)}${RESET}`);

    const result = await installSkillsForAgent(
      agent.meta.id,
      agent.meta.name,
      agent.skillsPaths,
      {
        force,
        personal: true,
        repo: false,
        skillName: skillName ?? undefined,
      }
    );

    // Show results for each skill
    for (const [name, targetResults] of result.skills) {
      // Currently only installing to personal, so check each target result
      for (const { result: skillResult } of targetResults) {
        if (skillResult.success) {
          if (skillResult.skipped) {
            console.log(`  ${DIM}⊘${RESET} Skipped: ${name} ${DIM}(already exists)${RESET}`);
            totalSkipped++;
          } else {
            console.log(`  ${GREEN}✓${RESET} Installed: ${CYAN}${name}${RESET}`);
            totalInstalled++;
          }
        } else {
          console.log(`  ${RED}✗${RESET} Failed: ${name} - ${skillResult.error}`);
          totalFailed++;
        }
      }
    }
    console.log();
  }

  // Summary
  console.log(`${DIM}${'─'.repeat(50)}${RESET}`);
  console.log(`${GREEN}Installed:${RESET} ${totalInstalled}  ${DIM}Skipped:${RESET} ${totalSkipped}  ${RED}Failed:${RESET} ${totalFailed}`);

  if (totalSkipped > 0 && !force) {
    console.log(`\n${DIM}Tip: Use --force to overwrite existing skills${RESET}`);
  }

  if (totalFailed > 0) {
    process.exit(1);
  }
}
