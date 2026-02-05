/**
 * ABOUTME: Interactive setup wizard for Ralph TUI.
 * Guides users through initial configuration when no .ralph-tui/config.toml exists.
 * Detects available plugins and collects tracker/agent preferences.
 */

import { access, constants, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyToml } from 'smol-toml';
import { getTrackerRegistry } from '../plugins/trackers/registry.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type { StoredConfig } from '../config/types.js';
import type {
  SetupResult,
  SetupOptions,
  SetupAnswers,
  PluginDetection,
} from './types.js';
import {
  promptSelect,
  promptNumber,
  promptBoolean,
  promptQuestion,
  printSection,
  printSuccess,
  printInfo,
  printError,
  isInteractiveTerminal,
} from './prompts.js';
import {
  listBundledSkills,
  isSkillInstalledAt,
  resolveSkillsPath,
  installViaAddSkill,
} from './skill-installer.js';
import { CURRENT_CONFIG_VERSION } from './migration.js';

/**
 * Config directory and filename
 */
const CONFIG_DIR = '.ralph-tui';
const CONFIG_FILENAME = 'config.toml';

/**
 * Check if a project config file exists
 */
export async function projectConfigExists(cwd: string = process.cwd()): Promise<boolean> {
  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILENAME);
  try {
    await access(configPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a human-readable reason for why a tracker is unavailable.
 * Provides specific guidance based on what's missing (directory vs CLI).
 */
export function formatTrackerUnavailableReason(plugin: PluginDetection): string {
  const error = plugin.error ?? '';
  const isBeadsFamily = plugin.id === 'beads' || plugin.id === 'beads-bv' || plugin.id === 'beads-rust';

  if (isBeadsFamily) {
    // Beads directory not found
    if (error.includes('directory not found')) {
      return 'No .beads directory found. Run "bd init" or "br init" to create one.';
    }

    // CLI binary not available
    if (error.includes('binary not available') || error.includes('not available')) {
      const cli = plugin.id === 'beads-rust' ? 'br' : 'bd';
      return `${cli} CLI not found. Install it to use this tracker.`;
    }
  }

  // Generic fallback for non-beads trackers or unrecognized beads errors
  if (error) {
    return error;
  }

  return `${plugin.description} (not detected)`;
}

/**
 * Detect available tracker plugins.
 * For beads-family trackers, checks for .beads directory and CLI availability.
 * For other trackers (json), always marks as available.
 */
async function detectTrackerPlugins(cwd?: string): Promise<PluginDetection[]> {
  const registry = getTrackerRegistry();

  // Register built-in plugins if not already done
  registerBuiltinTrackers();
  await registry.initialize();

  const plugins = registry.getRegisteredPlugins();
  const detections: PluginDetection[] = [];

  for (const meta of plugins) {
    const instance = registry.createInstance(meta.id);
    if (!instance) continue;

    // Check environment availability using detect() if the tracker supports it.
    // Beads-family trackers have detect() which checks .beads dir and CLI presence.
    // Trackers without detect() (like json) have no environmental prerequisites.
    const instanceAsDetectable = instance as unknown as {
      detect?: () => Promise<{ available: boolean; error?: string; bdVersion?: string; brVersion?: string }>;
    };

    let available = true;
    let error: string | undefined;
    let version: string | undefined;

    try {
      if (typeof instanceAsDetectable.detect === 'function') {
        // Initialize with cwd so detect() can access the correct workingDir/beadsDir
        await instance.initialize({ workingDir: cwd });
        const detectResult = await instanceAsDetectable.detect();
        available = detectResult.available;
        if (!available) {
          error = detectResult.error;
          version = detectResult.bdVersion ?? detectResult.brVersion;
        }
      }
    } catch (err) {
      available = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      await instance.dispose();
    }

    detections.push({
      id: meta.id,
      name: meta.name,
      description: meta.description,
      available,
      version: available ? meta.version : version,
      error,
    });
  }

  return detections;
}

/**
 * Detect available agent plugins with CLI availability
 */
async function detectAgentPlugins(): Promise<PluginDetection[]> {
  const registry = getAgentRegistry();

  // Register built-in plugins if not already done
  registerBuiltinAgents();
  await registry.initialize();

  const plugins = registry.getRegisteredPlugins();
  const detections: PluginDetection[] = [];

  for (const meta of plugins) {
    const instance = registry.createInstance(meta.id);
    if (!instance) continue;

    // Initialize with empty config to enable detection
    await instance.initialize({});

    // Detect if CLI is available
    const detectResult = await instance.detect();

    detections.push({
      id: meta.id,
      name: meta.name,
      description: meta.description,
      available: detectResult.available,
      version: detectResult.version,
      error: detectResult.error,
    });

    await instance.dispose();
  }

  return detections;
}

/**
 * Collect tracker-specific options via setup questions
 */
async function collectTrackerOptions(
  trackerId: string
): Promise<Record<string, unknown>> {
  const registry = getTrackerRegistry();
  const instance = registry.createInstance(trackerId);
  if (!instance) {
    return {};
  }

  const questions = instance.getSetupQuestions();
  await instance.dispose();

  if (questions.length === 0) {
    return {};
  }

  printSection('Tracker Configuration');
  printInfo(`Configure the ${trackerId} tracker:`);
  console.log();

  const options: Record<string, unknown> = {};

  for (const question of questions) {
    options[question.id] = await promptQuestion(question);
  }

  return options;
}

/**
 * Save configuration to .ralph-tui/config.toml
 */
async function saveConfig(
  answers: SetupAnswers,
  cwd: string
): Promise<string> {
  const configDir = join(cwd, CONFIG_DIR);
  const configPath = join(configDir, CONFIG_FILENAME);

  // Ensure .ralph-tui directory exists
  await mkdir(configDir, { recursive: true });

  // Build StoredConfig from answers
  const config: StoredConfig = {
    // Config version for future migrations
    configVersion: CURRENT_CONFIG_VERSION,
    // Use shorthand format for simpler config
    tracker: answers.tracker,
    trackerOptions: answers.trackerOptions,
    agent: answers.agent,
    agentOptions: answers.agentOptions,
    ...(answers.reviewEnabled
      ? {
          review: {
            enabled: true,
            agent: answers.reviewAgent,
          },
        }
      : {}),
    maxIterations: answers.maxIterations,
    autoCommit: answers.autoCommit,
  };

  // Serialize to TOML
  const toml = stringifyToml(config);

  // Add header comment
  const content = `# Ralph TUI Configuration
# Generated by setup wizard
# See: ralph-tui config help

${toml}`;

  await writeFile(configPath, content, 'utf-8');

  return configPath;
}

/**
 * Run the interactive setup wizard
 */
export async function runSetupWizard(
  options: SetupOptions = {}
): Promise<SetupResult> {
  const cwd = options.cwd ?? process.cwd();

  try {
    // Check if we're in an interactive terminal
    if (!isInteractiveTerminal()) {
      return {
        success: false,
        error:
          'The setup wizard requires an interactive terminal. ' +
          'Please run this command in a terminal that supports interactive input (TTY). ' +
          'If running in a container or automated environment, consider creating the ' +
          'configuration file manually at .ralph-tui/config.toml',
      };
    }

    // Check if config already exists
    if (!options.force) {
      const exists = await projectConfigExists(cwd);
      if (exists) {
        return {
          success: false,
          error: `Configuration file already exists: ${join(cwd, CONFIG_DIR, CONFIG_FILENAME)}. Use --force to overwrite.`,
        };
      }
    }

    // Print welcome banner
    console.log();
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                   Ralph TUI Setup Wizard                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log();
    printInfo('This wizard will help you configure Ralph TUI for your project.');
    printInfo('Press Ctrl+C at any time to cancel.');

    // === Step 1: Select Tracker ===
    printSection('Issue Tracker Selection');

    const trackerPlugins = await detectTrackerPlugins(cwd);
    if (trackerPlugins.length === 0) {
      return {
        success: false,
        error: 'No tracker plugins available. Please install a tracker plugin.',
      };
    }

    // Build choices with availability info
    const trackerChoices = trackerPlugins.map((p) => ({
      value: p.id,
      label: p.available
        ? p.name
        : `${p.name} (unavailable)`,
      description: p.available
        ? p.description
        : formatTrackerUnavailableReason(p),
    }));

    const selectedTracker = await promptSelect(
      'Which issue tracker do you want to use?',
      trackerChoices,
      {
        default: trackerPlugins.find((p) => p.available)?.id,
        help: 'Ralph will use this tracker to manage tasks.',
      }
    );

    // Show tip for beads-family trackers
    const isBeadsTracker = selectedTracker === 'beads' || selectedTracker === 'beads-bv' || selectedTracker === 'beads-rust';
    if (isBeadsTracker) {
      const selectedPlugin = trackerPlugins.find((p) => p.id === selectedTracker);
      if (selectedPlugin?.available) {
        console.log();
        printInfo('Beads tracker tip: When running Ralph, specify an epic:');
        console.log('  ralph-tui run --epic <epic-id>');
        console.log();
        printInfo('Or omit --epic to get an interactive epic selection list.');
        console.log();
        printInfo('Have a markdown PRD? Convert it to Beads issues:');
        console.log('  ralph-tui convert --to beads --input ./prd.md');
      }
    }

    // Collect tracker-specific options
    const trackerOptions = await collectTrackerOptions(selectedTracker);

    // === Step 2: Select Agent ===
    printSection('Worker Agent Selection');

    const agentPlugins = await detectAgentPlugins();
    if (agentPlugins.length === 0) {
      return {
        success: false,
        error: 'No agent plugins available. Please install an agent plugin.',
      };
    }

    // Build choices with availability info
    const agentChoices = agentPlugins.map((p) => ({
      value: p.id,
      label: `${p.name}${p.available ? ` (v${p.version})` : ''}`,
      description: p.available
        ? p.description
        : `${p.description} (not detected: ${p.error})`,
    }));

    // Find first available agent as default
    const defaultAgent = agentPlugins.find((p) => p.available)?.id;

    printInfo('Ralph supports multiple AI coding agents.');
    if (defaultAgent) {
      printSuccess(`Auto-detected: ${agentPlugins.find((p) => p.id === defaultAgent)?.name}`);
    }
    console.log();

    const selectedAgent = await promptSelect(
      'Which worker agent do you want to use for tasks?',
      agentChoices,
      {
        default: defaultAgent,
        help: 'Worker agent executes coding tasks.',
      }
    );

    // Collect agent-specific options (skip for default setup)
    // For simplicity, we'll skip agent-specific options in the wizard
    // They can be configured later via config file
    const agentOptions: Record<string, unknown> = {};

    // === Step 3: Reviewer Selection ===
    printSection('Reviewer Agent Selection');

    const reviewerChoices = [
      {
        value: 'none',
        label: 'None (disable review)',
        description: 'Skip the reviewer stage after task completion',
      },
      ...agentPlugins.map((p) => ({
        value: p.id,
        label: `${p.name}${p.available ? ` (v${p.version})` : ''}`,
        description: p.available
          ? p.description
          : `${p.description} (not detected: ${p.error})`,
      })),
    ];

    const selectedReviewer = await promptSelect(
      'Which reviewer agent do you want to use?',
      reviewerChoices,
      {
        default: 'none',
        help: 'Reviewer runs after each task. Choose "none" to disable.',
      }
    );

    const reviewEnabled = selectedReviewer !== 'none';
    const reviewAgent = reviewEnabled ? selectedReviewer : undefined;

    // === Step 4: Iteration Settings ===
    printSection('Iteration Settings');

    const maxIterations = await promptNumber(
      'Maximum iterations per run?',
      {
        default: 10,
        min: 0,
        max: 1000,
        help: 'How many tasks to process before stopping (0 = unlimited).',
      }
    );

    const autoCommit = await promptBoolean(
      'Auto-commit on task completion?',
      {
        default: false,
        help: 'Automatically commit changes after each successful task.',
      }
    );

    // === Step 5: Skills Installation ===
    printSection('AI Skills Installation');

    // Get the selected agent's skills paths from the registry
    const agentRegistry = getAgentRegistry();
    const agentMeta = agentRegistry.getPluginMeta(selectedAgent);
    const skillsPaths = agentMeta?.skillsPaths;

    if (!skillsPaths) {
      printInfo(`Agent "${agentMeta?.name ?? selectedAgent}" does not support skill installation.`);
    } else {
      const bundledSkills = await listBundledSkills();

      if (bundledSkills.length > 0) {
        const personalDir = resolveSkillsPath(skillsPaths.personal);
        printInfo('Ralph TUI includes AI skills that enhance agent capabilities.');
        printInfo(`Skills will be installed to: ${personalDir}`);
        console.log();

        for (const skill of bundledSkills) {
          const alreadyInstalled = await isSkillInstalledAt(skill.name, personalDir);
          const actionLabel = alreadyInstalled ? 'Update' : 'Install';

          const installThisSkill = await promptBoolean(
            `${actionLabel} skill: ${skill.name}?`,
            {
              default: true,
              help: alreadyInstalled
                ? `${skill.description} (currently installed - update to latest)`
                : skill.description,
            }
          );

          if (installThisSkill) {
            const result = await installViaAddSkill({
              agentId: selectedAgent,
              skillName: skill.name,
              global: true,
            });

            if (result.success) {
              printSuccess(`  ${alreadyInstalled ? 'Updated' : 'Installed'}: ${skill.name}`);
            } else {
              printError(`  Failed to ${actionLabel.toLowerCase()} ${skill.name}: ${result.output || 'Unknown error'}`);
            }
          } else if (alreadyInstalled) {
            printInfo(`  ${skill.name}: Keeping existing version`);
          }
        }
      } else {
        printInfo('No bundled skills available for installation.');
      }
    }

    // === Save Configuration ===
    const answers: SetupAnswers = {
      tracker: selectedTracker,
      trackerOptions,
      agent: selectedAgent,
      agentOptions,
      reviewEnabled,
      reviewAgent,
      maxIterations,
      autoCommit,
    };

    printSection('Saving Configuration');

    const configPath = await saveConfig(answers, cwd);

    console.log();
    printSuccess(`Configuration saved to: ${configPath}`);
    console.log();

    // === Verify Agent Configuration ===
    printSection('Verifying Agent Configuration');

    printInfo('Running agent preflight check...');
    console.log();

    // Get a fresh agent instance with the configured options
    const agentInstance = await agentRegistry.getInstance({
      name: selectedAgent,
      plugin: selectedAgent,
      options: agentOptions,
    });

    // Run preflight check
    const preflightResult = await agentInstance.preflight({ timeout: 30000 });

    if (preflightResult.success) {
      printSuccess(`✓ Agent is configured correctly and responding`);
      if (preflightResult.durationMs) {
        printInfo(`  Response time: ${preflightResult.durationMs}ms`);
      }
      console.log();
    } else {
      printError(`✗ Agent preflight check failed`);
      if (preflightResult.error) {
        printError(`  ${preflightResult.error}`);
      }
      if (preflightResult.suggestion) {
        console.log();
        printInfo('Suggestions:');
        // Split suggestion by newlines and print each line
        for (const line of preflightResult.suggestion.split('\n')) {
          console.log(`  ${line}`);
        }
      }
      console.log();
      printInfo('Configuration saved, but the agent is not responding.');
      printInfo('Run "ralph-tui doctor" to diagnose issues.');
      console.log();
    }

    // Show tracker-specific instructions
    if (selectedTracker === 'json') {
      printInfo('You can now run Ralph TUI with:');
      console.log();
      console.log('  Create a PRD and tasks:        ralph-tui create-prd');
      console.log('  Run Ralph on existing tasks:   ralph-tui run --prd <path-to-prd.json>');
    } else if (selectedTracker === 'beads' || selectedTracker === 'beads-bv' || selectedTracker === 'beads-rust') {
      printInfo('You can now run Ralph TUI with:');
      console.log();
      console.log('  ralph-tui run                  # Interactive epic selection');
      console.log('  ralph-tui run --epic <id>      # Run with a specific epic');
      console.log();
      printInfo('To create issues from a markdown PRD:');
      console.log();
      console.log('  ralph-tui convert --to beads --input ./prd.md');
    } else {
      printInfo('You can now run Ralph TUI with:');
      console.log();
      console.log('  ralph-tui run');
    }
    console.log();
    printInfo('Or edit the configuration with:');
    console.log();
    console.log('  ralph-tui config show');
    console.log();

    return {
      success: true,
      answers,
      configPath,
    };
  } catch (error) {
    // Check for user cancellation (Ctrl+C)
    if (error instanceof Error && error.message.includes('readline was closed')) {
      console.log();
      printInfo('Setup cancelled.');
      return {
        success: false,
        cancelled: true,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if setup is needed and optionally run the wizard
 */
export async function checkAndRunSetup(
  options: SetupOptions & { skipSetup?: boolean } = {}
): Promise<SetupResult | null> {
  const cwd = options.cwd ?? process.cwd();

  // Check if config exists
  const exists = await projectConfigExists(cwd);

  if (exists) {
    // Config exists, no setup needed
    return null;
  }

  if (options.skipSetup) {
    // User wants to skip setup
    printInfo('No configuration found. Run "ralph-tui setup" to create one.');
    return null;
  }

  // Run the wizard
  return runSetupWizard(options);
}
