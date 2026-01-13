/**
 * ABOUTME: Type definitions for Task Graph Analysis.
 * Defines interfaces for analyzing bead/task dependency graphs to identify
 * independent tasks that can be parallelized across multiple worktrees.
 */

/**
 * A task in the dependency graph with its relationships.
 */
export interface GraphTask {
  /** Unique identifier for the task */
  id: string;

  /** Human-readable title */
  title: string;

  /** Current status of the task */
  status: 'open' | 'in_progress' | 'closed' | 'cancelled';

  /** Priority level (0-4, where 4 is highest) */
  priority: number;

  /** Task IDs that must complete before this task can start */
  blockedBy: string[];

  /** Task IDs that this task blocks (downstream dependents) */
  blocks: string[];

  /** Labels associated with this task */
  labels?: string[];

  /** Task type (e.g., 'epic', 'story', 'task') */
  type?: string;

  /** Graph metrics from bv analysis */
  metrics?: TaskGraphMetrics;
}

/**
 * Graph metrics for a task from bv analysis.
 * These metrics help determine task importance and parallelization potential.
 */
export interface TaskGraphMetrics {
  /** PageRank score indicating task importance in the graph */
  pagerank?: number;

  /** Betweenness centrality - how often task is on shortest paths */
  betweenness?: number;

  /** Number of tasks this unblocks when completed */
  unblockCount: number;

  /** Critical path position (if on critical path) */
  criticalPathPosition?: number;

  /** Slack time available before this task delays the project */
  slack?: number;

  /** Composite score from bv triage (0-1) */
  triageScore?: number;

  /** Human-readable reasons for task selection */
  reasons?: string[];
}

/**
 * A group of tasks that can be executed in parallel.
 * All tasks in a work unit have no blocking dependencies on each other.
 */
export interface ParallelWorkUnit {
  /** Unique identifier for this work unit */
  id: string;

  /** Human-readable name for the work unit */
  name: string;

  /** Tasks in this parallel group */
  tasks: GraphTask[];

  /** Track/lane identifier from bv --robot-plan */
  track?: string;

  /** Total number of downstream tasks unblocked by completing this unit */
  totalUnblocks: number;

  /** Average priority of tasks in this unit */
  avgPriority: number;

  /** Reasons why these tasks were grouped together */
  groupingReasons: string[];
}

/**
 * Result of analyzing the task graph for parallelization opportunities.
 */
export interface ParallelizationAnalysis {
  /** Timestamp when analysis was performed */
  analyzedAt: Date;

  /** Total number of tasks analyzed */
  totalTasks: number;

  /** Number of tasks with no blocking dependencies (immediately actionable) */
  actionableTasks: number;

  /** Number of tasks currently blocked */
  blockedTasks: number;

  /** Parallel work units identified */
  workUnits: ParallelWorkUnit[];

  /** Tasks that are on the critical path */
  criticalPathTasks: string[];

  /** Detected cycles in the dependency graph (if any) */
  cycles?: string[][];

  /** Maximum parallelism achievable with current graph structure */
  maxParallelism: number;

  /** Detailed reasoning for the parallelization strategy */
  reasoning: ParallelizationReasoning;

  /** Hash of the source data for cache invalidation */
  dataHash?: string;
}

/**
 * Detailed reasoning for parallelization decisions.
 * This provides transparency into why tasks were grouped as they were.
 */
export interface ParallelizationReasoning {
  /** Overall strategy description */
  strategy: string;

  /** Why this level of parallelism was chosen */
  parallelismRationale: string;

  /** Per-work-unit reasoning */
  workUnitReasons: {
    workUnitId: string;
    reason: string;
    alternativesConsidered?: string[];
  }[];

  /** Any constraints that limited parallelization */
  constraints: string[];

  /** Recommendations for improving parallelization */
  recommendations: string[];
}

/**
 * Configuration for the Task Graph Analyzer.
 */
export interface TaskGraphAnalyzerConfig {
  /** Working directory for bd/bv commands */
  workingDir: string;

  /** Maximum number of parallel work units to create */
  maxParallelUnits: number;

