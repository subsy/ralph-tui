/**
 * ABOUTME: Progress Dashboard component for the Ralph TUI.
 * Displays execution status, current task info, and agent/tracker configuration.
 * Shows detailed activity information to make engine state clear.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators, layout, type RalphStatus } from '../theme.js';
import type { SandboxConfig, SandboxMode } from '../../config/types.js';
import { formatTokenCount } from '../utils/token-format.js';

/**
 * Props for the ProgressDashboard component
 */
/**
 * Git repository information for display
 */
export interface GitInfo {
  repoName?: string;
  branch?: string;
  isDirty?: boolean;
  commitHash?: string;
}

export interface ProgressDashboardProps {
  /** Current Ralph execution status */
  status: RalphStatus;
  /** Name of the agent being used */
  agentName: string;
  /** Model being used (provider/model format) */
  currentModel?: string;
  /** Name of the tracker being used */
  trackerName: string;
  /** Epic or project name */
  epicName?: string;
  /** Current task ID being worked on (if any) */
  currentTaskId?: string;
  /** Current task title being worked on (if any) */
  currentTaskTitle?: string;
  /** Sandbox configuration (if sandboxing is enabled) */
  sandboxConfig?: SandboxConfig;
  /** Resolved sandbox mode (when mode is 'auto', this shows what it resolved to) */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
  /** Remote instance info (when viewing a remote) */
  remoteInfo?: {
    name: string;
    host: string;
    port: number;
  };
  /** Whether auto-commit is enabled */
  autoCommit?: boolean;
  /** Git repository information */
  gitInfo?: GitInfo;
  /** Number of currently active (running) parallel workers */
  activeWorkerCount?: number;
  /** Total number of parallel workers */
  totalWorkerCount?: number;
  /** Aggregated token usage across all tasks in the current run */
  aggregateUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Truncate text to fit within a given width, adding ellipsis if needed
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get sandbox display info from config
 * Always returns a display value with icon indicating enabled/disabled state
 */
function getSandboxDisplay(
  sandboxConfig?: SandboxConfig,
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>
): { enabled: boolean; icon: string; text: string } {
  const isEnabled = sandboxConfig?.enabled && sandboxConfig.mode !== 'off';

  if (!isEnabled) {
    return { enabled: false, icon: '🔓', text: 'off' };
  }

  const mode = sandboxConfig.mode ?? 'auto';
  // Show resolved mode when mode is 'auto' (e.g., "auto (bwrap)")
  const modeDisplay = mode === 'auto' && resolvedSandboxMode
    ? `auto (${resolvedSandboxMode})`
    : mode;
  const networkSuffix = sandboxConfig.network === false ? ' (no-net)' : '';
  return { enabled: true, icon: '🔒', text: `${modeDisplay}${networkSuffix}` };
}

/**
 * Get status display configuration with detailed activity info
 */
function getStatusDisplay(
  status: RalphStatus,
  currentTaskId?: string
): { label: string; color: string; indicator: string } {
  switch (status) {
    case 'ready':
      return { label: 'Ready - Press Enter or s to start', color: colors.status.info, indicator: statusIndicators.ready };
    case 'running':
      return { label: 'Running', color: colors.status.success, indicator: statusIndicators.running };
    case 'selecting':
      return { label: 'Selecting next task...', color: colors.status.info, indicator: statusIndicators.selecting };
    case 'executing': {
      const taskLabel = currentTaskId ? ` (${currentTaskId})` : '';
      return { label: `Agent running${taskLabel}`, color: colors.status.success, indicator: statusIndicators.executing };
    }
    case 'pausing':
      return { label: 'Pausing (completing in-flight tasks)', color: colors.status.warning, indicator: statusIndicators.pausing };
    case 'paused':
      return { label: 'Paused - Press p to resume', color: colors.status.warning, indicator: statusIndicators.paused };
    case 'stopped':
      return { label: 'Stopped', color: colors.fg.muted, indicator: statusIndicators.stopped };
    case 'complete':
      return { label: 'All tasks complete!', color: colors.status.success, indicator: statusIndicators.complete };
    case 'idle':
      return { label: 'No more tasks available', color: colors.fg.muted, indicator: statusIndicators.idle };
    case 'error':
      return { label: 'Failed - Check logs for details', color: colors.status.error, indicator: statusIndicators.blocked };
  }
}

/**
 * Progress Dashboard component showing comprehensive execution status.
 * Provides clear visibility into what the engine is doing at any moment.
 */
export function ProgressDashboard({
  status,
  agentName,
  currentModel,
  trackerName,
  epicName,
  currentTaskId,
  currentTaskTitle,
  sandboxConfig,
  resolvedSandboxMode,
  remoteInfo,
  autoCommit,
  gitInfo,
  activeWorkerCount,
  totalWorkerCount,
  aggregateUsage,
}: ProgressDashboardProps): ReactNode {
  const statusDisplay = getStatusDisplay(status, currentTaskId);
  const sandboxDisplay = getSandboxDisplay(sandboxConfig, resolvedSandboxMode);

  // Format git info for display
  const gitDisplay = gitInfo?.branch
    ? `${gitInfo.repoName ?? 'repo'}:${gitInfo.branch}${gitInfo.isDirty ? '*' : ''}`
    : null;

  // Show current task title when executing
  const taskDisplay = currentTaskTitle && (status === 'executing' || status === 'running')
    ? truncateText(currentTaskTitle, 50)
    : null;

  // Parse model info for display
  const modelDisplay = currentModel
    ? (() => {
        const [provider, model] = currentModel.includes('/') ? currentModel.split('/') : ['', currentModel];
        return { provider, model, full: currentModel, display: provider ? `${provider}/${model}` : model };
      })()
    : null;

  return (
    <box
      style={{
        width: '100%',
        height: layout.progressDashboard.height,
        flexDirection: 'row',
        backgroundColor: colors.bg.secondary,
        padding: 1,
        border: true,
        borderColor: colors.border.normal,
        overflow: 'hidden',
      }}
    >
      {/* Left column: Status, remote, and current task */}
      <box style={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, paddingRight: 2 }}>
        {/* Status line */}
        <box style={{ flexDirection: 'row', gap: 1 }}>
          <text>
            <span fg={statusDisplay.color}>{statusDisplay.indicator}</span>
            <span fg={statusDisplay.color}> {statusDisplay.label}</span>
          </text>
        </box>

        {/* Remote info (if viewing remote) */}
        {remoteInfo && (
          <box style={{ flexDirection: 'row' }}>
            <text fg={colors.accent.primary}>🌐 Remote: </text>
            <text fg={colors.fg.primary}>{remoteInfo.name}</text>
            <text fg={colors.fg.dim}> ({remoteInfo.host}:{remoteInfo.port})</text>
          </box>
        )}

        {/* Epic name (if any) */}
        {epicName && (
          <box style={{ flexDirection: 'row' }}>
            <text fg={colors.fg.muted}>Epic: </text>
            <text fg={colors.accent.primary}>{epicName}</text>
          </box>
        )}

        {/* Current task info - shown when executing */}
        {taskDisplay && (
          <box style={{ flexDirection: 'row', gap: 1 }}>
            <text fg={colors.fg.muted}>Task:</text>
            <text fg={colors.accent.tertiary}>{currentTaskId}</text>
            <text fg={colors.fg.dim}>-</text>
            <text fg={colors.fg.primary}>{taskDisplay}</text>
          </box>
        )}

        {/* Parallel worker count - shown when workers are active */}
        {activeWorkerCount !== undefined &&
          activeWorkerCount !== null &&
          activeWorkerCount > 0 &&
          totalWorkerCount !== undefined &&
          totalWorkerCount !== null && (
          <box style={{ flexDirection: 'row' }}>
            <text fg={colors.status.info}>Workers: </text>
            <text fg={colors.status.success}>{activeWorkerCount} active</text>
            <text fg={colors.fg.muted}> / {totalWorkerCount}</text>
          </box>
        )}
      </box>

      {/* Right column: Configuration items stacked */}
      <box style={{ flexDirection: 'column', width: 45, flexShrink: 0 }}>
        {/* Row 1: Agent and Model */}
        <box style={{ flexDirection: 'row' }}>
          <text fg={colors.fg.secondary}>Agent: </text>
          <text fg={colors.accent.secondary}>{agentName}</text>
          {modelDisplay && (
            <>
              <text fg={colors.fg.muted}> · </text>
              <text fg={colors.accent.primary}>{modelDisplay.display}</text>
            </>
          )}
        </box>

        {/* Row 2: Tracker */}
        <box style={{ flexDirection: 'row' }}>
          <text fg={colors.fg.secondary}>Tracker: </text>
          <text fg={colors.accent.tertiary}>{trackerName}</text>
          {aggregateUsage && (
            <>
              <text fg={colors.fg.muted}> · </text>
              <text fg={colors.fg.secondary}>Σ I/O/T: </text>
              <text fg={colors.accent.secondary}>{formatTokenCount(aggregateUsage.inputTokens)}</text>
              <text fg={colors.fg.muted}>/</text>
              <text fg={colors.accent.primary}>{formatTokenCount(aggregateUsage.outputTokens)}</text>
              <text fg={colors.fg.muted}>/</text>
              <text fg={colors.status.info}>{formatTokenCount(aggregateUsage.totalTokens)}</text>
            </>
          )}
        </box>

        {/* Row 3: Git branch (own line) */}
        <box style={{ flexDirection: 'row' }}>
          <text fg={colors.fg.secondary}>Git: </text>
          <text fg={gitInfo?.isDirty ? colors.status.warning : colors.accent.primary}>
            {gitDisplay ?? 'not a repo'}
          </text>
        </box>

        {/* Row 4: Sandbox and Auto-commit */}
        <box style={{ flexDirection: 'row' }}>
          <text fg={sandboxDisplay.enabled ? colors.status.success : colors.status.warning}>
            {sandboxDisplay.icon}
          </text>
          <text fg={sandboxDisplay.enabled ? colors.status.info : colors.fg.muted}>
            {' '}{sandboxDisplay.text}
          </text>
          <text fg={colors.fg.muted}> · </text>
          <text fg={colors.fg.secondary}>Commit: </text>
          <text fg={autoCommit ? colors.status.success : colors.fg.muted}>
            {autoCommit ? '✓ auto' : '✗ manual'}
          </text>
        </box>
      </box>
    </box>
  );
}
