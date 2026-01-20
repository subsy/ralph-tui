/**
 * ABOUTME: Remote orchestration client for ralph-tui CLI.
 * Connects to a remote instance and runs orchestration, displaying events locally.
 */

import { getRemote } from '../remote/config.js';
import { RemoteOrchestratorClient } from './remote-orchestrator-client.js';
import { createStructuredLogger } from '../logs/index.js';

/**
 * Run orchestration on a remote instance.
 * Connects to the remote, sends orchestrate:start, and displays events locally.
 */
export async function runRemoteOrchestration(
  alias: string,
  prdPath: string,
  maxWorkers: number,
  headless: boolean
): Promise<void> {
  const remote = await getRemote(alias);
  if (!remote) {
    console.error(`Error: Remote '${alias}' not found`);
    console.error('Run "ralph-tui remote list" to see configured remotes');
    process.exit(1);
  }

  const logger = headless ? createStructuredLogger() : null;
  const log = (msg: string): void => {
    if (logger) {
      logger.info('engine', msg);
    } else {
      console.log(msg);
    }
  };

  log(`Connecting to remote '${alias}' at ${remote.host}:${remote.port}...`);

  const client = new RemoteOrchestratorClient(remote.host, remote.port, remote.token, headless);

  try {
    await client.connect();
    log('Connected. Starting orchestration...');

    const result = await client.runOrchestration(prdPath, maxWorkers);

    if (result.success) {
      log(`Orchestration complete: ${result.completedTasks}/${result.totalTasks} tasks`);
      process.exit(result.failed > 0 ? 1 : 0);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  } finally {
    client.disconnect();
  }
}
