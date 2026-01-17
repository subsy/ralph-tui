/**
 * ABOUTME: PRD generation logic.
 * Transforms clarifying answers into a structured PRD document.
 * Generates both markdown and JSON formats.
 */

import type {
  ClarifyingAnswers,
  GeneratedPrd,
  PrdUserStory,
  PrdGenerationOptions,
} from './types.js';

/**
 * Convert a string to a slug (kebab-case).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Generate a git branch name from the feature name.
 */
export function generateBranchName(featureName: string): string {
  const slug = slugify(featureName);
  // Prefix with feature/ for conventional branch naming
  return `feature/${slug}`;
}

/**
 * Extract user stories from the feature description and answers.
 * This is a simple heuristic-based approach that creates basic stories.
 */
export function generateUserStories(
  answers: ClarifyingAnswers,
  options: PrdGenerationOptions = {},
): PrdUserStory[] {
  const prefix = options.storyPrefix || 'US-';
  const targetCount = options.storyCount || 5;
  const stories: PrdUserStory[] = [];

  // Parse the feature description to extract potential stories
  const description = answers.featureDescription;
  const userAnswer = answers.answers.users || 'the user';
  const successAnswer = answers.answers.success || '';

  // Story 1: Core functionality (always first)
  stories.push({
    id: `${prefix}001`,
    title: `Core ${getFeatureVerb(description)} implementation`,
    description: `As ${userAnswer}, I want to ${description.toLowerCase().replace(/^(implement|add|create|build)\s+/i, '')} so that I can achieve my goal.`,
    acceptanceCriteria: [
      'Feature is accessible from the main interface',
      'Basic functionality works as described',
      'No errors or crashes during normal operation',
    ],
    priority: 1,
  });

  // Story 2: User feedback/validation
  if (targetCount >= 2) {
    stories.push({
      id: `${prefix}002`,
      title: 'Input validation and error handling',
      description: `As ${userAnswer}, I want clear feedback when something goes wrong so that I can correct my actions.`,
      acceptanceCriteria: [
        'Invalid inputs are handled gracefully',
        'Error messages are clear and actionable',
        'User can recover from error states',
      ],
      priority: 2,
      dependsOn: [`${prefix}001`],
    });
  }

  // Story 3: Success criteria based on user answers
  if (targetCount >= 3 && successAnswer) {
    stories.push({
      id: `${prefix}003`,
      title: 'Success metrics and completion tracking',
      description: `As ${userAnswer}, I want to know when the feature has completed successfully based on: ${successAnswer}`,
      acceptanceCriteria: parseSuccessCriteria(successAnswer),
      priority: 2,
      dependsOn: [`${prefix}001`],
    });
  }

  // Story 4: Edge cases/robustness
  if (targetCount >= 4) {
    const constraintAnswer = answers.answers.constraints || '';
    stories.push({
      id: `${prefix}004`,
      title: 'Handle edge cases and constraints',
      description: `As ${userAnswer}, I want the feature to handle edge cases gracefully${constraintAnswer ? `, considering: ${constraintAnswer}` : ''}.`,
      acceptanceCriteria: [
        'Edge cases are identified and handled',
        'System remains stable under unusual conditions',
        'Appropriate fallback behavior exists',
      ],
      priority: 3,
      dependsOn: [`${prefix}002`],
    });
  }

  // Story 5: Documentation/help
  if (targetCount >= 5) {
    stories.push({
      id: `${prefix}005`,
      title: 'User documentation and help',
      description: `As ${userAnswer}, I want documentation or help so that I can understand how to use the feature.`,
      acceptanceCriteria: [
        'Usage instructions are available',
        'Examples demonstrate common use cases',
        'Help is accessible from the feature interface',
      ],
      priority: 4,
      dependsOn: [`${prefix}001`],
    });
  }

  return stories;
}

/**
 * Extract a verb from the feature description.
 */
function getFeatureVerb(description: string): string {
  const words = description.toLowerCase().split(/\s+/);
  const verbs = [
    'implement',
    'add',
    'create',
    'build',
    'develop',
    'enable',
    'support',
  ];

  for (const word of words) {
    if (verbs.includes(word)) {
      return word;
    }
  }

  return 'feature';
}

