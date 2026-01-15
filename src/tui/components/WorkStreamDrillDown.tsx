/**
 * ABOUTME: WorkStreamDrillDown component provides detailed view of a single work stream.
 * Shows full output, received and sent broadcasts, and agent activity details.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { WorkStreamDrillDownProps, DisplayBroadcast } from '../parallel-progress-types.js';
import {
  getStreamStatusColor,
  getStreamStatusIndicator,
  formatProgress,
  formatStreamDuration,
  getBroadcastPriorityColor,
} from '../parallel-progress-types.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function BroadcastItem({
  broadcast,
  isSent,
}: {
  broadcast: DisplayBroadcast;
  isSent: boolean;
}): ReactNode {
  const priorityColor = getBroadcastPriorityColor(broadcast.priority);
  const timeAgo = formatStreamDuration(Date.now() - broadcast.timestamp.getTime());
  const directionIndicator = isSent ? '→' : '←';
  const agentLabel = isSent ? 'to all' : `from ${broadcast.fromAgentName}`;

  return (
    <box
      style={{
        flexDirection: 'column',
        backgroundColor: colors.bg.tertiary,
        padding: 1,
        marginBottom: 1,
        border: broadcast.requiresAction,
        borderColor: broadcast.requiresAction ? colors.status.warning : colors.border.muted,
      }}
    >
      <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <text>
          <span fg={priorityColor}>{directionIndicator} [{broadcast.priority.toUpperCase()}]</span>
          <span fg={colors.fg.muted}> {broadcast.category}</span>
          <span fg={colors.fg.dim}> - {agentLabel}</span>
        </text>
        <text fg={colors.fg.dim}>{timeAgo} ago</text>
      </box>
      <text fg={colors.fg.primary}>{truncate(broadcast.summary, 70)}</text>
      {broadcast.affectedFiles.length > 0 && (
        <text fg={colors.fg.muted}>
          Files: {broadcast.affectedFiles.slice(0, 3).join(', ')}
          {broadcast.affectedFiles.length > 3 ? ` +${broadcast.affectedFiles.length - 3} more` : ''}
        </text>
      )}
      {broadcast.requiresAction && broadcast.suggestedAction && (
        <text fg={colors.status.warning}>
          Suggested action: {broadcast.suggestedAction}
        </text>
      )}
    </box>
  );
}

export function WorkStreamDrillDown({
  stream,
  output,
  broadcasts,
  sentBroadcasts,
  onBack: _onBack,
  onAcknowledgeBroadcast: _onAcknowledgeBroadcast,
}: WorkStreamDrillDownProps): ReactNode {
  const statusColor = getStreamStatusColor(stream.status);
  const statusIndicator = getStreamStatusIndicator(stream.status);
  const progressText = formatProgress(stream.progressPercent);
  const durationText = formatStreamDuration(stream.durationMs);

  const actionableBroadcasts = broadcasts.filter(b => b.requiresAction);
  const hasActionRequired = actionableBroadcasts.length > 0;

  const outputLines = output.split('\n').slice(-50);

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
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.accent.secondary}> {stream.agentName}</span>
          <span fg={colors.fg.muted}> [{stream.taskId}]</span>
          <span fg={colors.fg.primary}> - {truncate(stream.taskTitle, 40)}</span>
        </text>
        <text>
          <span fg={colors.accent.tertiary}>{progressText}</span>
          <span fg={colors.fg.muted}> | </span>
          <span fg={colors.fg.secondary}>{durationText}</span>
        </text>
      </box>

      {hasActionRequired && (
        <box
          style={{
            flexDirection: 'row',
            backgroundColor: colors.bg.tertiary,
            padding: 1,
            border: true,
            borderColor: colors.status.warning,
          }}
        >
          <text fg={colors.status.warning}>
            ⚠ {actionableBroadcasts.length} broadcast{actionableBroadcasts.length > 1 ? 's' : ''} require action - press 'a' to acknowledge
          </text>
        </box>
      )}

      <box
        style={{
          flexDirection: 'row',
          flexGrow: 1,
          gap: 1,
        }}
      >
        <box
          style={{
            flexDirection: 'column',
            width: '60%',
            border: true,
            borderColor: colors.border.muted,
          }}
        >
          <box
            style={{
              backgroundColor: colors.bg.secondary,
              padding: 1,
            }}
          >
            <text fg={colors.accent.primary}>Output</text>
            <text fg={colors.fg.muted}> ({stream.stdoutBytes} bytes)</text>
          </box>
          <scrollbox
            style={{
              flexGrow: 1,
              padding: 1,
            }}
          >
            {outputLines.length === 0 ? (
              <text fg={colors.fg.dim}>No output yet...</text>
            ) : (
              outputLines.map((line, idx) => (
                <text key={idx} fg={colors.fg.secondary}>
                  {truncate(line, 80)}
                </text>
              ))
            )}
          </scrollbox>
        </box>

        <box
          style={{
            flexDirection: 'column',
            width: '40%',
            border: true,
            borderColor: colors.border.muted,
          }}
        >
          <box
            style={{
              backgroundColor: colors.bg.secondary,
              padding: 1,
            }}
          >
            <text fg={colors.accent.primary}>Broadcasts</text>
            <text fg={colors.fg.muted}> (↓{broadcasts.length} ↑{sentBroadcasts.length})</text>
          </box>
          <scrollbox
            style={{
              flexGrow: 1,
              padding: 1,
            }}
          >
            {broadcasts.length === 0 && sentBroadcasts.length === 0 ? (
              <text fg={colors.fg.dim}>No broadcasts yet...</text>
            ) : (
              <>
                {broadcasts.map(b => (
                  <BroadcastItem key={b.id} broadcast={b} isSent={false} />
                ))}
                {sentBroadcasts.map(b => (
                  <BroadcastItem key={b.id} broadcast={b} isSent={true} />
                ))}
              </>
            )}
          </scrollbox>
        </box>
      </box>

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
          <span fg={colors.fg.dim}>Esc</span> Back to summary
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>a</span> Acknowledge broadcast
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>↑↓</span> Scroll
        </text>
        <text fg={colors.fg.muted}>
          Activity: <span fg={colors.fg.secondary}>{stream.currentActivity}</span>
        </text>
      </box>
    </box>
  );
}
