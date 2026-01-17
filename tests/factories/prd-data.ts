/**
 * ABOUTME: Factory functions for creating PRD-related test objects.
 * Provides type-safe builders for GeneratedPrd, PrdUserStory, etc.
 */

import type {
  GeneratedPrd,
  PrdUserStory,
  ClarifyingQuestion,
  ClarifyingAnswers,
  PrdGenerationOptions,
  PrdGenerationResult,
} from '../../src/prd/types.js';

/**
 * Default values for PrdUserStory
 */
export const DEFAULT_USER_STORY: PrdUserStory = {
  id: 'US-001',
  title: 'Test User Story',
  description: 'As a user, I want to test PRD factories',
  acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
  priority: 1,
  labels: ['test'],
  dependsOn: [],
};

/**
 * Create a PrdUserStory with optional overrides
 */
export function createUserStory(
  overrides: Partial<PrdUserStory> = {},
): PrdUserStory {
  return {
    ...DEFAULT_USER_STORY,
    ...overrides,
  };
}

/**
 * Create multiple user stories with sequential IDs
 */
export function createUserStories(
  count: number,
  baseOverrides: Partial<PrdUserStory> = {},
): PrdUserStory[] {
  return Array.from({ length: count }, (_, i) =>
    createUserStory({
      id: `US-${String(i + 1).padStart(3, '0')}`,
      title: `User Story ${i + 1}`,
      priority: Math.min(i + 1, 4) as 1 | 2 | 3 | 4,
      dependsOn: i > 0 ? [`US-${String(i).padStart(3, '0')}`] : [],
      ...baseOverrides,
    }),
  );
}

/**
 * Default values for GeneratedPrd
 */
export const DEFAULT_GENERATED_PRD: GeneratedPrd = {
  name: 'Test Feature',
  slug: 'test-feature',
  description: 'A test feature for unit testing',
  targetUsers: 'Developers and testers',
  problemStatement: 'Need to test PRD generation',
  solution: 'Create comprehensive test factories',
  successMetrics: 'All tests pass',
  constraints: 'Must be type-safe',
  userStories: [DEFAULT_USER_STORY],
  branchName: 'feature/test-feature',
  createdAt: new Date().toISOString(),
};

/**
 * Create a GeneratedPrd with optional overrides
 */
export function createGeneratedPrd(
  overrides: Partial<GeneratedPrd> = {},
): GeneratedPrd {
  return {
    ...DEFAULT_GENERATED_PRD,
    ...overrides,
    userStories: overrides.userStories ?? [
      ...DEFAULT_GENERATED_PRD.userStories,
    ],
  };
}

/**
 * Create a GeneratedPrd with multiple user stories
 */
export function createGeneratedPrdWithStories(
  storyCount: number,
  overrides: Partial<GeneratedPrd> = {},
): GeneratedPrd {
  return createGeneratedPrd({
    ...overrides,
    userStories: createUserStories(storyCount),
  });
}

/**
 * Create a ClarifyingQuestion with optional overrides
 */
export function createClarifyingQuestion(
  overrides: Partial<ClarifyingQuestion> = {},
): ClarifyingQuestion {
  return {
    id: 'q1',
    question: 'What is the scope of this feature?',
    category: 'scope',
    ...overrides,
  };
}

/**
 * Create ClarifyingAnswers with optional overrides
 */
export function createClarifyingAnswers(
  overrides: Partial<ClarifyingAnswers> = {},
): ClarifyingAnswers {
  return {
    featureDescription: 'Test feature description',
    answers: {
      q1: 'Answer to question 1',
      q2: 'Answer to question 2',
    },
    ...overrides,
  };
}

/**
 * Create PrdGenerationOptions with optional overrides
 */
export function createPrdGenerationOptions(
  overrides: Partial<PrdGenerationOptions> = {},
): PrdGenerationOptions {
  return {
    cwd: process.cwd(),
    storyCount: 5,
    outputDir: './tasks',
    generateJson: true,
    storyPrefix: 'US-',
    force: false,
    ...overrides,
  };
}

/**
 * Create a successful PrdGenerationResult
 */
export function createSuccessfulPrdResult(
  prd: Partial<GeneratedPrd> = {},
  overrides: Partial<PrdGenerationResult> = {},
): PrdGenerationResult {
  const generatedPrd = createGeneratedPrd(prd);
  return {
    success: true,
    markdownPath: `./tasks/${generatedPrd.slug}.md`,
    jsonPath: `./tasks/${generatedPrd.slug}.json`,
    prd: generatedPrd,
    ...overrides,
  };
}

/**
 * Create a failed PrdGenerationResult
 */
export function createFailedPrdResult(
  error = 'PRD generation failed',
  overrides: Partial<PrdGenerationResult> = {},
): PrdGenerationResult {
  return {
    success: false,
    error,
    ...overrides,
  };
}

/**
 * Create a cancelled PrdGenerationResult
 */
export function createCancelledPrdResult(): PrdGenerationResult {
  return {
    success: false,
    cancelled: true,
  };
}
