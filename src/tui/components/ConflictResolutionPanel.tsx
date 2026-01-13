/**
 * ABOUTME: ConflictResolutionPanel displays conflict details with user action controls.
 * Shows file path, AI suggestion, confidence level, and keyboard shortcuts for resolution.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { ConflictResolutionPanelProps } from '../merge-progress-types.js';
import { getConfidenceDisplay } from '../merge-progress-types.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}

function getStrategyLabel(strategy?: 'ours' | 'theirs' | 'merged' | 'semantic'): string {
  switch (strategy) {
    case 'ours':
      return 'Use Ours';
    case 'theirs':
      return 'Use Theirs';
    case 'merged':
      return 'Auto-Merged';
    case 'semantic':
      return 'Semantic Merge';
    default:
      return 'Unknown';
  }
}

export function ConflictResolutionPanel({
  worktree,
  conflicts,
  selectedIndex,
  onAccept: _onAccept,
  onReject: _onReject,
  onUseOurs: _onUseOurs,
  onUseTheirs: _onUseTheirs,
  onManualResolve: _onManualResolve,
  onAbortAll: _onAbortAll,
  onSelectConflict: _onSelectConflict,
  onBack: _onBack,
}: ConflictResolutionPanelProps): ReactNode {
  const selectedConflict = conflicts[selectedIndex];
  const resolvedCount = conflicts.filter(c => c.resolved).length;
  const pendingCount = conflicts.filter(c => c.requiresUserInput && !c.resolved).length;

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
          flexDirection: 'column',
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.status.warning,
        }}
      >
        <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <text>
            <span fg={colors.status.warning}>{'\u26A0'} Conflict Resolution</span>
            <span fg={colors.fg.muted}> - </span>
            <span fg={colors.accent.secondary}>{truncate(worktree.branchName, 25)}</span>
          </text>
          <text fg={colors.fg.muted}>
            {resolvedCount}/{conflicts.length} resolved
          </text>
        </box>
        <box style={{ flexDirection: 'row', marginTop: 1 }}>
          <text>
            <span fg={colors.status.success}>{'\u2713'} {resolvedCount}</span>
            <span fg={colors.fg.muted}> | </span>
            <span fg={colors.status.warning}>{'\u25CB'} {pendingCount} pending</span>
          </text>
        </box>
      </box>

      <box
        style={{
          flexDirection: 'row',
          flexGrow: 1,
        }}
      >
        <box
          style={{
            flexDirection: 'column',
            width: '40%',
            padding: 1,
            border: true,
            borderColor: colors.border.normal,
          }}
        >
          <text fg={colors.fg.muted}>Files with conflicts:</text>
          <box style={{ marginTop: 1 }} />
          {conflicts.map((conflict, index) => {
            const isSelected = index === selectedIndex;
            const bgColor = isSelected ? colors.bg.highlight : 'transparent';
            const indicator = conflict.resolved ? '\u2713' : '\u25CB';
            const indicatorColor = conflict.resolved ? colors.status.success : colors.status.warning;

            return (
              <box
                key={conflict.filePath}
                style={{
                  flexDirection: 'row',
                  backgroundColor: bgColor,
                  padding: 0,
                }}
              >
                <text>
                  <span fg={indicatorColor}>{indicator} </span>
                  <span fg={isSelected ? colors.fg.primary : colors.fg.secondary}>
                    {truncate(conflict.filePath, 35)}
                  </span>
                </text>
              </box>
            );
          })}
        </box>

        <box
          style={{
            flexDirection: 'column',
            flexGrow: 1,
            padding: 1,
            border: true,
            borderColor: colors.border.active,
          }}
        >
          {selectedConflict ? (
            <>
              <text fg={colors.accent.primary}>{selectedConflict.filePath}</text>
              <box style={{ marginTop: 1 }} />

              <box style={{ flexDirection: 'row' }}>
                <text fg={colors.fg.muted}>Strategy: </text>
                <text fg={colors.accent.secondary}>
                  {getStrategyLabel(selectedConflict.strategy)}
                </text>
              </box>

              <box style={{ flexDirection: 'row' }}>
                <text fg={colors.fg.muted}>Confidence: </text>
                <text fg={getConfidenceDisplay(selectedConflict.confidence).color}>
                  {getConfidenceDisplay(selectedConflict.confidence).label}
                  {' '}({Math.round(selectedConflict.confidence * 100)}%)
                </text>
              </box>

              {selectedConflict.reasoning && (
                <>
                  <box style={{ marginTop: 1 }} />
                  <text fg={colors.fg.muted}>AI Reasoning:</text>
                  <text fg={colors.fg.secondary}>
                    {truncate(selectedConflict.reasoning, 60)}
                  </text>
                </>
              )}

              <box style={{ marginTop: 1 }} />
              <text fg={colors.fg.muted}>Status: </text>
              {selectedConflict.resolved ? (
                <text fg={colors.status.success}>Resolved</text>
              ) : selectedConflict.requiresUserInput ? (
                <text fg={colors.status.warning}>Requires your decision</text>
              ) : (
                <text fg={colors.status.info}>Auto-resolved</text>
              )}

              {!selectedConflict.resolved && (
                <>
                  <box style={{ marginTop: 2 }} />
                  <text fg={colors.fg.muted}>Available Actions:</text>
                  <box style={{ marginTop: 1 }} />
                  {selectedConflict.suggestion && (
                    <text>
                      <span fg={colors.accent.tertiary}>[a]</span>
                      <span fg={colors.fg.secondary}> Accept AI suggestion</span>
                    </text>
                  )}
                  <text>
                    <span fg={colors.accent.tertiary}>[o]</span>
                    <span fg={colors.fg.secondary}> Use ours (target branch)</span>
                  </text>
                  <text>
                    <span fg={colors.accent.tertiary}>[t]</span>
                    <span fg={colors.fg.secondary}> Use theirs (worktree branch)</span>
                  </text>
                  <text>
                    <span fg={colors.accent.tertiary}>[m]</span>
                    <span fg={colors.fg.secondary}> Manual resolution</span>
                  </text>
                  <text>
                    <span fg={colors.accent.tertiary}>[r]</span>
                    <span fg={colors.fg.secondary}> Reject AI suggestion</span>
                  </text>
                </>
              )}
            </>
          ) : (
            <text fg={colors.fg.muted}>No conflict selected</text>
          )}
        </box>
      </box>

      <box
        style={{
          flexDirection: 'row',
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.border.normal,
          justifyContent: 'space-between',
        }}
      >
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>{'\u2191\u2193'}</span> Navigate
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>[a]</span> Accept
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>[o]</span> Ours
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>[t]</span> Theirs
          <span fg={colors.fg.dim}> | </span>
          <span fg={colors.fg.dim}>[m]</span> Manual
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>[Esc]</span> Back/Abort
        </text>
      </box>
    </box>
  );
}
