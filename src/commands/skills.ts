/**
 * ABOUTME: Skills command for managing Claude Code skills.
 * Provides ralph-tui skills list and ralph-tui skills install commands.
 */

import {
  listBundledSkills,
  installSkill,
  isSkillInstalled,
  getClaudeSkillsDir,
} from '../setup/skill-installer.js';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

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
${BOLD}ralph-tui skills${RESET} - Manage Claude Code skills

${BOLD}Commands:${RESET}
  ${CYAN}list${RESET}              List bundled skills and their installation status
  ${CYAN}install${RESET}           Install skills to ~/.claude/skills/

${BOLD}Install Options:${RESET}
  ${DIM}<name>${RESET}             Install a specific skill by name
  ${DIM}--all${RESET}              Install all bundled skills (default if no name given)
  ${DIM}--force${RESET}            Overwrite existing skills

${BOLD}Examples:${RESET}
  ralph-tui skills list                    # List all bundled skills
  ralph-tui skills install                 # Install all skills (skip existing)
  ralph-tui skills install --force         # Force reinstall all skills
  ralph-tui skills install ralph-tui-prd   # Install specific skill
  ralph-tui skills install ralph-tui-prd --force  # Force reinstall specific skill

${BOLD}Skills Location:${RESET}
  Skills are installed to: ${DIM}~/.claude/skills/{skill-name}/SKILL.md${RESET}
  These skills are automatically available to Claude Code.
`);
}

/**
 * Handle the 'skills list' command.
 * Lists all bundled skills and their installation status.
 */
async function handleListSkills(): Promise<void> {
  const skills = await listBundledSkills();

  if (skills.length === 0) {
    console.log(`${YELLOW}No bundled skills found.${RESET}`);
    return;
  }

  console.log(`${BOLD}Bundled Skills${RESET}`);
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`);
  console.log(`${DIM}Install location: ${getClaudeSkillsDir()}${RESET}\n`);

  for (const skill of skills) {
    const installed = await isSkillInstalled(skill.name);
    const status = installed
      ? `${GREEN}✓ installed${RESET}`
      : `${DIM}not installed${RESET}`;

    console.log(`${CYAN}${skill.name}${RESET} ${status}`);
    console.log(`  ${DIM}${skill.description}${RESET}`);
    console.log();
  }

  console.log(`${DIM}${'─'.repeat(60)}${RESET}`);
  console.log(`${DIM}Use 'ralph-tui skills install' to install skills${RESET}`);
}

/**
 * Parse arguments for the install command.
 * Handles both '--name value' and '--name=value' forms.
 */
function parseInstallArgs(args: string[]): {
  skillName: string | null;
  all: boolean;
  force: boolean;
} {
  let skillName: string | null = null;
  let all = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--all' || arg === '-a') {
      all = true;
    } else if (!arg.startsWith('-')) {
      // Positional argument = skill name
      skillName = arg;
    }
  }

  // If no skill name and no --all flag, default to --all
  if (!skillName && !all) {
    all = true;
  }

  return { skillName, all, force };
}

/**
 * Handle the 'skills install' command.
 * Installs skills to ~/.claude/skills/
 */
async function handleInstallSkills(args: string[]): Promise<void> {
  const { skillName, all, force } = parseInstallArgs(args);

  const skills = await listBundledSkills();

  if (skills.length === 0) {
    console.log(`${YELLOW}No bundled skills found.${RESET}`);
    return;
  }

  // Install specific skill
  if (skillName && !all) {
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
      console.error(`${RED}Error:${RESET} Skill '${skillName}' not found.`);
      console.log(`${DIM}Available skills: ${skills.map((s) => s.name).join(', ')}${RESET}`);
      process.exit(1);
    }

    console.log(`${BOLD}Installing skill: ${CYAN}${skillName}${RESET}`);
    const result = await installSkill(skillName, { force });

    if (result.success) {
      if (result.skipped) {
        console.log(`${DIM}⊘${RESET} Skipped: ${skillName} ${DIM}(already exists, use --force to overwrite)${RESET}`);
      } else {
        console.log(`${GREEN}✓${RESET} Installed: ${CYAN}${skillName}${RESET}`);
        console.log(`  ${DIM}→ ${result.path}${RESET}`);
      }
    } else {
      console.error(`${RED}✗${RESET} Failed: ${skillName} - ${result.error}`);
      process.exit(1);
    }
    return;
  }

  // Install all skills
  console.log(`${BOLD}Installing all bundled skills...${RESET}`);
  console.log(`${DIM}Target: ${getClaudeSkillsDir()}${RESET}\n`);

  let installed = 0;
  let skipped = 0;
  let failed = 0;

  for (const skill of skills) {
    const result = await installSkill(skill.name, { force });

    if (result.success) {
      if (result.skipped) {
        console.log(`${DIM}⊘${RESET} Skipped: ${skill.name} ${DIM}(already exists)${RESET}`);
        skipped++;
      } else {
        console.log(`${GREEN}✓${RESET} Installed: ${CYAN}${skill.name}${RESET}`);
        installed++;
      }
    } else {
      console.log(`${RED}✗${RESET} Failed: ${skill.name} - ${result.error}`);
      failed++;
    }
  }

  console.log();
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
  console.log(`${GREEN}Installed:${RESET} ${installed}  ${DIM}Skipped:${RESET} ${skipped}  ${RED}Failed:${RESET} ${failed}`);

  if (skipped > 0 && !force) {
    console.log(`\n${DIM}Tip: Use --force to overwrite existing skills${RESET}`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}
