/**
 * ABOUTME: Terminal prompts for interactive setup wizard.
 * Uses Node.js readline for cross-platform terminal input.
 * Provides styled prompts for text, select, boolean, and path inputs.
 */

import * as readline from 'node:readline';
import type { AnySetupQuestion } from './types.js';

/**
 * ANSI color codes for styled output
 */
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
} as const;

/**
 * Format a prompt message with styling
 */
function formatPrompt(prompt: string, required: boolean): string {
  const req = required ? `${colors.yellow}*${colors.reset}` : '';
  return `${colors.cyan}?${colors.reset} ${colors.bold}${prompt}${colors.reset}${req} `;
}

/**
 * Format help text
 */
function formatHelp(help?: string): string {
  if (!help) return '';
  return `  ${colors.dim}${help}${colors.reset}\n`;
}

/**
 * Check if we're running in an interactive terminal environment
 */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Strip mouse tracking and other escape codes from input string
 */
export function stripEscapeCodes(input: string): string {
  // Step 1: Remove ALL mouse tracking patterns first (before they get fragmented)
  // Pattern: sequences like 35;106;28M (requires semicolon to avoid false positives like "10m")
  // This catches: 35;106;28M, 100;200M, etc. but NOT "10m"
  let cleaned = input.replace(/\d+;\d+(?:;\d+)*[Mm]/g, '');

  // Step 2: Remove escape sequences
  // Use RegExp constructor to avoid Biome linter errors with control characters
  const csiPattern = new RegExp('\x1b\\[[0-9;?]*[a-zA-Z]', 'g');
  cleaned = cleaned.replace(csiPattern, '');

  const oscPattern = new RegExp('\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)', 'g');
  cleaned = cleaned.replace(oscPattern, '');

  // Step 3: Remove any control characters (except space, tab, newline)
  const controlCharsPattern = new RegExp('[\x00-\x1F\x7F]', 'g');
  cleaned = cleaned.replace(controlCharsPattern, (char) => {
    // Keep space (0x20 is already outside this range)
    // Keep tab (0x09) and newline (0x0A)
    if (char === '\t' || char === '\n') return char;
    return '';
  });

  // Step 4: Clean up any resulting multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  return cleaned;
}

/**
 * Disable mouse tracking in terminal to prevent escape codes from polluting input
 */
export function disableMouseTracking(): void {
  if (process.stdout.isTTY) {
    // Disable various mouse tracking modes
    process.stdout.write('\x1b[?1000l'); // X10 mouse reporting
    process.stdout.write('\x1b[?1002l'); // Button event tracking
    process.stdout.write('\x1b[?1003l'); // Any event tracking
    process.stdout.write('\x1b[?1006l'); // SGR extended reporting
    process.stdout.write('\x1b[?1015l'); // urxvt extended reporting
  }
}

/**
 * Create a readline interface for prompting
 */
function createReadline(): readline.Interface {
  // Disable mouse tracking to prevent escape codes in input
  disableMouseTracking();

  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });
}

/**
 * Prompt for a text input
 */
export async function promptText(
  prompt: string,
  options: {
    default?: string;
    required?: boolean;
    pattern?: string;
    help?: string;
  } = {}
): Promise<string> {
  const rl = createReadline();
  const defaultStr = options.default ? ` ${colors.dim}(${options.default})${colors.reset}` : '';

  return new Promise((resolve) => {
    if (options.help) {
      console.log(formatHelp(options.help));
    }

    rl.question(formatPrompt(prompt, options.required ?? false) + defaultStr + ' ', (answer) => {
      rl.close();

      // Strip any escape codes that slipped through (fallback for mouse tracking)
      const cleanedAnswer = stripEscapeCodes(answer);
      const value = cleanedAnswer.trim() || options.default || '';

      // Validate pattern if provided
      if (options.pattern && value) {
        const regex = new RegExp(options.pattern);
        if (!regex.test(value)) {
          console.log(`${colors.yellow}Invalid format. Please try again.${colors.reset}`);
          resolve(promptText(prompt, options));
          return;
        }
      }

      // Check required
      if (options.required && !value) {
        console.log(`${colors.yellow}This field is required.${colors.reset}`);
        resolve(promptText(prompt, options));
        return;
      }

      resolve(value);
    });
  });
}

/**
 * Prompt for a boolean (yes/no) input
 */
export async function promptBoolean(
  prompt: string,
  options: {
    default?: boolean;
    help?: string;
  } = {}
): Promise<boolean> {
  const rl = createReadline();
  const defaultStr = options.default !== undefined
    ? ` ${colors.dim}(${options.default ? 'Y/n' : 'y/N'})${colors.reset}`
    : ` ${colors.dim}(y/n)${colors.reset}`;

  return new Promise((resolve) => {
    if (options.help) {
      console.log(formatHelp(options.help));
    }

    rl.question(formatPrompt(prompt, false) + defaultStr + ' ', (answer) => {
      rl.close();

      // Strip escape codes from input
      const cleanedAnswer = stripEscapeCodes(answer);
      const value = cleanedAnswer.trim().toLowerCase();

      if (!value && options.default !== undefined) {
        resolve(options.default);
        return;
      }

      if (value === 'y' || value === 'yes') {
        resolve(true);
        return;
      }

      if (value === 'n' || value === 'no') {
        resolve(false);
        return;
      }

      // Invalid input, try again
      console.log(`${colors.yellow}Please enter 'y' or 'n'.${colors.reset}`);
      resolve(promptBoolean(prompt, options));
    });
  });
}

/**
 * Prompt for selecting from a list of options
 */
