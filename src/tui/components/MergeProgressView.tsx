/**
 * ABOUTME: MergeProgressView is the main container for merge phase monitoring.
 * Shows worktree merge status, backup branch info, and handles conflict resolution UI.
 */

import { useKeyboard } from '@opentui/react';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { colors } from '../theme.js';
import type {
  MergeProgressViewProps,
  MergeProgressViewMode,
} from '../merge-progress-types.js';
import { WorktreeMergeCard } from './WorktreeMergeCard.js';
import { ConflictResolutionPanel } from './ConflictResolutionPanel.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}

export function MergeProgressView({
  worktrees,
  backupBranch,
  targetBranch,
  selectedIndex,
  isResolvingConflict,
  currentConflicts,
  selectedConflictIndex = 0,
  onAcceptResolution,
  onRejectResolution,
  onUseOurs,
  onUseTheirs,
  onManualResolve,
  onAbortAll,
  onSelectWorktree,
  onSelectConflict,
  onClose,
}: MergeProgressViewProps): ReactNode {
  const [viewMode, setViewMode] = useState<MergeProgressViewMode>(
    isResolvingConflict ? 'conflict' : 'overview'
  );
  const [localSelectedIndex, setLocalSelectedIndex] = useState(selectedIndex);
  const [localConflictIndex, setLocalConflictIndex] = useState(selectedConflictIndex);

  useEffect(() => {
    if (isResolvingConflict && viewMode !== 'conflict') {
      setViewMode('conflict');
    }
  }, [isResolvingConflict, viewMode]);

  useEffect(() => {
    setLocalSelectedIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    setLocalConflictIndex(selectedConflictIndex);
  }, [selectedConflictIndex]);

  const handleDrillDown = useCallback((index: number) => {
    const wt = worktrees[index];
    if (wt?.status === 'conflict' && wt.conflictingFiles && wt.conflictingFiles.length > 0) {
      setLocalSelectedIndex(index);
      setViewMode('conflict');
    }
  }, [worktrees]);

  const handleBack = useCallback(() => {
    setViewMode('overview');
  }, []);

  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      if (viewMode === 'overview') {
        switch (key.name) {
          case 'up':
          case 'k':
            setLocalSelectedIndex(prev => {
              const next = Math.max(0, prev - 1);
              onSelectWorktree?.(next);
              return next;
            });
            break;
          case 'down':
          case 'j':
            setLocalSelectedIndex(prev => {
              const next = Math.min(worktrees.length - 1, prev + 1);
              onSelectWorktree?.(next);
              return next;
            });
            break;
          case 'return':
          case 'enter':
            handleDrillDown(localSelectedIndex);
            break;
          case 'escape':
          case 'q':
            onClose?.();
            break;
        }
      } else if (viewMode === 'conflict') {
        switch (key.name) {
          case 'up':
          case 'k':
            setLocalConflictIndex(prev => {
              const next = Math.max(0, prev - 1);
              onSelectConflict?.(next);
              return next;
            });
            break;
          case 'down':
          case 'j':
            setLocalConflictIndex(prev => {
              const max = (currentConflicts?.length ?? 1) - 1;
              const next = Math.min(max, prev + 1);
              onSelectConflict?.(next);
              return next;
            });
            break;
          case 'a':
            onAcceptResolution?.(localConflictIndex);
            break;
          case 'r':
            onRejectResolution?.(localConflictIndex);
            break;
          case 'o':
            onUseOurs?.(localConflictIndex);
            break;
          case 't':
            onUseTheirs?.(localConflictIndex);
            break;
          case 'm':
            onManualResolve?.(localConflictIndex);
            break;
          case 'escape':
            if (isResolvingConflict) {
              onAbortAll?.();
            } else {
              handleBack();
            }
            break;
          case 'q':
            onClose?.();
            break;
        }
      }
    },
    [
      viewMode,
      worktrees.length,
      localSelectedIndex,
      localConflictIndex,
      currentConflicts,
      isResolvingConflict,
      handleDrillDown,
      handleBack,
      onSelectWorktree,
      onSelectConflict,
      onAcceptResolution,
      onRejectResolution,
      onUseOurs,
      onUseTheirs,
      onManualResolve,
      onAbortAll,
      onClose,
    ]
  );

  useKeyboard(handleKeyboard);

  const selectedWorktree = worktrees[localSelectedIndex];

  const completedCount = worktrees.filter(w => w.status === 'complete' || w.status === 'resolved').length;
  const conflictCount = worktrees.filter(w => w.status === 'conflict').length;
  const pendingCount = worktrees.filter(w => w.status === 'pending' || w.status === 'in-progress').length;

  if (worktrees.length === 0) {
    return (
      <box
        style={{
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: colors.bg.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <text fg={colors.fg.muted}>No worktrees to merge</text>
        <text fg={colors.fg.dim}>Press Esc to close</text>
      </box>
    );
  }

  if (viewMode === 'conflict' && selectedWorktree && currentConflicts) {
    return (
      <ConflictResolutionPanel
        worktree={selectedWorktree}
        conflicts={currentConflicts}
        selectedIndex={localConflictIndex}
        onAccept={onAcceptResolution}
        onReject={onRejectResolution}
        onUseOurs={onUseOurs}
        onUseTheirs={onUseTheirs}
        onManualResolve={onManualResolve}
        onAbortAll={onAbortAll}
        onSelectConflict={(idx: number) => {
          setLocalConflictIndex(idx);
          onSelectConflict?.(idx);
        }}
        onBack={handleBack}
      />
    );
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
          flexDirection: 'column',
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <text>
            <span fg={colors.accent.primary}>Merge Progress</span>
            <span fg={colors.fg.muted}> - Merging into </span>
            <span fg={colors.accent.secondary}>{targetBranch}</span>
          </text>
          <text fg={colors.fg.muted}>
            {completedCount}/{worktrees.length} complete
          </text>
        </box>

        {backupBranch && (
          <box style={{ flexDirection: 'row', marginTop: 1 }}>
            <text>
              <span fg={colors.fg.muted}>Backup: </span>
              <span fg={colors.status.info}>{truncate(backupBranch.name, 40)}</span>
              <span fg={colors.fg.dim}> ({backupBranch.sha.slice(0, 7)})</span>
            </text>
          </box>
        )}

        <box style={{ flexDirection: 'row', marginTop: 1, gap: 2 }}>
          <text>
            <span fg={colors.status.success}>{'\u2713'} {completedCount}</span>
          </text>
          {conflictCount > 0 && (
            <text>
              <span fg={colors.status.warning}>{'\u26A0'} {conflictCount}</span>
            </text>
          )}
          {pendingCount > 0 && (
            <text>
              <span fg={colors.fg.muted}>{'\u25CB'} {pendingCount}</span>
            </text>
          )}
        </box>
      </box>

      <scrollbox
        style={{
          flexGrow: 1,
          flexDirection: 'column',
          padding: 1,
        }}
      >
        {worktrees.map((wt, index) => (
          <WorktreeMergeCard
            key={wt.worktree.id}
            progress={wt}
            isSelected={index === localSelectedIndex}
            onSelect={() => {
              setLocalSelectedIndex(index);
              onSelectWorktree?.(index);
            }}
          />
        ))}
      </scrollbox>

      <box
        style={{
          flexDirection: 'row',
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.border.normal,
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>[</span>
          <span fg={colors.accent.tertiary}>{'\u2191\u2193'}</span>
          <span fg={colors.fg.dim}>]</span>
          <span> Navigate </span>
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>[</span>
          <span fg={colors.accent.tertiary}>Enter</span>
          <span fg={colors.fg.dim}>]</span>
          <span> View Conflicts </span>
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>[</span>
          <span fg={colors.accent.tertiary}>Esc</span>
          <span fg={colors.fg.dim}>]</span>
          <span> Close </span>
        </text>
      </box>
    </box>
  );
}
