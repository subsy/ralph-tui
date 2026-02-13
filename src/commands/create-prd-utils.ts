/**
 * ABOUTME: Shared create-prd command utilities for CLI argument parsing,
 * help text rendering, tracker label parsing, and bundled PRD skill loading.
 */

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPlugin } from "../plugins/agents/types.js";

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

  /** Labels to apply to created beads issues (from config trackerOptions) */
  trackerLabels?: string[];
}

/**
 * Parse create-prd command arguments.
 */
export function parseCreatePrdArgs(args: string[]): CreatePrdArgs {
  const result: CreatePrdArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--cwd" || arg === "-C") {
      result.cwd = args[++i];
    } else if (arg === "--output" || arg === "-o") {
      result.output = args[++i];
    } else if (arg === "--stories" || arg === "-n") {
      const count = parseInt(args[++i] ?? "", 10);
      if (!isNaN(count)) {
        result.stories = count;
      }
    } else if (arg === "--force" || arg === "-f") {
      result.force = true;
    } else if (arg === "--agent" || arg === "-a") {
      result.agent = args[++i];
    } else if (arg === "--timeout" || arg === "-t") {
      const timeout = parseInt(args[++i] ?? "", 10);
      if (!isNaN(timeout)) {
        result.timeout = timeout;
      }
    } else if (arg === "--prd-skill") {
      result.prdSkill = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printCreatePrdHelp();
      process.exit(0);
    }
  }

  return result;
}

/**
 * Parse tracker labels from config trackerOptions.
 * Handles both string (comma-separated) and array formats.
 */
export function parseTrackerLabels(
  trackerOptions?: Record<string, unknown>,
): string[] | undefined {
  const configLabels = trackerOptions?.labels;
  if (typeof configLabels === "string") {
    const parsed = configLabels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : undefined;
  }

  if (Array.isArray(configLabels)) {
    const parsed = (configLabels as unknown[])
      .filter((label): label is string => typeof label === "string")
      .map((label) => label.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : undefined;
  }

  return undefined;
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
  --timeout, -t <ms>     Timeout for AI agent calls in ms (default: 0 = no timeout)
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

/**
 * Try to load the bundled ralph-tui-prd skill from the agent's skills directory.
 * Returns the skill source if found, undefined otherwise.
 */
export async function loadBundledPrdSkill(
  agent: AgentPlugin,
): Promise<string | undefined> {
  const skillsPaths = agent.meta.skillsPaths;
  if (!skillsPaths) return undefined;

  if (skillsPaths.personal) {
    const personalPath = skillsPaths.personal.replace(/^~/, process.env.HOME || "");
    const skillFile = join(personalPath, "ralph-tui-prd", "SKILL.md");
    try {
      await access(skillFile, constants.R_OK);
      const content = await readFile(skillFile, "utf-8");
      if (content.trim()) {
        return content;
      }
    } catch {
      // Not found in personal, try repo.
    }
  }

  if (skillsPaths.repo) {
    const skillFile = join(
      process.cwd(),
      skillsPaths.repo,
      "ralph-tui-prd",
      "SKILL.md",
    );
    try {
      await access(skillFile, constants.R_OK);
      const content = await readFile(skillFile, "utf-8");
      if (content.trim()) {
        return content;
      }
    } catch {
      // Not found.
    }
  }

  return undefined;
}
