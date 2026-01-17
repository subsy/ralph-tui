/**
 * ABOUTME: Create-PRD command for ralph-tui.
 * Uses AI-powered conversation to create Product Requirements Documents.
 * After PRD generation, shows split view with PRD preview and tracker options.
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrdChatApp } from '../tui/components/PrdChatApp.js';
import type { PrdCreationResult } from '../tui/components/PrdChatApp.js';
import { loadStoredConfig, requireSetup } from '../config/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type {
  AgentPlugin,
  AgentPluginConfig,
} from '../plugins/agents/types.js';
import { executeRunCommand } from './run.js';
import { performExitCleanup } from '../tui/utils/exit-cleanup.js';

/**
 * Command-line arguments for the create-prd command.
 */
export interface CreatePrdArgs {
  /** Working directory */
  cwd?: string;

  /** Output directory for PRD files */
  output?: string;

  /** Number of user stories to generate */
  stories?: number;

  /** Force overwrite of existing files */
  force?: boolean;

  /** Override agent plugin */
  agent?: string;

  /** Timeout for agent calls in milliseconds */
  timeout?: number;

  prdSkill?: string;

  prdSkillSource?: string;
}

/**
 * Parse create-prd command arguments.
 */
export function parseCreatePrdArgs(args: string[]): CreatePrdArgs {
  const result: CreatePrdArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--cwd' || arg === '-C') {
      result.cwd = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (arg === '--stories' || arg === '-n') {
      const count = parseInt(args[++i] ?? '', 10);
      if (!isNaN(count)) {
        result.stories = count;
      }
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
    } else if (arg === '--agent' || arg === '-a') {
      result.agent = args[++i];
    } else if (arg === '--timeout' || arg === '-t') {
      const timeout = parseInt(args[++i] ?? '', 10);
      if (!isNaN(timeout)) {
        result.timeout = timeout;
      }
    } else if (arg === '--prd-skill') {
      result.prdSkill = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printCreatePrdHelp();
      process.exit(0);
    }
  }

  return result;
}

/**
 * Print help for the create-prd command.
 */
export function printCreatePrdHelp(): void {
  console.log(`
ralph-tui create-prd - Create a new PRD with AI assistance

Usage: ralph-tui create-prd [options]
       ralph-tui prime [options]

Options:
  --cwd, -C <path>       Working directory (default: current directory)
  --output, -o <dir>     Output directory for PRD files (default: ./tasks)
  --agent, -a <name>     Agent plugin to use (default: from config)
  --timeout, -t <ms>     Timeout for AI agent calls (default: 180000)
  --prd-skill <name>     PRD skill folder inside skills_dir
  --force, -f            Overwrite existing files without prompting
  --help, -h             Show this help message

Description:
  Creates a Product Requirements Document (PRD) through an AI-powered conversation.

  The AI agent (using the ralph-tui-prd skill):
  1. Asks about the feature you want to build
  2. Asks contextual follow-up questions about users, requirements, and scope
  3. Generates a markdown PRD with user stories and acceptance criteria
  4. Offers to create tracker tasks (prd.json or beads)

  Requires an AI agent to be configured. Run 'ralph-tui setup' to configure one.

Examples:
  ralph-tui create-prd                      # Start AI-powered PRD creation
  ralph-tui prime                           # Alias for create-prd
  ralph-tui create-prd --agent claude       # Use specific agent
  ralph-tui create-prd --output ./docs      # Save PRD to custom directory
`);
}