  /** Minimum tasks per work unit (to avoid too-fine granularity) */
  minTasksPerUnit: number;

  /** Maximum tasks per work unit (to avoid overloading a single worktree) */
  maxTasksPerUnit: number;

  /** Whether to use bv for graph analysis (falls back to basic analysis if false) */
  useBvAnalysis: boolean;

  /** Label filter for tasks */
  labels?: string[];

  /** Epic ID to scope analysis to */
  epicId?: string;

  /** Timeout for bv commands in milliseconds */
  bvTimeoutMs: number;
}

/**
 * Default configuration for the Task Graph Analyzer.
 */
export const DEFAULT_TASK_GRAPH_ANALYZER_CONFIG: TaskGraphAnalyzerConfig = {
  workingDir: process.cwd(),
  maxParallelUnits: 4,
  minTasksPerUnit: 1,
  maxTasksPerUnit: 5,
  useBvAnalysis: true,
  bvTimeoutMs: 30000,
};

/**
 * Output from bv --robot-plan command.
 */
export interface BvPlanOutput {
  generated_at: string;
  data_hash: string;
  plan: {
    summary: {
      total_actionable: number;
      parallel_tracks: number;
      estimated_phases: number;
      highest_impact: string;
      critical_path_length: number;
    };
    tracks: BvPlanTrack[];
    phases: BvPlanPhase[];
    critical_path?: string[];
  };
  status?: Record<string, { state: string; elapsed_ms: number }>;
}

/**
 * A parallel execution track from bv --robot-plan.
 */
export interface BvPlanTrack {
  track_id: string;
  name: string;
  issues: BvPlanIssue[];
  unblocks: string[];
}

/**
 * An issue within a bv plan track.
 */
export interface BvPlanIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  labels?: string[];
  type?: string;
  blocked_by?: string[];
  blocks?: string[];
}

/**
 * A phase in the bv execution plan (sequential ordering of tracks).
 */
export interface BvPlanPhase {
  phase_number: number;
  track_ids: string[];
  issues: string[];
  can_start_after: string[];
}

/**
 * Output from bv --robot-insights command.
 */
export interface BvInsightsOutput {
  generated_at: string;
  data_hash: string;
  status: Record<string, { state: string; elapsed_ms: number }>;
  PageRank?: Record<string, number>;
  Betweenness?: Record<string, number>;
  Cycles?: string[][];
  CriticalPath?: string[];
  HITS?: {
    authorities: Record<string, number>;
    hubs: Record<string, number>;
  };
  Slack?: Record<string, number>;
}

/**
 * Events emitted by the Task Graph Analyzer.
 */
export type TaskGraphEvent =
  | { type: 'analysis_started'; config: TaskGraphAnalyzerConfig }
  | { type: 'analysis_completed'; analysis: ParallelizationAnalysis }
  | { type: 'analysis_failed'; error: Error }
  | { type: 'bv_command_started'; command: string }
  | { type: 'bv_command_completed'; command: string; durationMs: number }
  | { type: 'bv_command_failed'; command: string; error: string }
  | { type: 'work_unit_created'; workUnit: ParallelWorkUnit }
  | { type: 'task_status_updated'; taskId: string; oldStatus: string; newStatus: string }
  | { type: 'parallelization_reasoning'; reasoning: ParallelizationReasoning };

/**
 * Callback type for Task Graph Analyzer event listeners.
 */
export type TaskGraphEventListener = (event: TaskGraphEvent) => void;

/**
 * Statistics about the Task Graph Analyzer's operations.
 */
export interface TaskGraphAnalyzerStats {
  /** Total analyses performed */
  totalAnalyses: number;

  /** Total bv commands executed */
  bvCommandsExecuted: number;

  /** Average analysis time in milliseconds */
  avgAnalysisTimeMs: number;

  /** Total task status updates performed */
  statusUpdates: number;

  /** Last successful analysis timestamp */
  lastAnalysisAt?: Date;

  /** Cache hit rate for bv commands */
  cacheHitRate: number;
}
