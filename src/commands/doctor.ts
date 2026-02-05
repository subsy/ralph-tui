/**
 * ABOUTME: Doctor command for ralph-tui.
 * Runs diagnostics on the configured agent to verify it's fully operational.
 * Helps users identify and fix configuration issues before starting work.
 */

import { loadStoredConfig, getDefaultAgentConfig } from '../config/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type { AgentPlugin, AgentPreflightResult, AgentDetectResult } from '../plugins/agents/types.js';
import { getEnvExclusionReport, formatEnvExclusionReport, type EnvExclusionReport } from '../plugins/agents/base.js';

/**
 * Result of the doctor command diagnostics
 */
export interface DoctorResult {
  /** Overall health status */
  healthy: boolean;

  /** Agent being checked */
  agent: {
    name: string;
    plugin: string;
  };

  /** Detection result */
  detection: AgentDetectResult;

  /** Preflight result (only if detection passed) */
  preflight?: AgentPreflightResult;

  /** Environment variable exclusion report */
  envExclusion?: EnvExclusionReport;

  /** Summary message */
  message: string;
}

/**
 * Run diagnostics on the configured agent
 */
async function runDiagnostics(
  cwd: string,
  agentOverride?: string,
  quiet = false
): Promise<DoctorResult> {
  const log = quiet ? () => {} : console.log.bind(console);
  // Load configuration
  const storedConfig = await loadStoredConfig(cwd);

  // Register built-in agents
  registerBuiltinAgents();

  // Get agent registry
  const registry = getAgentRegistry();

  // Determine which agent to check using centralized logic
  const agentConfig = getDefaultAgentConfig(storedConfig, { agent: agentOverride });

  if (!agentConfig) {
    return {
      healthy: false,
      agent: { name: agentOverride ?? 'unknown', plugin: agentOverride ?? 'unknown' },
      detection: { available: false, error: 'No agent configured or available' },
      message: 'No agent plugin configured or available',
    };
  }

  // Check if agent plugin exists
  if (!registry.hasPlugin(agentConfig.plugin)) {
    return {
      healthy: false,
      agent: { name: agentConfig.name, plugin: agentConfig.plugin },
      detection: { available: false, error: `Unknown agent plugin: ${agentConfig.plugin}` },
      message: `Agent plugin '${agentConfig.plugin}' is not registered`,
    };
  }

  // Get agent instance with full config (including command, envExclude, etc.)
  let agent: AgentPlugin;
  try {
    agent = await registry.getInstance(agentConfig);
  } catch (error) {
    return {
      healthy: false,
      agent: { name: agentConfig.name, plugin: agentConfig.plugin },
      detection: { available: false, error: error instanceof Error ? error.message : String(error) },
      message: `Failed to initialize agent '${agentConfig.name}'`,
    };
  }

  // Collect environment variable exclusion info (displayed in printHumanResult)
  // Use agent config's env settings (which already include top-level shorthands if not overridden)
  const envExclusion = getEnvExclusionReport(
    process.env,
    agentConfig.envPassthrough,
    agentConfig.envExclude
  );

  // Run detection
  log(`\n🔍 Checking ${agent.meta.name}...\n`);
  log('  Step 1: Detection (checking if CLI is available)...');

  const detection = await agent.detect();

  if (!detection.available) {
    return {
      healthy: false,
      agent: { name: agent.meta.name, plugin: agent.meta.id },
      detection,
      message: detection.error ?? 'Agent CLI not available',
    };
  }

  log(`    ✓ Found at: ${detection.executablePath}`);
  if (detection.version) {
    log(`    ✓ Version: ${detection.version}`);
  }

  // Run preflight
  log('\n  Step 2: Preflight (testing if agent can respond)...');
  log('    Running test prompt...');

  const preflightTimeoutMs = storedConfig.preflightTimeoutMs ?? 30000;
  const preflight = await agent.preflight({ timeout: preflightTimeoutMs });

  if (!preflight.success) {
    return {
      healthy: false,
      agent: { name: agent.meta.name, plugin: agent.meta.id },
      detection,
      preflight,
      message: preflight.error ?? 'Agent failed preflight check',
    };
  }

  log(`    ✓ Agent responded successfully (${preflight.durationMs}ms)`);

  return {
    healthy: true,
    agent: { name: agent.meta.name, plugin: agent.meta.id },
    detection,
    preflight,
    envExclusion,
    message: 'Agent is healthy and ready to use',
  };
}

/**
 * Print doctor results in human-readable format
 */
