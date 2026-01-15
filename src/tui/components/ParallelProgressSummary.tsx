/**
 * ABOUTME: ParallelProgressSummary component displays all parallel work streams.
 * Provides a summary view with progress indicators and drill-down capability.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { ParallelProgressSummaryProps } from '../parallel-progress-types.js';
import { formatStreamDuration } from '../parallel-progress-types.js';
import { WorkStreamCard } from './WorkStreamCard.js';

export function ParallelProgressSummary({
  streams,
  stats,
  selectedIndex,
  viewMode,
}: ParallelProgressSummaryProps): ReactNode {
  const elapsedText = formatStreamDuration(stats.totalElapsedMs);

  if (viewMode === 'drilldown') {
    return null;
  }

  return (
    <box
      style={{
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: colors.bg.primary,
      }}
    >
      <box
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          backgroundColor: colors.bg.secondary,
          padding: 1,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <text>
          <span fg={colors.accent.primary}>Parallel Work Streams</span>
          <span fg={colors.fg.muted}> ({stats.totalStreams} active)</span>
        </text>
        <text>
          <span fg={colors.status.success}>✓ {stats.completedCount}</span>
          <span fg={colors.fg.muted}> | </span>
          <span fg={colors.accent.primary}>▶ {stats.workingCount}</span>
          <span fg={colors.fg.muted}> | </span>
          <span fg={colors.status.warning}>⊘ {stats.blockedCount}</span>
          <span fg={colors.fg.muted}> | </span>
          <span fg={colors.status.error}>✗ {stats.failedCount}</span>
          <span fg={colors.fg.muted}> | </span>
          <span fg={colors.fg.secondary}>{elapsedText}</span>
        </text>
      </box>

      {stats.criticalBroadcasts > 0 && (
        <box
          style={{
            flexDirection: 'row',
            backgroundColor: colors.bg.tertiary,
            padding: 1,
            border: true,
            borderColor: colors.status.error,
          }}
        >
          <text fg={colors.status.error}>
            ⚠ {stats.criticalBroadcasts} critical broadcast{stats.criticalBroadcasts > 1 ? 's' : ''} pending acknowledgment
          </text>
        </box>
      )}

      <scrollbox
        style={{
          flexGrow: 1,
          flexDirection: 'column',
          padding: 1,
        }}
      >
        {streams.length === 0 ? (
          <box style={{ flexDirection: 'column', alignItems: 'center', padding: 2 }}>
            <text fg={colors.fg.muted}>No parallel work streams active</text>
            <text fg={colors.fg.dim}>Start parallel execution to see streams here</text>
          </box>
        ) : (
          streams.map((stream, index) => (
            <WorkStreamCard
              key={stream.id}
              stream={stream}
              isSelected={index === selectedIndex}
            />
          ))
        )}
      </scrollbox>

      <box
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          backgroundColor: colors.bg.secondary,
          padding: 1,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>↑↓</span> Navigate
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>Enter</span> Drill-down
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>Esc</span> Back
        </text>
        <text fg={colors.fg.muted}>
          Avg Progress: <span fg={colors.accent.tertiary}>{Math.round(stats.avgProgress)}%</span>
          <span fg={colors.fg.dim}> | </span>
          Broadcasts: <span fg={colors.fg.secondary}>{stats.totalBroadcasts}</span>
        </text>
      </box>
    </box>
  );
}
