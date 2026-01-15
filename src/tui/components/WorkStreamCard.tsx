/**
 * ABOUTME: WorkStreamCard component displays a single parallel work stream.
 * Shows agent ID, task name, progress percentage, current activity, and broadcast indicators.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { WorkStreamCardProps } from '../parallel-progress-types.js';
import {
  getStreamStatusColor,
  getStreamStatusIndicator,
  formatProgress,
  formatStreamDuration,
} from '../parallel-progress-types.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function createProgressBar(percent: number, width: number): string {
  if (percent < 0) return '░'.repeat(width);
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function WorkStreamCard({
  stream,
  isSelected,
  compact = false,
}: WorkStreamCardProps): ReactNode {
  const statusColor = getStreamStatusColor(stream.status);
  const statusIndicator = getStreamStatusIndicator(stream.status);
  const progressText = formatProgress(stream.progressPercent);
  const durationText = formatStreamDuration(stream.durationMs);

  const bgColor = isSelected ? colors.bg.highlight : colors.bg.secondary;
  const borderColor = isSelected ? colors.border.active : colors.border.normal;

  const broadcastIndicator = stream.hasUnreadBroadcasts
    ? ` 📬${stream.pendingBroadcastCount}`
    : '';

  if (compact) {
    return (
      <box
        style={{
          flexDirection: 'row',
          backgroundColor: bgColor,
          padding: 0,
        }}
      >
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.fg.muted}> {stream.agentName.slice(0, 10)}</span>
          <span fg={colors.fg.secondary}> {truncate(stream.taskTitle, 20)}</span>
          <span fg={colors.accent.tertiary}> {progressText}</span>
          <span fg={colors.status.warning}>{broadcastIndicator}</span>
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        flexDirection: 'column',
        backgroundColor: bgColor,
        border: true,
        borderColor,
        padding: 1,
        marginBottom: 1,
      }}
    >
      <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.accent.secondary}> {stream.agentName}</span>
          <span fg={colors.fg.muted}> [{stream.taskId}]</span>
          <span fg={colors.status.warning}>{broadcastIndicator}</span>
        </text>
        <text fg={colors.fg.muted}>{durationText}</text>
      </box>

      <box style={{ flexDirection: 'row' }}>
        <text fg={colors.fg.primary}>{truncate(stream.taskTitle, 50)}</text>
      </box>

      <box style={{ flexDirection: 'row', gap: 1 }}>
        <text fg={statusColor}>{createProgressBar(stream.progressPercent, 20)}</text>
        <text fg={colors.accent.tertiary}>{progressText}</text>
        <text fg={colors.fg.muted}> | </text>
        <text fg={colors.fg.secondary}>{truncate(stream.currentActivity, 30)}</text>
      </box>

      {stream.outputPreview && (
        <box style={{ flexDirection: 'row', marginTop: 1 }}>
          <text fg={colors.fg.dim}>{truncate(stream.outputPreview, 60)}</text>
        </box>
      )}
    </box>
  );
}
