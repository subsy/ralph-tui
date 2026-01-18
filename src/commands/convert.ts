/**
 * ABOUTME: Convert command for ralph-tui.
 * Converts PRD markdown files to prd.json or Beads format.
 */

import {
  readFile,
  writeFile,
  access,
  constants,
  mkdir,
} from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import {
  parsePrdMarkdown,
  parsedPrdToGeneratedPrd,
  convertToPrdJson,
} from '../prd/index.js';
import {
  promptText,
  promptBoolean,
  printSection,
  printSuccess,
  printError,
  printInfo,
} from '../setup/prompts.js';
import {
  validatePrdJsonSchema,
  PrdJsonSchemaError,
} from '../plugins/trackers/builtin/json/index.js';

/**
 * Supported conversion target formats.
 */
export type ConvertFormat = 'json' | 'beads';

/**
 * Command-line arguments for the convert command.
 */
export interface ConvertArgs {
  /** Target format */
  to: ConvertFormat;

  /** Input file path */
  input: string;

  /** Output file path (optional, only for json format) */
  output?: string;

  /** Branch name (optional, will prompt if not provided) */
  branch?: string;

  /** Labels to apply (optional, for beads format) */
  labels?: string[];

  /** Skip confirmation prompts */
  force?: boolean;

  /** Show verbose output */
  verbose?: boolean;
}

/**
 * Parse convert command arguments.
 */
export function parseConvertArgs(args: string[]): ConvertArgs | null {
  let to: ConvertFormat | undefined;
  let input: string | undefined;
  let output: string | undefined;
  let branch: string | undefined;
  let labels: string[] | undefined;
  let force = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--to' || arg === '-t') {
      const format = args[++i];
      if (format === 'json' || format === 'beads') {
        to = format;
      } else {
        console.error(`Unsupported format: ${format}`);
        console.log('Supported formats: json, beads');
        return null;
      }
    } else if (arg === '--output' || arg === '-o') {
      output = args[++i];
    } else if (arg === '--branch' || arg === '-b') {
      branch = args[++i];
    } else if (arg === '--labels' || arg === '-l') {
      const labelsStr = args[++i];
      labels = labelsStr
        ? labelsStr
            .split(',')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
        : [];
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printConvertHelp();
      process.exit(0);
    } else if (!arg?.startsWith('-')) {
      // Positional argument is the input file
      input = arg;
    }
  }

  // Validate required arguments
  if (!to) {
    console.error('Error: --to <format> is required');
    console.log('Use --help for usage information');
    return null;
  }

  if (!input) {
    console.error('Error: Input file path is required');
    console.log('Usage: ralph-tui convert --to json ./tasks/prd-feature.md');
    return null;
  }

  return { to, input, output, branch, labels, force, verbose };
}

/**
 * Print help for the convert command.
 */
export function printConvertHelp(): void {
  console.log(`
ralph-tui convert - Convert PRD markdown to JSON or Beads format

Usage: ralph-tui convert --to <format> <input-file> [options]

Arguments:
  <input-file>           Path to the PRD markdown file to convert

Options:
  --to, -t <format>      Target format (required): json, beads
  --output, -o <path>    Output file path (default: ./prd.json, only for json format)
  --branch, -b <name>    Git branch name (prompts if not provided)
  --labels, -l <labels>  Labels to apply (comma-separated, beads format only)
                         Default: "ralph" is always included for beads format
  --force, -f            Overwrite existing files without prompting
  --verbose, -v          Show detailed parsing output
  --help, -h             Show this help message

Description:
  The convert command parses a PRD markdown file and extracts:

  - User stories from ### US-XXX: Title sections
  - Acceptance criteria from checklist items (- [ ] item)
  - Priority from **Priority:** P1-P4 lines
  - Dependencies from **Depends on:** lines

  For JSON format (--to json):
    Creates a prd.json file for use with \`ralph-tui run --prd ./prd.json\`

  For Beads format (--to beads):
    - Creates an epic bead for the feature
    - Creates child beads for each user story
    - Sets up dependencies based on story order or explicit deps
    - Applies the 'ralph' label to all created beads
    - Runs bd sync after creation
    - Displays all created bead IDs

Examples:
  # Convert to JSON format
  ralph-tui convert --to json ./tasks/prd-feature.md
  ralph-tui convert --to json ./docs/requirements.md -o ./custom.json

  # Convert to Beads format
  ralph-tui convert --to beads ./tasks/prd-feature.md
  ralph-tui convert --to beads ./prd.md --labels "frontend,sprint-1"
`);
}

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a bd command and return the output.
 */
