/**
 * ABOUTME: Compact header component for the Ralph TUI.
 * Displays only essential info: status indicator, current task (if running), progress (X/Y), elapsed time.
 * Also shows active agent name with fallback indicator and rate limit status.
 * Designed for minimal vertical footprint while providing clear visibility into current state.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators, formatElapsedTime, layout, type RalphStatus } from '../theme.js';
import type { HeaderProps } from '../types.js';

/** Rate limit indicator icon */
const RATE_LIMIT_ICON = '⏳';

/** Sandbox indicator icon */
const SANDBOX_ICON = '🔒';

/**
 * Truncate text to fit within a given width, adding ellipsis if needed
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get compact status display for the current Ralph status.
 * Returns a short, scannable label optimized for the compact header.
 */
function getStatusDisplay(status: RalphStatus): { indicator: string; color: string; label: string } {
  switch (status) {
    case 'ready':
      return { indicator: statusIndicators.ready, color: colors.status.info, label: 'Ready' };
    case 'running':
      return { indicator: statusIndicators.running, color: colors.status.success, label: 'Running' };
    case 'selecting':
      return { indicator: statusIndicators.selecting, color: colors.status.info, label: 'Selecting' };
    case 'executing':
      return { indicator: statusIndicators.executing, color: colors.status.success, label: 'Executing' };
    case 'pausing':
      return { indicator: statusIndicators.pausing, color: colors.status.warning, label: 'Pausing' };
    case 'paused':
      return { indicator: statusIndicators.paused, color: colors.status.warning, label: 'Paused' };
    case 'stopped':
      return { indicator: statusIndicators.stopped, color: colors.fg.muted, label: 'Stopped' };
    case 'complete':
      return { indicator: statusIndicators.complete, color: colors.status.success, label: 'Complete' };
    case 'idle':
      return { indicator: statusIndicators.idle, color: colors.fg.muted, label: 'Idle' };
    case 'error':
      return { indicator: statusIndicators.blocked, color: colors.status.error, label: 'Error' };
  }
}

/**
 * Compact mini progress bar for header display
 */
function MiniProgressBar({
  completed,
  total,
  width,
}: {
  completed: number;
  total: number;
  width: number;
}): ReactNode {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = '▓'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);

  return (
    <text>
      <span fg={colors.status.success}>{filledBar}</span>
      <span fg={colors.fg.dim}>{emptyBar}</span>
    </text>
  );
}

/**
 * Get the display name and styling for the active agent.
 * Shows fallback indicator when on fallback agent with different color.
 */
function getAgentDisplay(
  agentName: string | undefined,
  activeAgentState: HeaderProps['activeAgentState'],
  rateLimitState: HeaderProps['rateLimitState']
): { displayName: string; color: string; showRateLimitIcon: boolean; statusLine: string | null } {
  // Use active agent from engine state if available, otherwise fall back to config
  const activeAgent = activeAgentState?.plugin ?? agentName;
  const isOnFallback = activeAgentState?.reason === 'fallback';
  const isPrimaryRateLimited = rateLimitState?.limitedAt !== undefined;
  const primaryAgent = rateLimitState?.primaryAgent;

  if (!activeAgent) {
    return { displayName: '', color: colors.accent.secondary, showRateLimitIcon: false, statusLine: null };
  }

  if (isOnFallback && isPrimaryRateLimited && primaryAgent) {
    // On fallback agent due to rate limit - show with indicator and status message
    return {
      displayName: `${activeAgent} (fallback)`,
      color: colors.status.warning,
      showRateLimitIcon: true,
      statusLine: `Primary (${primaryAgent}) rate limited, using fallback`,
    };
  }

  if (isOnFallback) {
    // On fallback agent for other reasons
    return {
      displayName: `${activeAgent} (fallback)`,
      color: colors.status.warning,
      showRateLimitIcon: false,
      statusLine: null,
    };
  }

  return {
    displayName: activeAgent,
    color: colors.accent.secondary,
    showRateLimitIcon: false,
    statusLine: null,
  };
}

/**
 * Get the sandbox display string.
 * Returns null if sandbox is disabled, otherwise returns mode with optional (no-net) suffix.
 */
function getSandboxDisplay(
  sandboxConfig: HeaderProps['sandboxConfig']
): string | null {
  if (!sandboxConfig?.enabled) {
    return null;
  }

  const mode = sandboxConfig.mode ?? 'auto';
  if (mode === 'off') {
    return null;
  }

  const networkSuffix = sandboxConfig.network === false ? ' (no-net)' : '';
  return `${mode}${networkSuffix}`;
}

/**
 * Compact header component showing essential information:
 * - Status indicator and label
 * - Current task (when executing)
 * - Agent and tracker plugin names (for configuration visibility)
 * - Model being used (provider/model format with logo)
 * - Sandbox status when enabled (mode + network status)
 * - Fallback indicator when using fallback agent
 * - Rate limit icon when primary agent is limited
 * - Status line when primary agent is rate limited (explains fallback)
 * - Progress (X/Y tasks) with mini bar
 * - Elapsed time
 */
