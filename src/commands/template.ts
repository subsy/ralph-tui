/**
 * ABOUTME: Template commands for viewing and initializing prompt templates.
 * Provides ralph-tui template show and ralph-tui template init commands.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadStoredConfig } from '../config/index.js';
import {
  loadTemplate,
  getTemplateTypeFromPlugin,
  copyBuiltinTemplate,
  getCustomTemplatePath,
  installBuiltinTemplates,
  type BuiltinTemplateType,
} from '../templates/index.js';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';

/**
 * Execute the template command.
 * @param args Command arguments: ['show'] or ['init', options...]
 */
export async function executeTemplateCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  // Check for help flag
  if (subcommand === '--help' || subcommand === '-h') {
    printTemplateHelp();
    return;
  }

  if (subcommand === 'show') {
    // Check for help in subcommand args
    if (args.includes('--help') || args.includes('-h')) {
      printTemplateHelp();
      return;
    }
    await handleShowTemplate(args.slice(1));
    return;
  }

  if (subcommand === 'init' || subcommand === 'install') {
    // Check for help in subcommand args
    if (args.includes('--help') || args.includes('-h')) {
      printTemplateHelp();
      return;
    }
    await handleInitTemplate(args.slice(1));
    return;
  }

  // Help or unknown subcommand
  printTemplateHelp();
}

/**
 * Print help for the template command.
 * Exported for use in index.ts
 */
export function printTemplateHelp(): void {
  showTemplateHelp();
}

/**
 * Show help for template commands.
 */
function showTemplateHelp(): void {
  console.log(`
${BOLD}ralph-tui template${RESET} - Manage prompt templates

${BOLD}Commands:${RESET}
  ${CYAN}show${RESET}              Display the current template being used
  ${CYAN}init${RESET}              Copy default template for customization
  ${CYAN}install${RESET}           Alias for init

${BOLD}Show Options:${RESET}
  ${DIM}--tracker <name>${RESET}   Show template for specific tracker (default, beads, beads-bv, json)
  ${DIM}--custom <path>${RESET}    Show template from a custom file path

${BOLD}Init Options:${RESET}
  ${DIM}--tracker <name>${RESET}   Use template for specific tracker (default, beads, beads-bv, json)
  ${DIM}--output <path>${RESET}    Custom output path (default: ./ralph-prompt.hbs)
  ${DIM}--global${RESET}           Install all templates to ~/.config/ralph-tui/templates/
  ${DIM}--force${RESET}            Overwrite existing file

${BOLD}Examples:${RESET}
  ralph-tui template show                    # Show current template
  ralph-tui template show --tracker beads    # Show built-in beads template
  ralph-tui template init                    # Copy default template for customization
  ralph-tui template init --tracker beads    # Copy beads template
  ralph-tui template init --global           # Install all templates to global config

${BOLD}Template Resolution Order:${RESET}
  Ralph searches for templates in this order (first match wins):
  1. Explicit --prompt <path> or prompt_template in config
  2. Project templates: .ralph-tui/templates/{tracker}.hbs
  3. Global templates: ~/.config/ralph-tui/templates/{tracker}.hbs
  4. Tracker plugin bundled template
  5. Built-in fallback

${BOLD}Template Variables:${RESET}
  ${DIM}Task:${RESET}     {{taskId}}, {{taskTitle}}, {{taskDescription}}, {{acceptanceCriteria}}
            {{type}}, {{status}}, {{priority}}, {{notes}}
  ${DIM}Relations:${RESET} {{dependsOn}}, {{blocks}}, {{labels}}, {{epicId}}, {{epicTitle}}
  ${DIM}Context:${RESET}  {{trackerName}}, {{agentName}}, {{model}}, {{cwd}}, {{beadsDbPath}}
            {{currentDate}}, {{currentTimestamp}}
  ${DIM}PRD:${RESET}      {{prdName}}, {{prdDescription}}, {{prdContent}}
            {{prdCompletedCount}}, {{prdTotalCount}}
  ${DIM}Progress:${RESET} {{recentProgress}}, {{codebasePatterns}}, {{selectionReason}}
`);
}

/**
 * Handle the 'template show' command.
 * Displays the current template or a specific built-in template.
 */