async function loadPrdSkillSource(
  prdSkill: string,
  skillsDir: string,
  cwd: string,
): Promise<string> {
  const resolvedSkillsDir = resolve(cwd, skillsDir);

  try {
    const stats = await stat(resolvedSkillsDir);
    if (!stats.isDirectory()) {
      console.error(
        `Error: skills_dir '${skillsDir}' is not a directory at ${resolvedSkillsDir}.`,
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `Error: skills_dir '${skillsDir}' was not found or not readable at ${resolvedSkillsDir}.`,
    );
    process.exit(1);
  }

  const skillPath = join(resolvedSkillsDir, prdSkill);

  try {
    const stats = await stat(skillPath);
    if (!stats.isDirectory()) {
      console.error(
        `Error: PRD skill '${prdSkill}' is not a directory in ${resolvedSkillsDir}.`,
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `Error: PRD skill '${prdSkill}' was not found in ${resolvedSkillsDir}.`,
    );
    process.exit(1);
  }

  const skillFile = join(skillPath, 'SKILL.md');

  try {
    await access(skillFile, constants.R_OK);
  } catch {
    console.error(
      `Error: PRD skill '${prdSkill}' is missing SKILL.md in ${skillPath}.`,
    );
    process.exit(1);
  }

  try {
    const skillSource = await readFile(skillFile, 'utf-8');
    if (!skillSource.trim()) {
      console.error(
        `Error: PRD skill '${prdSkill}' has an empty SKILL.md in ${skillPath}.`,
      );
      process.exit(1);
    }
    return skillSource;
  } catch (error) {
    console.error(
      `Error: Failed to read PRD skill '${prdSkill}' from ${skillFile}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

/**
 * Get the configured agent plugin.
 */
async function getAgent(agentName?: string): Promise<AgentPlugin | null> {
  try {
    const cwd = process.cwd();
    const storedConfig = await loadStoredConfig(cwd);

    // Register built-in agents
    registerBuiltinAgents();
    const registry = getAgentRegistry();
    await registry.initialize();

    // Determine target agent
    const targetAgent =
      agentName || storedConfig.agent || storedConfig.defaultAgent || 'claude';

    // Build agent config
    const agentConfig: AgentPluginConfig = {
      name: targetAgent,
      plugin: targetAgent,
      options: storedConfig.agentOptions || {},
    };

    // Get agent instance
    const agent = await registry.getInstance(agentConfig);

    // Check if agent is ready
    const isReady = await agent.isReady();
    if (!isReady) {
      const detection = await agent.detect();
      if (!detection.available) {
        console.error(
          `Agent '${targetAgent}' is not available: ${detection.error || 'not detected'}`,
        );
        return null;
      }
    }

    return agent;
  } catch (error) {
    console.error(
      'Failed to load agent:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Run the AI-powered chat mode for PRD creation.
 * Returns the creation result if successful, or null if cancelled.
 */
async function runChatMode(
  parsedArgs: CreatePrdArgs,
): Promise<PrdCreationResult | null> {
  // Get agent
  const agent = await getAgent(parsedArgs.agent);
  if (!agent) {
    console.error('');
    console.error('Chat mode requires an AI agent. Options:');
    console.error('  1. Run "ralph-tui setup" to configure an agent');
    console.error(
      '  2. Use "--agent claude" or "--agent opencode" to specify one',
    );
    process.exit(1);
  }

  const cwd = parsedArgs.cwd || process.cwd();
  const outputDir = parsedArgs.output || 'tasks';
  const timeout = parsedArgs.timeout == undefined ? 180000 : parsedArgs.timeout;

  console.log(`Using agent: ${agent.meta.name}`);
  console.log('');

  // Create renderer and render the chat app
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C in the app
  });

  const root = createRoot(renderer);

  return new Promise<PrdCreationResult | null>((resolve) => {
    const handleComplete = async (result: PrdCreationResult) => {
      root.unmount();
      renderer.destroy();

      // Clean up any attached images from this session
      try {
        await performExitCleanup({ cwd });
      } catch (err) {
        // Don't let cleanup errors prevent normal exit
        console.error(
          'Warning: Image cleanup failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      console.log('');
      console.log(`PRD workflow complete: ${result.prdPath}`);
      resolve(result);
    };

    const handleCancel = async () => {
      root.unmount();
      renderer.destroy();

      // Clean up any attached images from this session
      try {
        await performExitCleanup({ cwd });
      } catch (err) {
        // Don't let cleanup errors prevent normal exit
        console.error(
          'Warning: Image cleanup failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      console.log('');
      console.log('PRD creation cancelled.');
      resolve(null);
    };

    const handleError = (error: string) => {
      console.error('Error:', error);
    };

    root.render(
      <PrdChatApp
        agent={agent}
        cwd={cwd}
        outputDir={outputDir}
        timeout={timeout}
        prdSkill={parsedArgs.prdSkill}
        prdSkillSource={parsedArgs.prdSkillSource}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onError={handleError}
      />,
    );
  });
}

/**
 * Execute the create-prd command.
 * Always uses AI-powered chat mode for conversational PRD creation.
 * If a tracker format is selected, launches ralph-tui run with the tasks loaded.
 */
export async function executeCreatePrdCommand(args: string[]): Promise<void> {
  const parsedArgs = parseCreatePrdArgs(args);
  const cwd = parsedArgs.cwd || process.cwd();

  // Verify setup is complete before running
  await requireSetup(cwd, 'ralph-tui prime');

  const storedConfig = await loadStoredConfig(cwd);

  if (parsedArgs.prdSkill) {
    if (!storedConfig.skills_dir?.trim()) {
      console.error(
        'Error: --prd-skill requires skills_dir to be set in config.',
      );
      console.error(
        'Set skills_dir in ~/.config/ralph-tui/config.toml or .ralph-tui/config.toml.',
      );
      process.exit(1);
    }

    parsedArgs.prdSkillSource = await loadPrdSkillSource(
      parsedArgs.prdSkill,
      storedConfig.skills_dir,
      cwd,
    );
  }

  const result = await runChatMode(parsedArgs);

  // If cancelled or no result, exit
  if (!result) {
    process.exit(0);
  }

  // If a tracker format was selected, launch ralph-tui with the tasks loaded
  if (result.selectedTracker) {
    console.log('');
    console.log('Launching Ralph TUI with your new tasks...');
    console.log('');

    const runArgs: string[] = [];

    if (result.selectedTracker === 'json') {
      // JSON tracker: pass the prd.json path (skill creates it in tasks/ alongside PRD markdown)
      runArgs.push('--prd', './tasks/prd.json');
    }
    // For beads: no args needed, epic selection will show

    // Execute run command (this will show the TUI)
    await executeRunCommand(runArgs);
    // Note: executeRunCommand handles process.exit internally
  }

  process.exit(0);
}
