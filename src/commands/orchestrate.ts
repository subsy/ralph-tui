/**
 * ABOUTME: Orchestrate command for ralph-tui CLI.
 * Coordinates multi-agent parallel execution of PRD tasks.
 */

import { Orchestrator, type OrchestratorConfig, type OrchestratorEvent } from '../orchestrator/index.js';
import { createStructuredLogger } from '../logs/index.js';
import { runRemoteOrchestration } from './remote-orchestrate.js';

interface OrchestrateOptions {
  prdPath?: string;
  maxWorkers?: number;
  headless: boolean;
  cwd: string;
  remote?: string;
}

/**
 * Parse CLI arguments for the orchestrate command
 */
export function parseOrchestrateArgs(args: string[]): OrchestrateOptions {
  const options: OrchestrateOptions = {
    headless: false,
    cwd: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--prd':
        if (nextArg && !nextArg.startsWith('-')) {
          options.prdPath = nextArg;
          i++;
        }
        break;

      case '--max-workers':
        if (nextArg && !nextArg.startsWith('-')) {
          const parsed = parseInt(nextArg, 10);
          if (!isNaN(parsed) && parsed > 0) {
            options.maxWorkers = parsed;
          }
          i++;
        }
        break;

      case '--headless':
      case '--no-tui':
        options.headless = true;
        break;

      case '--cwd':
        if (nextArg && !nextArg.startsWith('-')) {
          options.cwd = nextArg;
          i++;
        }
        break;

      case '--remote':
        if (nextArg && !nextArg.startsWith('-')) {
          options.remote = nextArg;
          i++;
        }
        break;
    }
  }

  return options;
}

/**
 * Print orchestrate command help
 */
export function printOrchestrateHelp(): void {
  console.log(`
ralph-tui orchestrate - Run parallel multi-agent orchestration

Usage: ralph-tui orchestrate [options]

Options:
  --prd <path>          PRD file path (required)
  --max-workers <n>     Limit parallel workers (default: unlimited)
  --headless            Run without TUI, output structured logs
  --cwd <path>          Working directory (default: current)
  --remote <alias>      Run orchestration on a remote instance
  -h, --help            Show this help message

Exit Codes:
  0    All tasks completed successfully
  1    Some tasks failed or orchestration was interrupted

Description:
  Orchestrate analyzes the PRD, detects dependencies between stories,
  and runs multiple ralph-tui workers in parallel as soon as their
  dependencies complete.

Examples:
  ralph-tui orchestrate --prd ./prd.json
  ralph-tui orchestrate --prd ./prd.json --max-workers 4
  ralph-tui orchestrate --prd ./prd.json --headless
  ralph-tui orchestrate --prd ./prd.json --remote my-server
`);
}

/**
 * Create structured logger for headless orchestration output
 */
function createOrchestratorLogger(): {
  workerStarted: (id: string, taskId: string) => void;
  workerProgress: (id: string, progress: number, taskId?: string) => void;
  workerCompleted: (id: string) => void;
  workerFailed: (id: string, error: string) => void;
  orchestrationCompleted: (total: number, completed: number) => void;
  info: (msg: string) => void;
  error: (msg: string) => void;
} {
  const baseLogger = createStructuredLogger();

  return {
    workerStarted: (id, taskId) => {
      baseLogger.info('agent', `Worker ${id} started: ${taskId}`);
    },
    workerProgress: (id, progress, taskId) => {
      const taskInfo = taskId ? ` (${taskId})` : '';
      baseLogger.info('agent', `Worker ${id}: ${progress}%${taskInfo}`);
    },
    workerCompleted: (id) => {
      baseLogger.info('agent', `Worker ${id} completed`);
    },
    workerFailed: (id, error) => {
      baseLogger.error('agent', `Worker ${id} failed: ${error}`);
    },
    orchestrationCompleted: (total, completed) => {
      baseLogger.info('engine', `Orchestration complete: ${completed}/${total} tasks`);
    },
    info: (msg) => baseLogger.info('engine', msg),
    error: (msg) => baseLogger.error('engine', msg),
  };
}