async function handleShowTemplate(args: string[]): Promise<void> {
  const cwd = process.cwd();

  // Parse options
  let trackerType: BuiltinTemplateType = 'default';
  let customPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tracker' && args[i + 1]) {
      trackerType = args[++i] as BuiltinTemplateType;
    } else if (arg === '--custom' && args[i + 1]) {
      customPath = args[++i];
    }
  }

  // If no explicit options, check config for custom template
  if (!customPath) {
    const storedConfig = await loadStoredConfig(cwd);
    if (storedConfig.prompt_template) {
      customPath = storedConfig.prompt_template;
    }

    // Also get tracker type from config if not specified
    if (trackerType === 'default' && storedConfig.tracker) {
      trackerType = getTemplateTypeFromPlugin(storedConfig.tracker);
    }
  }

  // Load the template
  const result = loadTemplate(customPath, trackerType, cwd);

  if (!result.success) {
    console.error(`${RED}Error:${RESET} ${result.error}`);
    process.exit(1);
  }

  // Display template info
  console.log(`${BOLD}Template Source:${RESET} ${CYAN}${result.source}${RESET}`);
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`);
  console.log(result.content);
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`);

  // Show available variables reminder
  console.log(`\n${DIM}Tip: Use {{variableName}} for template variables${RESET}`);
}

/**
 * Handle the 'template init' command.
 * Copies a built-in template to a custom location for customization.
 * With --global flag, installs all templates to ~/.config/ralph-tui/templates/
 */
async function handleInitTemplate(args: string[]): Promise<void> {
  const cwd = process.cwd();

  // Parse options
  let trackerType: BuiltinTemplateType = 'default';
  let outputPath = getCustomTemplatePath(cwd);
  let force = false;
  let global = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tracker' && args[i + 1]) {
      trackerType = args[++i] as BuiltinTemplateType;
    } else if (arg === '--output' && args[i + 1]) {
      outputPath = path.isAbsolute(args[i + 1])
        ? args[++i]
        : path.resolve(cwd, args[++i]);
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--global') {
      global = true;
    }
  }

  // Handle --global flag: install all templates to global config
  if (global) {
    console.log(`${BOLD}Installing templates to global config...${RESET}`);
    const result = installBuiltinTemplates(force);

    console.log(`${DIM}Templates directory: ${result.templatesDir}${RESET}\n`);

    for (const r of result.results) {
      if (r.created) {
        console.log(`${GREEN}✓${RESET} Created: ${CYAN}${r.file}${RESET}`);
      } else if (r.skipped) {
        console.log(`${DIM}⊘${RESET} Skipped: ${r.file} ${DIM}(already exists, use --force to overwrite)${RESET}`);
      } else if (r.error) {
        console.log(`${RED}✗${RESET} Failed: ${r.file} - ${r.error}`);
      }
    }

    if (result.success) {
      console.log(`\n${GREEN}Done!${RESET}`);
      console.log(`\n${BOLD}Templates will be used as fallback for all projects.${RESET}`);
      console.log(`${DIM}Override per-project in .ralph-tui/templates/${RESET}`);
    } else {
      console.log(`\n${RED}Some templates could not be created.${RESET}`);
      process.exit(1);
    }
    return;
  }

  // Auto-detect tracker type from config if not specified
  if (trackerType === 'default') {
    const storedConfig = await loadStoredConfig(cwd);
    if (storedConfig.tracker) {
      trackerType = getTemplateTypeFromPlugin(storedConfig.tracker);
      console.log(`${DIM}Detected tracker: ${trackerType}${RESET}`);
    }
  }

  // Check if file exists
  if (fs.existsSync(outputPath) && !force) {
    console.error(
      `${RED}Error:${RESET} File already exists: ${outputPath}`
    );
    console.log(`${DIM}Use --force to overwrite${RESET}`);
    process.exit(1);
  }

  // Copy the template
  const result = copyBuiltinTemplate(trackerType, outputPath);

  if (!result.success) {
    console.error(`${RED}Error:${RESET} ${result.error}`);
    process.exit(1);
  }

  console.log(`${GREEN}✓${RESET} Template created: ${CYAN}${outputPath}${RESET}`);
  console.log(`${DIM}Template type: ${trackerType}${RESET}`);
  console.log(`\n${BOLD}Next steps:${RESET}`);
  console.log(`  1. Edit ${path.basename(outputPath)} to customize the prompt`);
  console.log(`  2. Add to your ${CYAN}.ralph-tui/config.toml${RESET}:`);
  console.log(`     ${DIM}prompt_template: ${path.relative(cwd, outputPath)}${RESET}`);
  console.log(`\n${DIM}See 'ralph-tui template show' for available variables${RESET}`);
}

