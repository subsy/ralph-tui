/**
 * ABOUTME: AI-powered conflict resolver for merge conflicts during parallel worktree execution.
 * Analyzes git merge conflicts, generates resolution candidates with confidence scoring,
 * and prompts users for input when AI confidence is below the configured threshold.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_CONFLICT_RESOLUTION_CONFIG } from '../config/types.js';
import type {
  ConflictResolverConfig,
  ConflictResolverEvent,
  ConflictResolverEventListener,
  ConflictResolutionResult,
  FileConflict,
  FileResolutionResult,
  ConflictHunk,
  ResolutionCandidate,
} from './conflict-resolver-types.js';

const CONFLICT_MARKER_OURS = '<<<<<<<';
const CONFLICT_MARKER_SEPARATOR = '=======';
const CONFLICT_MARKER_THEIRS = '>>>>>>>';
const CONFLICT_MARKER_ANCESTOR = '|||||||';

function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Git command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export class ConflictResolver {
  private readonly config: ConflictResolverConfig;
  private readonly listeners: Set<ConflictResolverEventListener> = new Set();

  constructor(config: Partial<ConflictResolverConfig> & { projectRoot: string }) {
    this.config = {
      ...DEFAULT_CONFLICT_RESOLUTION_CONFIG,
      ...config,
      projectRoot: resolve(config.projectRoot),
    };
  }

  addEventListener(listener: ConflictResolverEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: ConflictResolverEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: ConflictResolverEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }

  async resolveConflicts(conflictingFiles: string[]): Promise<ConflictResolutionResult> {
    const startTime = Date.now();
    const filesToProcess = conflictingFiles.slice(0, this.config.maxFilesPerConflict);

    this.emit({ type: 'resolution_started', fileCount: filesToProcess.length });

    const results: FileResolutionResult[] = [];

    for (let i = 0; i < filesToProcess.length; i++) {
      const filePath = filesToProcess[i]!;
      this.emit({
        type: 'file_analyzing',
        filePath,
        index: i,
        total: filesToProcess.length,
      });

      const result = await this.resolveFile(filePath);
      results.push(result);

      this.emit({
        type: 'file_resolved',
        result,
        index: i,
        total: filesToProcess.length,
      });
    }

    const autoResolved = results.filter((r) => r.success && !r.requiresUserInput);
    const pending = results.filter((r) => r.requiresUserInput);
    const failed = results.filter((r) => !r.success && !r.requiresUserInput);

    if (pending.length > 0) {
      this.emit({ type: 'user_prompt_required', pendingFiles: pending });

      if (this.config.onUserPrompt) {
        await this.handleUserPrompts(pending, filesToProcess);
      }
    }

    const successRate = filesToProcess.length > 0
      ? autoResolved.length / filesToProcess.length
      : 0;

    const overallConfidence = autoResolved.length > 0
      ? autoResolved.reduce((sum, r) => sum + (r.resolution?.confidence ?? 0), 0) / autoResolved.length
      : 0;

    const resolutionResult: ConflictResolutionResult = {
      success: failed.length === 0 && pending.length === 0,
      autoResolvedFiles: autoResolved,
      pendingFiles: pending,
      failedFiles: failed,
      overallConfidence,
      totalDurationMs: Date.now() - startTime,
      stats: {
        totalFiles: filesToProcess.length,
        autoResolved: autoResolved.length,
        pendingUserInput: pending.length,
        failed: failed.length,
        successRate,
      },
    };

    this.emit({ type: 'resolution_completed', result: resolutionResult });
    return resolutionResult;
  }

  private async resolveFile(filePath: string): Promise<FileResolutionResult> {
    const startTime = Date.now();
    const fullPath = resolve(this.config.projectRoot, filePath);

    try {
      const content = await readFile(fullPath, 'utf-8');
      const conflict = this.parseConflicts(filePath, content);

      if (conflict.hunks.length === 0) {
        return {
          filePath,
          success: true,
          requiresUserInput: false,
          durationMs: Date.now() - startTime,
        };
      }

      const resolution = await this.generateResolution(conflict);

      if (resolution.confidence >= this.config.confidenceThreshold) {
        if (this.config.autoResolve) {
          await writeFile(fullPath, resolution.resolvedContent, 'utf-8');
          await execGit(['add', filePath], this.config.projectRoot);
        }

        return {
          filePath,
          success: true,
          resolution,
          requiresUserInput: false,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        filePath,
        success: false,
        resolution,
        requiresUserInput: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit({
        type: 'error',
        error: error instanceof Error ? error : new Error(errorMessage),
        context: `resolving ${filePath}`,
      });

      return {
        filePath,
        success: false,
        error: errorMessage,
        requiresUserInput: false,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private parseConflicts(filePath: string, content: string): FileConflict {
    const lines = content.split('\n');
    const hunks: ConflictHunk[] = [];

    let inConflict = false;
    let currentHunk: Partial<ConflictHunk> = {};
    let oursLines: string[] = [];
    let theirsLines: string[] = [];
    let ancestorLines: string[] = [];
    let section: 'ours' | 'ancestor' | 'theirs' = 'ours';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (line.startsWith(CONFLICT_MARKER_OURS)) {
        inConflict = true;
        currentHunk = { startLine: i + 1 };
        oursLines = [];
        theirsLines = [];
        ancestorLines = [];
        section = 'ours';
      } else if (line.startsWith(CONFLICT_MARKER_ANCESTOR)) {
        section = 'ancestor';
      } else if (line.startsWith(CONFLICT_MARKER_SEPARATOR)) {
        section = 'theirs';
      } else if (line.startsWith(CONFLICT_MARKER_THEIRS)) {
        currentHunk.endLine = i + 1;
        currentHunk.oursContent = oursLines.join('\n');
        currentHunk.theirsContent = theirsLines.join('\n');
        if (ancestorLines.length > 0) {
          currentHunk.ancestorContent = ancestorLines.join('\n');
        }
        hunks.push(currentHunk as ConflictHunk);
        inConflict = false;
      } else if (inConflict) {
        if (section === 'ours') {
          oursLines.push(line);
        } else if (section === 'ancestor') {
          ancestorLines.push(line);
        } else {
          theirsLines.push(line);
        }
      }
    }

    return {
      filePath,
      hunks,
      fullContent: content,
      oursVersion: this.extractVersion(content, 'ours'),
      theirsVersion: this.extractVersion(content, 'theirs'),
    };
  }

  private extractVersion(content: string, version: 'ours' | 'theirs'): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inConflict = false;
    let section: 'ours' | 'ancestor' | 'theirs' = 'ours';

    for (const line of lines) {
      if (line.startsWith(CONFLICT_MARKER_OURS)) {
        inConflict = true;
        section = 'ours';
      } else if (line.startsWith(CONFLICT_MARKER_ANCESTOR)) {
        section = 'ancestor';
      } else if (line.startsWith(CONFLICT_MARKER_SEPARATOR)) {
        section = 'theirs';
      } else if (line.startsWith(CONFLICT_MARKER_THEIRS)) {
        inConflict = false;
      } else if (inConflict) {
        if ((version === 'ours' && section === 'ours') ||
            (version === 'theirs' && section === 'theirs')) {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  private async generateResolution(conflict: FileConflict): Promise<ResolutionCandidate> {
    const analysis = this.analyzeConflict(conflict);

    if (analysis.canAutoMerge) {
      return {
        resolvedContent: analysis.mergedContent!,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        strategy: 'merged',
      };
    }

    if (analysis.preferOurs) {
      return {
        resolvedContent: conflict.oursVersion,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        strategy: 'ours',
      };
    }

    if (analysis.preferTheirs) {
      return {
        resolvedContent: conflict.theirsVersion,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        strategy: 'theirs',
      };
    }

    return {
      resolvedContent: this.attemptSemanticMerge(conflict),
      confidence: analysis.confidence,
      reasoning: 'Attempted semantic merge based on conflict structure',
      strategy: 'semantic',
    };
  }

  private analyzeConflict(conflict: FileConflict): {
    canAutoMerge: boolean;
    mergedContent?: string;
    preferOurs: boolean;
    preferTheirs: boolean;
    confidence: number;
    reasoning: string;
  } {
    if (conflict.hunks.length === 0) {
      return {
        canAutoMerge: true,
        mergedContent: conflict.fullContent,
        preferOurs: false,
        preferTheirs: false,
        confidence: 1.0,
        reasoning: 'No conflicts detected',
      };
    }

    let totalConfidence = 0;
    const hunkAnalyses: { preferOurs: boolean; preferTheirs: boolean; confidence: number }[] = [];

    for (const hunk of conflict.hunks) {
      const hunkAnalysis = this.analyzeHunk(hunk);
      hunkAnalyses.push(hunkAnalysis);
      totalConfidence += hunkAnalysis.confidence;
    }

    const avgConfidence = totalConfidence / conflict.hunks.length;
    const allPreferOurs = hunkAnalyses.every((h) => h.preferOurs);
    const allPreferTheirs = hunkAnalyses.every((h) => h.preferTheirs);

    if (this.canMergeNonOverlapping(conflict)) {
      return {
        canAutoMerge: true,
        mergedContent: this.mergeNonOverlapping(conflict),
        preferOurs: false,
        preferTheirs: false,
        confidence: Math.min(avgConfidence + 0.1, 1.0),
        reasoning: 'Non-overlapping changes can be merged automatically',
      };
    }

    if (allPreferOurs) {
      return {
        canAutoMerge: false,
        preferOurs: true,
        preferTheirs: false,
        confidence: avgConfidence,
        reasoning: 'All hunks favor ours version',
      };
    }

    if (allPreferTheirs) {
      return {
        canAutoMerge: false,
        preferOurs: false,
        preferTheirs: true,
        confidence: avgConfidence,
        reasoning: 'All hunks favor theirs version',
      };
    }

    return {
      canAutoMerge: false,
      preferOurs: false,
      preferTheirs: false,
      confidence: avgConfidence * 0.7,
      reasoning: 'Complex conflict requiring semantic analysis',
    };
  }

  private analyzeHunk(hunk: ConflictHunk): {
    preferOurs: boolean;
    preferTheirs: boolean;
    confidence: number;
  } {
    const oursEmpty = hunk.oursContent.trim() === '';
    const theirsEmpty = hunk.theirsContent.trim() === '';

    if (oursEmpty && !theirsEmpty) {
      return { preferOurs: false, preferTheirs: true, confidence: 0.95 };
    }

    if (!oursEmpty && theirsEmpty) {
      return { preferOurs: true, preferTheirs: false, confidence: 0.95 };
    }

    if (hunk.oursContent === hunk.theirsContent) {
      return { preferOurs: true, preferTheirs: true, confidence: 1.0 };
    }

    const oursLines = hunk.oursContent.split('\n').length;
    const theirsLines = hunk.theirsContent.split('\n').length;
    const lineDiff = Math.abs(oursLines - theirsLines);

    if (lineDiff === 0) {
      const similarity = this.calculateSimilarity(hunk.oursContent, hunk.theirsContent);
      if (similarity > 0.8) {
        return {
          preferOurs: hunk.oursContent.length >= hunk.theirsContent.length,
          preferTheirs: hunk.theirsContent.length > hunk.oursContent.length,
          confidence: 0.7 + similarity * 0.2,
        };
      }
    }

    if (hunk.ancestorContent) {
      const oursFromAncestor = this.calculateSimilarity(hunk.oursContent, hunk.ancestorContent);
      const theirsFromAncestor = this.calculateSimilarity(hunk.theirsContent, hunk.ancestorContent);

      if (oursFromAncestor > theirsFromAncestor + 0.2) {
        return { preferOurs: false, preferTheirs: true, confidence: 0.75 };
      }
      if (theirsFromAncestor > oursFromAncestor + 0.2) {
        return { preferOurs: true, preferTheirs: false, confidence: 0.75 };
      }
    }

    return { preferOurs: false, preferTheirs: false, confidence: 0.5 };
  }

  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    const aLines = new Set(a.split('\n').map((l) => l.trim()).filter(Boolean));
    const bLines = new Set(b.split('\n').map((l) => l.trim()).filter(Boolean));

    const intersection = [...aLines].filter((line) => bLines.has(line)).length;
    const union = new Set([...aLines, ...bLines]).size;

    return union > 0 ? intersection / union : 0;
  }

  private canMergeNonOverlapping(conflict: FileConflict): boolean {
    for (const hunk of conflict.hunks) {
      const oursLines = new Set(hunk.oursContent.split('\n').map((l) => l.trim()));
      const theirsLines = new Set(hunk.theirsContent.split('\n').map((l) => l.trim()));

      for (const line of oursLines) {
        if (line && theirsLines.has(line)) {
          return false;
        }
      }
    }
    return true;
  }

  private mergeNonOverlapping(conflict: FileConflict): string {
    let content = conflict.fullContent;

    for (const hunk of conflict.hunks) {
      const conflictPattern = this.buildConflictMarkerPattern(hunk);
      const merged = [hunk.oursContent, hunk.theirsContent]
        .filter((c) => c.trim())
        .join('\n');
      content = content.replace(conflictPattern, merged);
    }

    return content;
  }

  /**
   * Build a regex pattern that matches a conflict block regardless of branch names.
   * Git conflict markers include branch names (e.g., "<<<<<<< HEAD", ">>>>>>> feature/branch")
   * so we need regex matching rather than exact string matching.
   */
  private buildConflictMarkerPattern(hunk: ConflictHunk): RegExp {
    // Escape special regex characters in content
    const escapeRegex = (str: string): string =>
      str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build pattern parts - markers may have trailing branch names
    const oursMarker = `${CONFLICT_MARKER_OURS}[^\\n]*`;
    const oursContent = escapeRegex(hunk.oursContent);

    let pattern = `${oursMarker}\\n${oursContent}`;

    if (hunk.ancestorContent) {
      const ancestorMarker = `${CONFLICT_MARKER_ANCESTOR}[^\\n]*`;
      const ancestorContent = escapeRegex(hunk.ancestorContent);
      pattern += `\\n${ancestorMarker}\\n${ancestorContent}`;
    }

    const separatorMarker = `${escapeRegex(CONFLICT_MARKER_SEPARATOR)}`;
    const theirsContent = escapeRegex(hunk.theirsContent);
    const theirsMarker = `${CONFLICT_MARKER_THEIRS}[^\\n]*`;

    pattern += `\\n${separatorMarker}\\n${theirsContent}\\n${theirsMarker}`;

    return new RegExp(pattern);
  }

  private attemptSemanticMerge(conflict: FileConflict): string {
    const lines = conflict.fullContent.split('\n');
    const result: string[] = [];
    let inConflict = false;
    let section: 'ours' | 'ancestor' | 'theirs' = 'ours';
    let oursLines: string[] = [];
    let theirsLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith(CONFLICT_MARKER_OURS)) {
        inConflict = true;
        section = 'ours';
        oursLines = [];
        theirsLines = [];
      } else if (line.startsWith(CONFLICT_MARKER_ANCESTOR)) {
        section = 'ancestor';
      } else if (line.startsWith(CONFLICT_MARKER_SEPARATOR)) {
        section = 'theirs';
      } else if (line.startsWith(CONFLICT_MARKER_THEIRS)) {
        const merged = this.mergeHunkContent(oursLines, theirsLines);
        result.push(...merged);
        inConflict = false;
      } else if (inConflict) {
        if (section === 'ours') {
          oursLines.push(line);
        } else if (section === 'theirs') {
          theirsLines.push(line);
        }
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  private mergeHunkContent(oursLines: string[], theirsLines: string[]): string[] {
    const oursSet = new Set(oursLines.map((l) => l.trim()));

    const merged: string[] = [];
    const added = new Set<string>();

    for (const line of oursLines) {
      merged.push(line);
      added.add(line.trim());
    }

    for (const line of theirsLines) {
      const trimmed = line.trim();
      if (!added.has(trimmed) && !oursSet.has(trimmed)) {
        merged.push(line);
        added.add(trimmed);
      }
    }

    return merged;
  }

  private async handleUserPrompts(
    pending: FileResolutionResult[],
    _filePaths: string[]
  ): Promise<void> {
    if (!this.config.onUserPrompt) return;

    for (const pendingResult of pending) {
      const filePath = pendingResult.filePath;
      const fullPath = resolve(this.config.projectRoot, filePath);

      try {
        const content = await readFile(fullPath, 'utf-8');
        const conflict = this.parseConflicts(filePath, content);

        const choice = await this.config.onUserPrompt(pending, conflict);

        switch (choice.type) {
          case 'accept':
            if (pendingResult.resolution) {
              await writeFile(fullPath, pendingResult.resolution.resolvedContent, 'utf-8');
              await execGit(['add', filePath], this.config.projectRoot);
            }
            break;
          case 'use_ours':
            await writeFile(fullPath, conflict.oursVersion, 'utf-8');
            await execGit(['add', filePath], this.config.projectRoot);
            break;
          case 'use_theirs':
            await writeFile(fullPath, conflict.theirsVersion, 'utf-8');
            await execGit(['add', filePath], this.config.projectRoot);
            break;
          case 'manual':
            await writeFile(fullPath, choice.content, 'utf-8');
            await execGit(['add', filePath], this.config.projectRoot);
            break;
          case 'abort_all':
            return;
          case 'reject':
            break;
        }
      } catch (error) {
        this.emit({
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          context: `user prompt for ${filePath}`,
        });
      }
    }
  }

  getConfig(): Readonly<ConflictResolverConfig> {
    return { ...this.config };
  }
}
