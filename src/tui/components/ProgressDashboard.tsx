/**
 * ABOUTME: Progress Dashboard component for the Ralph TUI.
 * Displays execution status, current task info, and agent/tracker configuration.
 * Shows detailed activity information to make engine state clear.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators, layout, type RalphStatus } from '../theme.js';
import type { SandboxConfig, SandboxMode } from '../../config/types.js';

/**
 * Props for the ProgressDashboard component
 */
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
 * Get sandbox display string from config
 * Shows resolved mode when mode is 'auto' (e.g., "auto (bwrap)")
 */
function getSandboxDisplay(
  sandboxConfig?: SandboxConfig,
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>
): string | null {
  if (!sandboxConfig?.enabled) {
    return null;
  }

  const mode = sandboxConfig.mode ?? 'auto';
  if (mode === 'off') {
    return null;
  }

  // Show resolved mode when mode is 'auto' (e.g., "auto (bwrap)")
  const modeDisplay = mode === 'auto' && resolvedSandboxMode
    ? `auto (${resolvedSandboxMode})`
    : mode;
  const networkSuffix = sandboxConfig.network === false ? ' (no-net)' : '';
  return `${modeDisplay}${networkSuffix}`;
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
      return { label: 'Pausing after current iteration...', color: colors.status.warning, indicator: statusIndicators.pausing };
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
}: ProgressDashboardProps): ReactNode {
  const statusDisplay = getStatusDisplay(status, currentTaskId);
  const sandboxDisplay = getSandboxDisplay(sandboxConfig, resolvedSandboxMode);

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
        flexDirection: 'column',
        backgroundColor: colors.bg.secondary,
        padding: 1,
        border: true,
        borderColor: colors.border.normal,
        overflow: 'hidden',
      }}
    >
      {/* Top row: Status and Epic name */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <box style={{ flexDirection: 'row', gap: 2, flexShrink: 1 }}>
          <text>
            <span fg={statusDisplay.color}>{statusDisplay.indicator}</span>
            <span fg={statusDisplay.color}> {statusDisplay.label}</span>
          </text>
          {epicName && (
            <text fg={colors.accent.primary}>{epicName}</text>
          )}
        </box>
        <box style={{ flexDirection: 'row', gap: 2 }}>
          <text fg={colors.fg.secondary}>Agent: </text>
          <text fg={colors.accent.secondary}>{agentName}</text>
          {modelDisplay && (
            <>
              <text fg={colors.fg.muted}> | </text>
              <text fg={colors.accent.primary}>{modelDisplay.display}</text>
            </>
          )}
          <text fg={colors.fg.muted}> | </text>
          <text fg={colors.fg.secondary}>Tracker: </text>
          <text fg={colors.accent.tertiary}>{trackerName}</text>
          {sandboxDisplay && (
            <>
              <text fg={colors.fg.muted}> | </text>
              <text fg={colors.fg.secondary}>Sandbox: </text>
              <text fg={colors.status.info}>{sandboxDisplay}</text>
            </>
          )}
        </box>
      </box>

      {/* Current task info row - only shown when executing */}
      {taskDisplay && (
        <box style={{ flexDirection: 'row', gap: 1 }}>
          <text fg={colors.fg.muted}>Working on:</text>
          <text fg={colors.accent.tertiary}>{currentTaskId}</text>
          <text fg={colors.fg.secondary}>-</text>
          <text fg={colors.fg.primary}>{taskDisplay}</text>
        </box>
      )}

    </box>
  );
}