export function Header({
  status,
  elapsedTime,
  currentTaskId,
  currentTaskTitle,
  completedTasks = 0,
  totalTasks = 0,
  agentName,
  trackerName,
  activeAgentState,
  rateLimitState,
  currentIteration,
  maxIterations,
  currentModel,
  sandboxConfig,
}: HeaderProps): ReactNode {
  const statusDisplay = getStatusDisplay(status);
  const formattedTime = formatElapsedTime(elapsedTime);

  // Get agent display info including fallback status and status line message
  const agentDisplay = getAgentDisplay(agentName, activeAgentState, rateLimitState);

  // Parse model info for display
  const modelDisplay = currentModel
    ? (() => {
        const [provider, model] = currentModel.includes('/') ? currentModel.split('/') : ['', currentModel];
        return { provider, model, full: currentModel, display: provider ? `${provider}/${model}` : model };
      })()
    : null;

  // Get sandbox display info (null if disabled)
  const sandboxDisplay = getSandboxDisplay(sandboxConfig);

  // Show abbreviated task title when executing (max 40 chars), fallback to task ID
  const isActive = status === 'executing' || status === 'running';
  const taskDisplay = isActive
    ? currentTaskTitle
      ? truncateText(currentTaskTitle, 40)
      : currentTaskId
        ? truncateText(currentTaskId, 20)
        : null
    : null;

  // Calculate header height: 1 row normally, 2 rows when status line is present
  const headerHeight = agentDisplay.statusLine ? 2 : layout.header.height;

  return (
    <box
      style={{
        width: '100%',
        height: headerHeight,
        flexDirection: 'column',
        backgroundColor: colors.bg.secondary,
      }}
    >
      {/* Main header row */}
      <box
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {/* Left section: Status indicator + label + optional current task */}
        <box style={{ flexDirection: 'row', gap: 1, flexShrink: 1 }}>
          <text>
            <span fg={statusDisplay.color}>{statusDisplay.indicator}</span>
            <span fg={statusDisplay.color}> {statusDisplay.label}</span>
          </text>
          {taskDisplay && (
            <text>
              <span fg={colors.fg.muted}> → </span>
              <span fg={colors.accent.tertiary}>{taskDisplay}</span>
            </text>
          )}
        </box>

        {/* Right section: Agent/Tracker + Model + Sandbox + Progress (X/Y) with mini bar + elapsed time */}
        <box style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
          {/* Agent, model, tracker, and sandbox indicators */}
          {(agentDisplay.displayName || trackerName || modelDisplay || sandboxDisplay) && (
            <text fg={colors.fg.muted}>
              {agentDisplay.showRateLimitIcon && (
                <span fg={colors.status.warning}>{RATE_LIMIT_ICON} </span>
              )}
              {agentDisplay.displayName && (
                <span fg={agentDisplay.color}>{agentDisplay.displayName}</span>
              )}
              {agentDisplay.displayName && (trackerName || modelDisplay || sandboxDisplay) && <span fg={colors.fg.dim}> | </span>}
              {modelDisplay && (
                <span fg={colors.accent.primary}>{modelDisplay.display}</span>
              )}
              {(agentDisplay.displayName || modelDisplay) && (trackerName || sandboxDisplay) && <span fg={colors.fg.dim}> | </span>}
              {trackerName && <span fg={colors.accent.tertiary}>{trackerName}</span>}
              {trackerName && sandboxDisplay && <span fg={colors.fg.dim}> | </span>}
              {sandboxDisplay && (
                <span fg={colors.status.info}>{SANDBOX_ICON} {sandboxDisplay}</span>
              )}
            </text>
          )}
          <box style={{ flexDirection: 'row', gap: 1, alignItems: 'center' }}>
            <MiniProgressBar completed={completedTasks} total={totalTasks} width={8} />
            <text fg={colors.fg.secondary}>
              {completedTasks}/{totalTasks}
            </text>
          </box>
          {/* Iteration counter - show current/max or current/∞ for unlimited */}
          {currentIteration !== undefined && maxIterations !== undefined && (
            <text fg={colors.fg.muted}>
              <span fg={colors.fg.secondary}>
                [{currentIteration}/{maxIterations === 0 ? '∞' : maxIterations}]
              </span>
            </text>
          )}
          <text fg={colors.fg.muted}>⏱</text>
          <text fg={colors.fg.secondary}>{formattedTime}</text>
        </box>
      </box>

      {/* Status line row - shown when primary agent is rate limited */}
      {agentDisplay.statusLine && (
        <box
          style={{
            width: '100%',
            height: 1,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={colors.status.warning}>
            <span>{RATE_LIMIT_ICON} </span>
            <span>{agentDisplay.statusLine}</span>
          </text>
        </box>
      )}
    </box>
  );
}