/**
 * Execute the orchestrate command
 */
export async function executeOrchestrateCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printOrchestrateHelp();
    return;
  }

  const options = parseOrchestrateArgs(args);

  if (!options.prdPath) {
    console.error('Error: --prd <path> is required');
    console.error('Run "ralph-tui orchestrate --help" for usage');
    process.exit(1);
  }

  // Handle remote orchestration
  if (options.remote) {
    await runRemoteOrchestration(options.remote, options.prdPath, options.maxWorkers, options.headless);
    return;
  }

  const config: OrchestratorConfig = {
    prdPath: options.prdPath,
    maxWorkers: options.maxWorkers,
    headless: options.headless,
    cwd: options.cwd,
  };

  const orchestrator = new Orchestrator(config);

  if (options.headless) {
    await runHeadless(orchestrator, config);
  } else {
    await runWithProgress(orchestrator, config);
  }
}

async function runHeadless(orchestrator: Orchestrator, config: OrchestratorConfig): Promise<void> {
  const logger = createOrchestratorLogger();

  logger.info(`Starting orchestration: ${config.prdPath}`);
  logger.info(`Max workers: ${config.maxWorkers ?? 'unlimited'}`);

  subscribeToEvents(orchestrator, logger);

  try {
    const result = await orchestrator.run();
    logger.orchestrationCompleted(result.completed + result.failed, result.completed);

    if (result.failed > 0) {
      logger.error(`${result.failed} worker(s) failed`);
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runWithProgress(orchestrator: Orchestrator, config: OrchestratorConfig): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    Ralph TUI Orchestrator                      ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  PRD:           ${config.prdPath}`);
  console.log(`  Max Workers:   ${config.maxWorkers ?? 'unlimited'}`);
  console.log(`  Working Dir:   ${config.cwd}`);
  console.log('');

  subscribeToConsoleEvents(orchestrator);

  try {
    const result = await orchestrator.run();

    console.log('');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  Orchestration complete`);
    console.log(`  Completed: ${result.completed}`);
    console.log(`  Failed: ${result.failed}`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');

    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('');
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function subscribeToEvents(
  orchestrator: Orchestrator,
  logger: ReturnType<typeof createOrchestratorLogger>
): void {
  orchestrator.on('worker:started', (event: OrchestratorEvent) => {
    if (event.type === 'worker:started') {
      logger.workerStarted(event.workerId, event.taskId);
    }
  });

  orchestrator.on('worker:progress', (event: OrchestratorEvent) => {
    if (event.type === 'worker:progress') {
      logger.workerProgress(event.workerId, event.progress, event.taskId);
    }
  });

  orchestrator.on('worker:completed', (event: OrchestratorEvent) => {
    if (event.type === 'worker:completed') {
      logger.workerCompleted(event.workerId);
    }
  });

  orchestrator.on('worker:failed', (event: OrchestratorEvent) => {
    if (event.type === 'worker:failed') {
      logger.workerFailed(event.workerId, event.error);
    }
  });
}

function subscribeToConsoleEvents(orchestrator: Orchestrator): void {
  orchestrator.on('worker:started', (event: OrchestratorEvent) => {
    if (event.type === 'worker:started') {
      console.log(`  ↳ Worker ${event.workerId}: ${event.taskId}`);
    }
  });

  orchestrator.on('worker:completed', (event: OrchestratorEvent) => {
    if (event.type === 'worker:completed') {
      console.log(`  ✓ Worker ${event.workerId} done`);
    }
  });

  orchestrator.on('worker:failed', (event: OrchestratorEvent) => {
    if (event.type === 'worker:failed') {
      console.log(`  ✗ Worker ${event.workerId} failed: ${event.error}`);
    }
  });
}