function printHumanResult(result: DoctorResult, verbose = false): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    Ralph TUI Doctor Report                     ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Status
  const statusIcon = result.healthy ? '✓' : '✗';
  const statusText = result.healthy ? 'HEALTHY' : 'UNHEALTHY';
  console.log(`  Status:    ${statusIcon} ${statusText}`);
  console.log(`  Agent:     ${result.agent.name} (${result.agent.plugin})`);
  console.log('');

  // Detection details
  console.log('  Detection:');
  if (result.detection.available) {
    console.log(`    ✓ CLI available`);
    if (result.detection.executablePath) {
      console.log(`    ✓ Path: ${result.detection.executablePath}`);
    }
    if (result.detection.version) {
      console.log(`    ✓ Version: ${result.detection.version}`);
    }
  } else {
    console.log(`    ✗ CLI not available`);
    if (result.detection.error) {
      console.log(`    ✗ Error: ${result.detection.error}`);
    }
  }
  console.log('');

  // Preflight details
  if (result.preflight) {
    console.log('  Preflight:');
    if (result.preflight.success) {
      console.log(`    ✓ Agent responded to test prompt`);
      if (result.preflight.durationMs) {
        console.log(`    ✓ Response time: ${result.preflight.durationMs}ms`);
      }
    } else {
      console.log(`    ✗ Agent failed to respond`);
      if (result.preflight.error) {
        console.log(`    ✗ Error: ${result.preflight.error}`);
      }
      // Show exit code if available
      if (result.preflight.exitCode !== undefined) {
        console.log(`    ✗ Exit code: ${result.preflight.exitCode}`);
      }
      if (result.preflight.suggestion) {
        console.log('');
        console.log('  Suggestions:');
        // Split suggestion by newlines and indent each line
        const lines = result.preflight.suggestion.split('\n');
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      }
    }

    // Verbose output: show captured stdout/stderr
    if (verbose && !result.preflight.success) {
      console.log('');
      console.log('  Verbose diagnostics:');
      if (result.preflight.stderr) {
        console.log('    Stderr:');
        const stderrLines = result.preflight.stderr.split('\n');
        for (const line of stderrLines.slice(0, 20)) { // Limit to 20 lines
          console.log(`      ${line}`);
        }
        if (stderrLines.length > 20) {
          console.log(`      ... (${stderrLines.length - 20} more lines)`);
        }
      } else {
        console.log('    Stderr: (empty)');
      }
      if (result.preflight.stdout) {
        console.log('    Stdout:');
        const stdoutLines = result.preflight.stdout.split('\n');
        for (const line of stdoutLines.slice(0, 20)) { // Limit to 20 lines
          console.log(`      ${line}`);
        }
        if (stdoutLines.length > 20) {
          console.log(`      ... (${stdoutLines.length - 20} more lines)`);
        }
      } else {
        console.log('    Stdout: (empty)');
      }
    }
    console.log('');
  }

  // Environment variable exclusion info (always shown)
  if (result.envExclusion) {
    const envLines = formatEnvExclusionReport(result.envExclusion);
    for (const line of envLines) {
      console.log(`  ${line}`);
    }
    console.log('');
  }

  // Summary
  console.log('───────────────────────────────────────────────────────────────');
  if (result.healthy) {
    console.log('  ✓ Your agent is configured correctly and ready to use.');
    console.log('');
    console.log('  Start working: ralph-tui run');
  } else {
    console.log(`  ✗ ${result.message}`);
    console.log('');
    console.log('  Please fix the issues above and run: ralph-tui doctor');
    if (!verbose) {
      console.log('');
      console.log('  Tip: Run with --verbose for more diagnostic details');
    }
  }
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
}

/**
 * Execute the doctor command
 */
export async function executeDoctorCommand(args: string[]): Promise<void> {
  let cwd = process.cwd();
  let outputJson = false;
  let verbose = false;
  let agentOverride: string | undefined;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[i + 1]!;
      i++;
    } else if (args[i] === '--json') {
      outputJson = true;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--agent' && args[i + 1]) {
      agentOverride = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printDoctorHelp();
      return;
    }
  }

  try {
    const result = await runDiagnostics(cwd, agentOverride, outputJson);

    if (outputJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanResult(result, verbose);
    }

    // Exit with appropriate code
    process.exit(result.healthy ? 0 : 1);
  } catch (error) {
    if (outputJson) {
      console.log(JSON.stringify({
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
    } else {
      console.error('');
      console.error(`✗ Doctor failed: ${error instanceof Error ? error.message : error}`);
      console.error('');
    }
    process.exit(1);
  }
}

/**
 * Print doctor command help
 */
export function printDoctorHelp(): void {
  console.log(`
ralph-tui doctor - Diagnose agent configuration

Usage: ralph-tui doctor [options]

Options:
  --agent <name>    Check specific agent (default: configured agent)
  --json            Output in JSON format
  --verbose, -v     Show detailed diagnostics (stderr/stdout capture)
  --cwd <path>      Working directory (default: current directory)
  -h, --help        Show this help message

Description:
  Runs diagnostics on your configured AI agent to verify it's fully
  operational before you start working. This helps identify common
  configuration issues like:

  - Missing CLI tools
  - Unconfigured API keys
  - Missing default model settings
  - Network connectivity issues

  The doctor command runs two checks:

  1. Detection: Verifies the agent CLI is installed and accessible
  2. Preflight: Sends a test prompt to verify the agent can respond

Exit Codes:
  0    Agent is healthy and ready to use
  1    Agent has configuration issues

Examples:
  ralph-tui doctor                 # Check configured agent
  ralph-tui doctor --agent claude  # Check specific agent
  ralph-tui doctor --json          # JSON output for scripts
  ralph-tui doctor --verbose       # Show detailed error output

Common Issues:
  OpenCode: Configure a default model in ~/.config/opencode/opencode.json
  Claude:   Set ANTHROPIC_API_KEY environment variable
  Droid:    Ensure Factory platform credentials are configured
`);
}