export async function promptSelect<T extends string = string>(
  prompt: string,
  choices: Array<{ value: T; label: string; description?: string }>,
  options: {
    default?: T;
    help?: string;
  } = {}
): Promise<T> {
  const rl = createReadline();

  return new Promise((resolve) => {
    if (options.help) {
      console.log(formatHelp(options.help));
    }

    console.log(formatPrompt(prompt, true));
    console.log();

    // Show numbered choices
    choices.forEach((choice, index) => {
      const isDefault = choice.value === options.default;
      const prefix = isDefault ? `${colors.green}>` : ' ';
      const num = `${colors.cyan}${index + 1}${colors.reset}`;
      const label = isDefault
        ? `${colors.bold}${choice.label}${colors.reset}`
        : choice.label;
      const desc = choice.description
        ? ` ${colors.dim}${choice.description}${colors.reset}`
        : '';

      console.log(`  ${prefix} ${num}) ${label}${desc}`);
    });

    console.log();
    const defaultHint = options.default
      ? ` ${colors.dim}(default: ${choices.find(c => c.value === options.default)?.label})${colors.reset}`
      : '';

    rl.question(`  Enter number (1-${choices.length})${defaultHint}: `, (answer) => {
      rl.close();

      // Strip escape codes from input
      const cleanedAnswer = stripEscapeCodes(answer);
      const value = cleanedAnswer.trim();

      // Use default if no input
      if (!value && options.default) {
        resolve(options.default);
        return;
      }

      // Parse number
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > choices.length) {
        console.log(`${colors.yellow}Please enter a number between 1 and ${choices.length}.${colors.reset}`);
        resolve(promptSelect(prompt, choices, options));
        return;
      }

      resolve(choices[num - 1]!.value);
    });
  });
}

/**
 * Prompt for a path input (with validation)
 */
export async function promptPath(
  prompt: string,
  options: {
    default?: string;
    required?: boolean;
    help?: string;
  } = {}
): Promise<string> {
  // Path input is essentially text input with different semantics
  return promptText(prompt, {
    ...options,
    help: options.help || 'Enter a file or directory path',
  });
}

/**
 * Prompt for a number input
 */
export async function promptNumber(
  prompt: string,
  options: {
    default?: number;
    min?: number;
    max?: number;
    required?: boolean;
    help?: string;
  } = {}
): Promise<number> {
  const rl = createReadline();
  const defaultStr = options.default !== undefined
    ? ` ${colors.dim}(${options.default})${colors.reset}`
    : '';

  return new Promise((resolve) => {
    if (options.help) {
      console.log(formatHelp(options.help));
    }

    rl.question(formatPrompt(prompt, options.required ?? false) + defaultStr + ' ', (answer) => {
      rl.close();

      // Strip escape codes from input
      const cleanedAnswer = stripEscapeCodes(answer);
      const value = cleanedAnswer.trim();

      // Use default if no input
      if (!value && options.default !== undefined) {
        resolve(options.default);
        return;
      }

      // Parse number
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        console.log(`${colors.yellow}Please enter a valid number.${colors.reset}`);
        resolve(promptNumber(prompt, options));
        return;
      }

      // Validate range
      if (options.min !== undefined && num < options.min) {
        console.log(`${colors.yellow}Value must be at least ${options.min}.${colors.reset}`);
        resolve(promptNumber(prompt, options));
        return;
      }

      if (options.max !== undefined && num > options.max) {
        console.log(`${colors.yellow}Value must be at most ${options.max}.${colors.reset}`);
        resolve(promptNumber(prompt, options));
        return;
      }

      resolve(num);
    });
  });
}

/**
 * Prompt based on a question definition
 */
export async function promptQuestion(question: AnySetupQuestion): Promise<unknown> {
  switch (question.type) {
    case 'text':
    case 'password':
      return promptText(question.prompt, {
        default: typeof question.default === 'string' ? question.default : undefined,
        required: question.required,
        pattern: question.pattern,
        help: question.help,
      });

    case 'boolean':
      return promptBoolean(question.prompt, {
        default: typeof question.default === 'boolean' ? question.default : undefined,
        help: question.help,
      });

    case 'select':
      if (!question.choices || question.choices.length === 0) {
        throw new Error(`Select question '${question.id}' has no choices`);
      }
      return promptSelect(question.prompt, question.choices, {
        default: typeof question.default === 'string' ? question.default : undefined,
        help: question.help,
      });

    case 'multiselect':
      // For multiselect, use select for now (single choice)
      // Full multiselect would require more complex UI
      if (!question.choices || question.choices.length === 0) {
        throw new Error(`Multiselect question '${question.id}' has no choices`);
      }
      const selected = await promptSelect(question.prompt, question.choices, {
        default: Array.isArray(question.default) ? question.default[0] : undefined,
        help: question.help,
      });
      return [selected];

    case 'path':
      return promptPath(question.prompt, {
        default: typeof question.default === 'string' ? question.default : undefined,
        required: question.required,
        help: question.help,
      });

    default: {
      // Fallback to text for unknown types
      // Use type assertion to handle exhaustive checks
      const unknownQuestion = question as AnySetupQuestion;
      return promptText(unknownQuestion.prompt, {
        required: unknownQuestion.required,
        help: unknownQuestion.help,
      });
    }
  }
}

/**
 * Print a section header
 */
export function printSection(title: string): void {
  console.log();
  console.log(`${colors.magenta}━━━ ${colors.bold}${title}${colors.reset}${colors.magenta} ${'━'.repeat(50 - title.length)}${colors.reset}`);
  console.log();
}

/**
 * Print a success message
 */
export function printSuccess(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

/**
 * Print an error message
 */
export function printError(message: string): void {
  console.log(`${colors.yellow}✗${colors.reset} ${message}`);
}

/**
 * Print an info message
 */
export function printInfo(message: string): void {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}
