/**
 * ABOUTME: Type definitions for AI-powered conflict resolution.
 * Defines interfaces for conflict analysis, resolution attempts, and user prompts
 * during merge conflict handling in parallel worktree execution.
 */

import type { ConflictResolutionConfig } from '../config/types.js';

export interface ConflictHunk {
  startLine: number;
  endLine: number;
  oursContent: string;
  theirsContent: string;
  ancestorContent?: string;
}

export interface FileConflict {
  filePath: string;
  hunks: ConflictHunk[];
  fullContent: string;
  oursVersion: string;
  theirsVersion: string;
}

export interface ResolutionCandidate {
  resolvedContent: string;
  confidence: number;
  reasoning: string;
  strategy: 'ours' | 'theirs' | 'merged' | 'semantic';
}

export interface FileResolutionResult {
  filePath: string;
  success: boolean;
  resolution?: ResolutionCandidate;
  error?: string;
  requiresUserInput: boolean;
  durationMs: number;
}

export interface ConflictResolutionResult {
  success: boolean;
  autoResolvedFiles: FileResolutionResult[];
  pendingFiles: FileResolutionResult[];
  failedFiles: FileResolutionResult[];
  overallConfidence: number;
  totalDurationMs: number;
  stats: {
    totalFiles: number;
    autoResolved: number;
    pendingUserInput: number;
    failed: number;
    successRate: number;
  };
}

export type UserResolutionChoice =
  | { type: 'accept'; fileIndex: number }
  | { type: 'reject'; fileIndex: number }
  | { type: 'manual'; fileIndex: number; content: string }
  | { type: 'use_ours'; fileIndex: number }
  | { type: 'use_theirs'; fileIndex: number }
  | { type: 'abort_all' };

export type UserPromptCallback = (
  pendingFiles: FileResolutionResult[],
  conflict: FileConflict
) => Promise<UserResolutionChoice>;

export interface ConflictResolverConfig extends Required<ConflictResolutionConfig> {
  projectRoot: string;
  onUserPrompt?: UserPromptCallback;
}

export type ConflictResolverEvent =
  | { type: 'resolution_started'; fileCount: number }
  | { type: 'file_analyzing'; filePath: string; index: number; total: number }
  | { type: 'file_resolved'; result: FileResolutionResult; index: number; total: number }
  | { type: 'user_prompt_required'; pendingFiles: FileResolutionResult[] }
  | { type: 'resolution_completed'; result: ConflictResolutionResult }
  | { type: 'error'; error: Error; context?: string };

export type ConflictResolverEventListener = (event: ConflictResolverEvent) => void;