/**
 * Parse success criteria from the answer into acceptance criteria.
 */
function parseSuccessCriteria(successAnswer: string): string[] {
  // Try to split on common delimiters
  const parts = successAnswer
    .split(/[,;]\s*|\s+and\s+|\s*-\s*/i)
    .filter(Boolean);

  if (parts.length >= 2) {
    return parts.map((p) => p.trim()).filter((p) => p.length > 5);
  }

  // Single criterion
  return [successAnswer.trim()];
}

/**
 * Generate a complete PRD from the clarifying answers.
 */
export function generatePrd(
  answers: ClarifyingAnswers,
  options: PrdGenerationOptions = {},
): GeneratedPrd {
  const name = extractFeatureName(answers.featureDescription);
  const slug = slugify(name);

  return {
    name,
    slug,
    description: answers.featureDescription,
    targetUsers: answers.answers.users || 'End users',
    problemStatement: answers.answers.problem || answers.featureDescription,
    solution: answers.featureDescription,
    successMetrics: answers.answers.success || 'Feature works as specified',
    constraints: answers.answers.constraints || 'None specified',
    userStories: generateUserStories(answers, options),
    branchName: generateBranchName(name),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Extract a feature name from the description.
 */
function extractFeatureName(description: string): string {
  // Take first 50 chars or up to first period/newline
  const truncated = description.slice(0, 50);
  const endIndex = Math.min(
    truncated.indexOf('.') > 0 ? truncated.indexOf('.') : truncated.length,
    truncated.indexOf('\n') > 0 ? truncated.indexOf('\n') : truncated.length,
  );

  return truncated.slice(0, endIndex).trim() || 'New Feature';
}

/**
 * Render the PRD as markdown.
 */
export function renderPrdMarkdown(prd: GeneratedPrd): string {
  const lines: string[] = [];

  // Header
  lines.push(`# PRD: ${prd.name}`);
  lines.push('');
  lines.push(`> Generated: ${new Date(prd.createdAt).toLocaleDateString()}`);
  lines.push(`> Branch: \`${prd.branchName}\``);
  lines.push('');

  // Description
  lines.push('## Overview');
  lines.push('');
  lines.push(prd.description);
  lines.push('');

  // Target Users
  lines.push('## Target Users');
  lines.push('');
  lines.push(prd.targetUsers);
  lines.push('');

  // Problem Statement
  lines.push('## Problem Statement');
  lines.push('');
  lines.push(prd.problemStatement);
  lines.push('');

  // Solution
  lines.push('## Proposed Solution');
  lines.push('');
  lines.push(prd.solution);
  lines.push('');

  // Success Metrics
  lines.push('## Success Metrics');
  lines.push('');
  lines.push(prd.successMetrics);
  lines.push('');

  // Constraints
  if (prd.constraints && prd.constraints !== 'None specified') {
    lines.push('## Constraints');
    lines.push('');
    lines.push(prd.constraints);
    lines.push('');
  }

  // User Stories
  lines.push('## User Stories');
  lines.push('');

  for (const story of prd.userStories) {
    lines.push(`### ${story.id}: ${story.title}`);
    lines.push('');
    lines.push(story.description);
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
    lines.push('');

    if (story.dependsOn && story.dependsOn.length > 0) {
      lines.push(`**Depends on:** ${story.dependsOn.join(', ')}`);
      lines.push('');
    }

    lines.push(`**Priority:** P${story.priority}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Technical Notes
  if (prd.technicalNotes) {
    lines.push('## Technical Notes');
    lines.push('');
    lines.push(prd.technicalNotes);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert PRD to prd.json format for the JSON tracker.
 */
export function convertToPrdJson(prd: GeneratedPrd): object {
  return {
    name: prd.name,
    description: prd.description,
    branchName: prd.branchName,
    userStories: prd.userStories.map((story) => ({
      id: story.id,
      title: story.title,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      priority: story.priority,
      passes: false,
      labels: story.labels || [],
      dependsOn: story.dependsOn || [],
    })),
    metadata: {
      createdAt: prd.createdAt,
      version: '1.0.0',
    },
  };
}
