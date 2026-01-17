/**
 * ABOUTME: Interactive PRD creation wizard.
 * Guides users through feature description and clarifying questions.
 * Generates markdown PRD and optionally converts to tracker format.
 */

import { mkdir, writeFile, access, constants } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ClarifyingAnswers,
  GeneratedPrd,
  PrdGenerationOptions,
  PrdGenerationResult,
} from './types.js';
import { CLARIFYING_QUESTIONS } from './questions.js';
import { generatePrd, renderPrdMarkdown, slugify } from './generator.js';
import {
  promptText,
  promptBoolean,
  printSection,
  printSuccess,
  printInfo,
} from '../setup/prompts.js';

/**
 * Default output directory for PRD files.
 */
const DEFAULT_OUTPUT_DIR = './tasks';

/**
 * Ensure the output directory exists.
 */
async function ensureOutputDir(dir: string): Promise<void> {
  try {
    await access(dir, constants.F_OK);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Check if a file already exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect feature description and clarifying answers from the user.
 */
async function collectAnswers(): Promise<ClarifyingAnswers | null> {
  printSection('Feature Description');

  printInfo('Describe the feature you want to build.');
  printInfo(
    'Be as detailed as you like - this will help generate a better PRD.',
  );
  console.log();

  const featureDescription = await promptText(
    'What feature do you want to build?',
    {
      required: true,
      help: 'Describe the feature in 1-3 sentences',
    },
  );

  if (!featureDescription) {
    return null;
  }

  printSection('Clarifying Questions');

  printInfo(
    `Let me ask ${CLARIFYING_QUESTIONS.length} questions to better understand your needs.`,
  );
  console.log();

  const answers: Record<string, string> = {};

  for (let i = 0; i < CLARIFYING_QUESTIONS.length; i++) {
    const question = CLARIFYING_QUESTIONS[i];
    if (!question) continue;

    console.log(`\n(${i + 1}/${CLARIFYING_QUESTIONS.length})`);

    const answer = await promptText(question.question, {
      required: false,
      help: question.followUp,
    });

    answers[question.id] = answer;

    // If answer is too brief and we have a follow-up, ask for more detail
    if (answer && answer.length < 20 && question.followUp) {
      const moreDetail = await promptText(question.followUp, {
        required: false,
      });
      if (moreDetail) {
        answers[question.id] = `${answer}. ${moreDetail}`;
      }
    }
  }

  return {
    featureDescription,
    answers,
  };
}

/**
 * Display a summary of the generated PRD.
 */
function displayPrdSummary(prd: GeneratedPrd): void {
  printSection('Generated PRD Summary');

  console.log(`  Feature:     ${prd.name}`);
  console.log(`  Branch:      ${prd.branchName}`);
  console.log(`  Stories:     ${prd.userStories.length}`);
  console.log();

  console.log('  User Stories:');
  for (const story of prd.userStories) {
    const status =
      story.priority === 1 ? '🔴' : story.priority === 2 ? '🟡' : '🟢';
    console.log(`    ${status} ${story.id}: ${story.title}`);
  }
}

/**
 * Run the interactive PRD creation wizard.
 */
export async function runPrdWizard(
  options: PrdGenerationOptions = {},
): Promise<PrdGenerationResult> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = resolve(cwd, options.outputDir ?? DEFAULT_OUTPUT_DIR);

  try {
    // Print welcome banner
    console.log();
    console.log(
      '╔════════════════════════════════════════════════════════════╗',
    );
    console.log(
      '║                  Ralph TUI - PRD Creator                   ║',
    );
    console.log(
      '╚════════════════════════════════════════════════════════════╝',
    );
    console.log();
    printInfo(
      'This wizard will help you create a Product Requirements Document.',
    );
    printInfo('Press Ctrl+C at any time to cancel.');

    // Collect answers
    const answers = await collectAnswers();

    if (!answers) {
      return {
        success: false,
        cancelled: true,
      };
    }

    // Generate PRD
    printSection('Generating PRD');

    const prd = generatePrd(answers, options);
    const markdown = renderPrdMarkdown(prd);

    // Display summary
    displayPrdSummary(prd);

    // Ensure output directory exists
    await ensureOutputDir(outputDir);

    // Generate markdown file path
    const mdFilename = `prd-${prd.slug}.md`;
    const mdPath = join(outputDir, mdFilename);

    // Check if file exists
    if (!options.force && (await fileExists(mdPath))) {
      const overwrite = await promptBoolean(
        `File ${mdFilename} already exists. Overwrite?`,
        { default: false },
      );

      if (!overwrite) {
        printInfo('Aborted. PRD not saved.');
        return {
          success: false,
          cancelled: true,
          prd,
        };
      }
    }

    // Write markdown file
    await writeFile(mdPath, markdown, 'utf-8');
    printSuccess(`PRD saved to: ${mdPath}`);

    // Note: Tracker conversion prompt is handled by create-prd.tsx after wizard returns

    return {
      success: true,
      markdownPath: mdPath,
      prd,
    };
  } catch (error) {
    // Check for user cancellation (Ctrl+C)
    if (
      error instanceof Error &&
      error.message.includes('readline was closed')
    ) {
      console.log();
      printInfo('PRD creation cancelled.');
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
 * Check if a PRD already exists for a feature.
 */
export async function prdExists(
  featureName: string,
  options: PrdGenerationOptions = {},
): Promise<string | null> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = resolve(cwd, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const slug = slugify(featureName);
  const mdPath = join(outputDir, `prd-${slug}.md`);

  if (await fileExists(mdPath)) {
    return mdPath;
  }

  return null;
}
