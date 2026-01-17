/**
 * ABOUTME: Clarifying questions for PRD creation.
 * Defines the questions asked during interactive PRD generation.
 * These questions help gather enough context to generate a complete PRD.
 */

import type { ClarifyingQuestion } from './types.js';

/**
 * The standard set of clarifying questions for PRD creation.
 * Questions are ordered to flow naturally from problem to solution.
 */
export const CLARIFYING_QUESTIONS: readonly ClarifyingQuestion[] = [
  {
    id: 'users',
    question: 'Who are the target users for this feature?',
    category: 'users',
    followUp: 'Can you describe their role or use case in more detail?',
  },
  {
    id: 'problem',
    question: 'What problem does this feature solve?',
    category: 'requirements',
    followUp: 'What is the current pain point or workflow limitation?',
  },
  {
    id: 'success',
    question: 'How will you know when this feature is complete and successful?',
    category: 'success',
    followUp: 'Are there specific metrics or acceptance criteria in mind?',
  },
  {
    id: 'constraints',
    question:
      'Are there any constraints or limitations to consider? (e.g., time, technology, compatibility)',
    category: 'constraints',
  },
  {
    id: 'scope',
    question: 'What is explicitly OUT of scope for this feature?',
    category: 'scope',
    followUp: 'Any edge cases or advanced functionality to defer?',
  },
] as const;

/**
 * Get the number of questions.
 */
export function getQuestionCount(): number {
  return CLARIFYING_QUESTIONS.length;
}

/**
 * Get a question by ID.
 */
export function getQuestionById(id: string): ClarifyingQuestion | undefined {
  return CLARIFYING_QUESTIONS.find((q) => q.id === id);
}

/**
 * Get all question IDs.
 */
export function getQuestionIds(): string[] {
  return CLARIFYING_QUESTIONS.map((q) => q.id);
}
