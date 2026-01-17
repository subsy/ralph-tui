/**
 * ABOUTME: Type definitions for the interactive setup wizard.
 * Defines the structure for setup questions, answers, and wizard state.
 */

import type { SetupQuestion } from '../plugins/trackers/types.js';
import type { AgentSetupQuestion } from '../plugins/agents/types.js';

/**
 * Union type for all setup question types
 */
export type AnySetupQuestion = SetupQuestion | AgentSetupQuestion;

/**
 * Setup wizard state
 */
export interface SetupWizardState {
  /** Current step in the wizard (0-indexed) */
  currentStep: number;

  /** Total number of steps */
  totalSteps: number;

  /** Collected answers so far */
  answers: SetupAnswers;

  /** Whether the wizard is complete */
  complete: boolean;

  /** Error message if setup failed */
  error?: string;
}

/**
 * All answers collected during setup
 */
export interface SetupAnswers {
  /** Selected tracker plugin ID */
  tracker: string;

  /** Tracker-specific options */
  trackerOptions: Record<string, unknown>;

  /** Selected agent plugin ID */
  agent: string;

  /** Agent-specific options */
  agentOptions: Record<string, unknown>;

  /** Skills directory path */
  skillsDir: string;

  /** Maximum iterations per run (0 = unlimited) */
  maxIterations: number;

  /** Whether to auto-commit on task completion */
  autoCommit: boolean;
}

/**
 * Result of running the setup wizard
 */
export interface SetupResult {
  /** Whether setup completed successfully */
  success: boolean;

  /** The collected answers if successful */
  answers?: SetupAnswers;

  /** Path to the saved config file */
  configPath?: string;

  /** Error message if setup failed */
  error?: string;

  /** Whether setup was cancelled by user */
  cancelled?: boolean;
}

/**
 * Options for running the setup wizard
 */
export interface SetupOptions {
  /** Working directory (default: process.cwd()) */
  cwd?: string;

  /** Whether to overwrite existing config */
  force?: boolean;

  /** Skip interactive prompts and use defaults */
  useDefaults?: boolean;
}

/**
 * Plugin detection result for setup
 */
export interface PluginDetection {
  /** Plugin ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description */
  description: string;

  /** Whether the plugin is available/detected */
  available: boolean;

  /** Version if detected */
  version?: string;

  /** Detection error if not available */
  error?: string;
}
