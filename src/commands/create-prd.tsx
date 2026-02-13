/**
 * ABOUTME: Create-PRD command for ralph-tui.
 * Uses AI-powered conversation to create Product Requirements Documents.
 * After PRD generation, shows split view with PRD preview and tracker options.
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { PrdChatApp } from "../tui/components/PrdChatApp.js";
import type { PrdCreationResult } from "../tui/components/PrdChatApp.js";
import { loadStoredConfig, requireSetup } from "../config/index.js";
import { getAgentRegistry } from "../plugins/agents/registry.js";
import { registerBuiltinAgents } from "../plugins/agents/builtin/index.js";
import type {
  AgentPlugin,
  AgentPluginConfig,
} from "../plugins/agents/types.js";
import {
  loadBundledPrdSkill,
  parseCreatePrdArgs,
  parseTrackerLabels,
  printCreatePrdHelp,
  type CreatePrdArgs,
} from "./create-prd-utils.js";
import { executeRunCommand } from "./run.js";
import { performExitCleanup } from "../tui/utils/exit-cleanup.js";
import { getEnvExclusionReport, formatEnvExclusionReport } from '../plugins/agents/base.js';

export {
  loadBundledPrdSkill,
  parseCreatePrdArgs,
  parseTrackerLabels,
  printCreatePrdHelp,
};
export type { CreatePrdArgs };

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

  const skillFile = join(skillPath, "SKILL.md");

  try {
    await access(skillFile, constants.R_OK);
  } catch {
    console.error(
      `Error: PRD skill '${prdSkill}' is missing SKILL.md in ${skillPath}.`,
    );
    process.exit(1);
  }

  try {
    const skillSource = await readFile(skillFile, "utf-8");
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
      agentName || storedConfig.agent || storedConfig.defaultAgent || "claude";

    // Build agent config
    const agentConfig: AgentPluginConfig = {
      name: targetAgent,
      plugin: targetAgent,
      options: storedConfig.agentOptions || {},
      command: storedConfig.command,
      envExclude: storedConfig.envExclude,
      envPassthrough: storedConfig.envPassthrough,
    };

    // Get agent instance
    const agent = await registry.getInstance(agentConfig);

    // Check if agent is ready
    const isReady = await agent.isReady();
    if (!isReady) {
      const detection = await agent.detect();
      if (!detection.available) {
        console.error(
          `Agent '${targetAgent}' is not available: ${detection.error || "not detected"}`,
        );
        return null;
      }
    }

    return agent;
  } catch (error) {
    console.error(
      "Failed to load agent:",
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
    console.error("");
    console.error("Chat mode requires an AI agent. Options:");
    console.error('  1. Run "ralph-tui setup" to configure an agent');
    console.error(
      '  2. Use "--agent claude" or "--agent opencode" to specify one',
    );
    process.exit(1);
  }

  const cwd = parsedArgs.cwd || process.cwd();
  const outputDir = parsedArgs.output || "tasks";
  const timeout = parsedArgs.timeout ?? 0;

  console.log(`Using agent: ${agent.meta.name}`);

  // Show environment variable exclusion report upfront
  const storedConfig = await loadStoredConfig(cwd);
  const envReport = getEnvExclusionReport(
    process.env,
    storedConfig.envPassthrough,
    storedConfig.envExclude
  );
  const envLines = formatEnvExclusionReport(envReport);
  for (const line of envLines) {
    console.log(line);
  }

  // Block until Enter so user can read blocked vars before TUI clears screen.
  // Only block when stdin is a TTY (interactive terminal).
  if (envReport.blocked.length > 0 && process.stdin.isTTY) {
    const { createInterface } = await import('node:readline');
    await new Promise<void>(resolve => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('  Press Enter to continue...', () => {
        rl.close();
        resolve();
      });
    });
  }

  // Run preflight check to verify agent can respond before starting conversation
  console.log("Verifying agent configuration...");
  const preflightResult = await agent.preflight({ timeout: 30000 });

  if (!preflightResult.success) {
    console.error("");
    console.error("❌ Agent preflight check failed");
    if (preflightResult.error) {
      console.error(`   ${preflightResult.error}`);
    }
    if (preflightResult.suggestion) {
      console.error("");
      console.error("Suggestions:");
      for (const line of preflightResult.suggestion.split("\n")) {
        console.error(`  ${line}`);
      }
    }
    console.error("");
    console.error('Run "ralph-tui doctor" to diagnose agent issues.');
    process.exit(1);
  }

  console.log("✓ Agent is ready");

  // Auto-load bundled skill if no custom skill specified
  if (!parsedArgs.prdSkillSource) {
    const bundledSkill = await loadBundledPrdSkill(agent);
    if (bundledSkill) {
      parsedArgs.prdSkillSource = bundledSkill;
      console.log("✓ Loaded ralph-tui-prd skill");
    }
  }

  console.log("");

  // Create renderer and render the chat app
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C in the app
  });

  const root = createRoot(renderer);

  return new Promise<PrdCreationResult | null>((resolvePromise) => {
    const handleComplete = async (result: PrdCreationResult) => {
      root.unmount();
      renderer.destroy();

      // Clean up any attached images from this session
      try {
        await performExitCleanup({ cwd });
      } catch (err) {
        // Don't let cleanup errors prevent normal exit
        console.error(
          "Warning: Image cleanup failed:",
          err instanceof Error ? err.message : String(err),
        );
      }

      console.log("");
      console.log(`PRD workflow complete: ${result.prdPath}`);
      resolvePromise(result);
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
          "Warning: Image cleanup failed:",
          err instanceof Error ? err.message : String(err),
        );
      }

      console.log("");
      console.log("PRD creation cancelled.");
      resolvePromise(null);
    };

    const handleError = (error: string) => {
      console.error("Error:", error);
    };

    root.render(
      <PrdChatApp
        agent={agent}
        cwd={cwd}
        outputDir={outputDir}
        timeout={timeout}
        prdSkill={parsedArgs.prdSkill}
        prdSkillSource={parsedArgs.prdSkillSource}
        trackerLabels={parsedArgs.trackerLabels}
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
  await requireSetup(cwd, "ralph-tui prime");

  const storedConfig = await loadStoredConfig(cwd);

  parsedArgs.trackerLabels = parseTrackerLabels(storedConfig.trackerOptions);

  if (parsedArgs.prdSkill) {
    if (!storedConfig.skills_dir?.trim()) {
      console.error(
        "Error: --prd-skill requires skills_dir to be set in config.",
      );
      console.error(
        "Set skills_dir in ~/.config/ralph-tui/config.toml or .ralph-tui/config.toml.",
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
    console.log("");
    console.log("Launching Ralph TUI with your new tasks...");
    console.log("");

    const runArgs: string[] = [];

    if (result.selectedTracker === "json") {
      // JSON tracker: pass the prd.json path (skill creates it in tasks/ alongside PRD markdown)
      runArgs.push("--prd", "./tasks/prd.json");
    }
    // For beads: no args needed, epic selection will show

    // Execute run command (this will show the TUI)
    await executeRunCommand(runArgs);
    // Note: executeRunCommand handles process.exit internally
  }

  process.exit(0);
}