async function execBd(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bd', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

/**
 * Result of beads conversion.
 */
interface BeadsConversionResult {
  success: boolean;
  epicId?: string;
  storyIds: string[];
  error?: string;
}

/**
 * Convert PRD to Beads format.
 * Creates an epic bead and child beads for each user story.
 */
async function convertToBeads(
  parsed: import('../prd/parser.js').ParsedPrd,
  labels: string[],
  verbose: boolean,
): Promise<BeadsConversionResult> {
  const storyIds: string[] = [];

  // Ensure 'ralph' label is always included
  const allLabels = ['ralph', ...labels.filter((l) => l !== 'ralph')];
  const labelsStr = allLabels.join(',');

  // Step 1: Create the epic bead
  printInfo('Creating epic bead...');
  const epicArgs = [
    'create',
    '--type',
    'epic',
    '--title',
    parsed.name,
    '--description',
    parsed.description,
    '--labels',
    labelsStr,
    '--priority',
    '1',
    '--silent',
  ];

  if (verbose) {
    console.log(`  bd ${epicArgs.join(' ')}`);
  }

  const epicResult = await execBd(epicArgs);

  if (epicResult.exitCode !== 0) {
    return {
      success: false,
      storyIds: [],
      error: `Failed to create epic: ${epicResult.stderr || epicResult.stdout}`,
    };
  }

  const epicId = epicResult.stdout.trim();
  printSuccess(`Created epic: ${epicId}`);

  // Step 2: Create child beads for each user story
  // Build a map of old story IDs to new bead IDs for dependency mapping
  const storyIdMap: Map<string, string> = new Map();

  printInfo(`Creating ${parsed.userStories.length} story beads...`);

  for (const story of parsed.userStories) {
    // Build description with acceptance criteria
    let description = story.description || story.title;
    if (story.acceptanceCriteria.length > 0) {
      description += '\n\n## Acceptance Criteria\n';
      for (const criterion of story.acceptanceCriteria) {
        description += `- [ ] ${criterion}\n`;
      }
    }

    const storyArgs = [
      'create',
      '--type',
      'task',
      '--title',
      `${story.id}: ${story.title}`,
      '--description',
      description,
      '--labels',
      labelsStr,
      '--priority',
      String(story.priority),
      '--parent',
      epicId,
      '--silent',
    ];

    if (verbose) {
      console.log(`  bd ${storyArgs.join(' ')}`);
    }

    const storyResult = await execBd(storyArgs);

    if (storyResult.exitCode !== 0) {
      printError(
        `Failed to create story ${story.id}: ${storyResult.stderr || storyResult.stdout}`,
      );
      continue;
    }

    const newBeadId = storyResult.stdout.trim();
    storyIds.push(newBeadId);
    storyIdMap.set(story.id, newBeadId);

    if (verbose) {
      printSuccess(`  Created: ${newBeadId} (${story.id}: ${story.title})`);
    }
  }

  // Step 3: Set up dependencies
  printInfo('Setting up dependencies...');
  let depsCreated = 0;

  for (const story of parsed.userStories) {
    const currentBeadId = storyIdMap.get(story.id);
    if (!currentBeadId) continue;

    // Handle explicit dependencies from the PRD
    if (story.dependsOn && story.dependsOn.length > 0) {
      for (const depId of story.dependsOn) {
        const depBeadId = storyIdMap.get(depId);
        if (depBeadId) {
          // bd dep add <blocked-id> <blocker-id>
          // currentBead depends on depBead (depBead blocks currentBead)
          const depArgs = ['dep', 'add', currentBeadId, depBeadId];

          if (verbose) {
            console.log(`  bd ${depArgs.join(' ')}`);
          }

          const depResult = await execBd(depArgs);

          if (depResult.exitCode !== 0) {
            if (verbose) {
              printError(
                `  Failed to create dependency: ${depResult.stderr || depResult.stdout}`,
              );
            }
          } else {
            depsCreated++;
          }
        }
      }
    }
  }

  if (depsCreated > 0) {
    printSuccess(`Created ${depsCreated} dependencies`);
  } else if (
    parsed.userStories.some((s) => s.dependsOn && s.dependsOn.length > 0)
  ) {
    printInfo(
      'No dependencies created (may have been specified but not found)',
    );
  }

  // Step 4: Run bd sync
  printInfo('Running bd sync...');
  const syncResult = await execBd(['sync']);

  if (syncResult.exitCode !== 0) {
    printError(`bd sync failed: ${syncResult.stderr || syncResult.stdout}`);
    // Don't fail the whole operation for a sync failure
  } else {
    printSuccess('Synced beads with git');
  }

  return {
    success: true,
    epicId,
    storyIds,
  };
}

/**
 * Execute the convert command.
 */
export async function executeConvertCommand(args: string[]): Promise<void> {
  const parsedArgs = parseConvertArgs(args);

  if (!parsedArgs) {
    process.exit(1);
  }

  const { to, input, output, branch, labels, force, verbose } = parsedArgs;

  // Resolve input path
  const inputPath = resolve(input);

  // Check input file exists
  if (!(await fileExists(inputPath))) {
    printError(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const formatLabel = to === 'beads' ? 'Beads' : 'JSON';
  printSection(`PRD to ${formatLabel} Conversion`);

  // Read input file
  printInfo(`Reading: ${inputPath}`);
  let markdown: string;
  try {
    markdown = await readFile(inputPath, 'utf-8');
  } catch (err) {
    printError(
      `Failed to read input file: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // Parse the markdown
  printInfo('Parsing user stories from markdown...');
  const parsed = parsePrdMarkdown(markdown);

  // Show warnings
  if (parsed.warnings.length > 0 && verbose) {
    console.log();
    console.log('Parsing warnings:');
    for (const warning of parsed.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  // Show parsed info
  console.log();
  printSuccess(`Found ${parsed.userStories.length} user stories`);

  if (verbose) {
    console.log();
    console.log('User stories:');
    for (const story of parsed.userStories) {
      console.log(`  ${story.id}: ${story.title} (P${story.priority})`);
      if (story.acceptanceCriteria.length > 0) {
        console.log(
          `    - ${story.acceptanceCriteria.length} acceptance criteria`,
        );
      }
      if (story.dependsOn && story.dependsOn.length > 0) {
        console.log(`    - Depends on: ${story.dependsOn.join(', ')}`);
      }
    }
  }

  if (parsed.userStories.length === 0) {
    printError('No user stories found in the PRD');
    printInfo('Make sure your PRD has sections like: ### US-001: Title');
    process.exit(1);
  }

  // Branch to format-specific handling
  if (to === 'beads') {
    await executeBeadsConversion(parsed, labels || [], verbose ?? false);
  } else {
    await executeJsonConversion(parsed, output, branch, force ?? false);
  }
}

/**
 * Execute JSON format conversion.
 */
async function executeJsonConversion(
  parsed: import('../prd/parser.js').ParsedPrd,
  output: string | undefined,
  branch: string | undefined,
  force: boolean,
): Promise<void> {
  // Prompt for branch name if not provided
  let branchName = branch || parsed.branchName;

  if (!branchName) {
    console.log();
    const featureSlug = parsed.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const defaultBranch = `feature/${featureSlug}`;

    branchName = await promptText('Git branch name for this work:', {
      default: defaultBranch,
      required: true,
      help: 'The git branch that will be used when running ralph-tui',
    });
  }

  // Determine output path
  const outputPath = output ? resolve(output) : resolve('./prd.json');

  // Check if output file exists
  if (await fileExists(outputPath)) {
    if (!force) {
      console.log();
      const overwrite = await promptBoolean(
        `Output file exists: ${outputPath}. Overwrite?`,
        {
          default: false,
        },
      );

      if (!overwrite) {
        printInfo('Conversion cancelled');
        process.exit(0);
      }
    }
  }

  const generatedPrd = parsedPrdToGeneratedPrd(parsed, branchName);
  const prdJson = convertToPrdJson(generatedPrd);

  try {
    validatePrdJsonSchema(prdJson, outputPath);
  } catch (err) {
    if (err instanceof PrdJsonSchemaError) {
      printError(
        'Internal error: Generated prd.json failed schema validation.',
      );
      printError(
        'This indicates a bug in the PRD parser. Please report this issue.',
      );
      for (const detail of err.details) {
        console.error(`  - ${detail}`);
      }
      process.exit(1);
    }
    throw err;
  }

  const outputDir = dirname(outputPath);
  try {
    await mkdir(outputDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Write output file
  console.log();
  printInfo(`Writing: ${outputPath}`);
  try {
    await writeFile(outputPath, JSON.stringify(prdJson, null, 2), 'utf-8');
  } catch (err) {
    printError(
      `Failed to write output file: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // Summary
  console.log();
  printSuccess('Conversion complete!');
  console.log();
  console.log('Summary:');
  console.log(`  PRD: ${parsed.name}`);
  console.log(`  Stories: ${parsed.userStories.length}`);
  console.log(`  Branch: ${branchName}`);
  console.log(`  Output: ${outputPath}`);
  console.log();
  printInfo(`Run with: ralph-tui run --prd ${outputPath}`);
}

/**
 * Execute Beads format conversion.
 */
async function executeBeadsConversion(
  parsed: import('../prd/parser.js').ParsedPrd,
  labels: string[],
  verbose: boolean,
): Promise<void> {
  // Check that beads is available
  const { exitCode, stderr } = await execBd(['--version']);
  if (exitCode !== 0) {
    printError(`bd command not available: ${stderr}`);
    printInfo(
      'Make sure beads is installed and the bd command is in your PATH',
    );
    process.exit(1);
  }

  // Perform the conversion
  console.log();
  const result = await convertToBeads(parsed, labels, verbose);

  if (!result.success) {
    printError(result.error || 'Conversion failed');
    process.exit(1);
  }

  // Summary
  console.log();
  printSuccess('Conversion complete!');
  console.log();
  console.log('Summary:');
  console.log(`  PRD: ${parsed.name}`);
  console.log(`  Epic: ${result.epicId}`);
  console.log(`  Stories: ${result.storyIds.length}`);
  console.log();
  console.log('Created bead IDs:');
  console.log(`  Epic: ${result.epicId}`);
  for (const storyId of result.storyIds) {
    console.log(`  Task: ${storyId}`);
  }
  console.log();
  printInfo(`Run with: ralph-tui run --epic ${result.epicId}`);
}
