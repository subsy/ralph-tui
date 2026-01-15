/**
 * ABOUTME: RollbackPromptPanel displays a prompt when post-merge validation fails.
 * Offers options to rollback to pre-merge state (with or without preserving the
 * failed merge attempt for debugging), continue anyway, or abort.
 */

import { useKeyboard } from '@opentui/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { colors } from '../theme.js';
import type { RollbackPromptPanelProps } from '../merge-progress-types.js';

type SelectedOption = 'rollback' | 'rollback_debug' | 'continue' | 'abort';

export function RollbackPromptPanel({
  validationResult,
  backupBranch,
  backupRef,
  onRollback,
  onRollbackPreserveDebug,
  onContinueAnyway,
  onAbort,
  onDismissResult,
  isRollingBack = false,
  rollbackResult,
}: RollbackPromptPanelProps): ReactNode {
  const [selectedOption, setSelectedOption] = useState<SelectedOption>('rollback');

  const options: { key: SelectedOption; label: string; description: string; shortcut: string }[] = [
    {
      key: 'rollback',
      label: 'Rollback to pre-merge state',
      description: 'Reset to backup branch, discard merge attempt',
      shortcut: '1',
    },
    {
      key: 'rollback_debug',
      label: 'Rollback & preserve for debugging',
      description: 'Reset but keep failed merge on a debug branch',
      shortcut: '2',
    },
    {
      key: 'continue',
      label: 'Continue anyway',
      description: 'Keep the merge despite validation failure',
      shortcut: '3',
    },
    {
      key: 'abort',
      label: 'Abort',
      description: 'Stop merge process without changes',
      shortcut: 'q',
    },
  ];

  const handleSelect = useCallback((option: SelectedOption) => {
    switch (option) {
      case 'rollback':
        onRollback();
        break;
      case 'rollback_debug':
        onRollbackPreserveDebug();
        break;
      case 'continue':
        onContinueAnyway();
        break;
      case 'abort':
        onAbort();
        break;
    }
  }, [onRollback, onRollbackPreserveDebug, onContinueAnyway, onAbort]);

  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      if (rollbackResult) {
        onDismissResult?.();
        return;
      }
      if (isRollingBack) return;

      const optionKeys = options.map(o => o.key);
      const currentIndex = optionKeys.indexOf(selectedOption);

      switch (key.name) {
        case 'up':
        case 'k':
          setSelectedOption(optionKeys[Math.max(0, currentIndex - 1)]);
          break;
        case 'down':
        case 'j':
          setSelectedOption(optionKeys[Math.min(optionKeys.length - 1, currentIndex + 1)]);
          break;
        case 'return':
        case 'enter':
          handleSelect(selectedOption);
          break;
        case '1':
          handleSelect('rollback');
          break;
        case '2':
          handleSelect('rollback_debug');
          break;
        case '3':
          handleSelect('continue');
          break;
        case 'q':
        case 'escape':
          handleSelect('abort');
          break;
      }
    },
    [selectedOption, handleSelect, isRollingBack, rollbackResult, onDismissResult, options]
  );

  useKeyboard(handleKeyboard);

  if (rollbackResult) {
    return (
      <box
        style={{
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: colors.bg.primary,
          padding: 2,
        }}
      >
        <box
          style={{
            flexDirection: 'column',
            backgroundColor: colors.bg.secondary,
            border: true,
            borderColor: rollbackResult.success ? colors.status.success : colors.status.error,
            padding: 2,
          }}
        >
          <text>
            <span fg={rollbackResult.success ? colors.status.success : colors.status.error}>
              {rollbackResult.success ? '\u2713 Rollback Complete' : '\u2717 Rollback Failed'}
            </span>
          </text>

          {rollbackResult.success && (
            <box style={{ flexDirection: 'column', marginTop: 1 }}>
              <text fg={colors.fg.secondary}>
                Restored to: <span fg={colors.accent.primary}>{rollbackResult.toSha.slice(0, 7)}</span>
              </text>
              {rollbackResult.preservedBranch && (
                <text fg={colors.fg.secondary}>
                  Debug branch: <span fg={colors.status.info}>{rollbackResult.preservedBranch}</span>
                </text>
              )}
            </box>
          )}

          {!rollbackResult.success && rollbackResult.error && (
            <text fg={colors.status.error}>{rollbackResult.error}</text>
          )}

          <box style={{ marginTop: 2 }}>
            <text fg={colors.fg.muted}>Press any key to continue...</text>
          </box>
        </box>
      </box>
    );
  }

  if (isRollingBack) {
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
        <text fg={colors.accent.primary}>Rolling back to pre-merge state...</text>
        <text fg={colors.fg.muted}>Target: {backupRef.slice(0, 7)}</text>
      </box>
    );
  }

  return (
    <box
      style={{
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: colors.bg.primary,
        padding: 1,
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.status.warning,
          padding: 2,
          marginBottom: 1,
        }}
      >
        <text>
          <span fg={colors.status.warning}>{'\u26A0'} Post-Merge Validation Failed</span>
        </text>

        <box style={{ flexDirection: 'column', marginTop: 1 }}>
          <text fg={colors.fg.secondary}>
            Command: <span fg={colors.fg.primary}>{validationResult.command}</span>
          </text>
          <text fg={colors.fg.secondary}>
            Exit Code: <span fg={colors.status.error}>{validationResult.exitCode}</span>
          </text>
          <text fg={colors.fg.secondary}>
            Duration: <span fg={colors.fg.primary}>{validationResult.durationMs}ms</span>
          </text>
        </box>

        {validationResult.stderr && (
          <box
            style={{
              flexDirection: 'column',
              marginTop: 1,
              backgroundColor: colors.bg.tertiary,
              padding: 1,
              maxHeight: 6,
            }}
          >
            <text fg={colors.fg.muted}>stderr:</text>
            <text fg={colors.status.error}>
              {validationResult.stderr.slice(0, 200)}
              {validationResult.stderr.length > 200 ? '...' : ''}
            </text>
          </box>
        )}
      </box>

      {backupBranch && (
        <box style={{ marginBottom: 1 }}>
          <text fg={colors.fg.muted}>
            Backup available: <span fg={colors.status.info}>{backupBranch.name}</span>
            <span fg={colors.fg.dim}> ({backupBranch.sha.slice(0, 7)})</span>
          </text>
        </box>
      )}

      <box
        style={{
          flexDirection: 'column',
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.border.normal,
          padding: 1,
        }}
      >
        <text fg={colors.fg.muted}>Choose an action:</text>

        {options.map((option) => {
          const isSelected = selectedOption === option.key;
          return (
            <box
              key={option.key}
              style={{
                flexDirection: 'row',
                backgroundColor: isSelected ? colors.bg.highlight : undefined,
                padding: 1,
                marginTop: option.key === 'rollback' ? 1 : 0,
              }}
            >
              <text>
                <span fg={isSelected ? colors.accent.primary : colors.fg.dim}>
                  {isSelected ? '\u25B6 ' : '  '}
                </span>
                <span fg={colors.accent.tertiary}>[{option.shortcut}]</span>
                <span fg={isSelected ? colors.fg.primary : colors.fg.secondary}> {option.label}</span>
              </text>
            </box>
          );
        })}
      </box>

      <box
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          marginTop: 1,
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
          <span> Select </span>
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.fg.dim}>[</span>
          <span fg={colors.accent.tertiary}>1-3</span>
          <span fg={colors.fg.dim}>]</span>
          <span> Quick Select </span>
        </text>
      </box>
    </box>
  );
}
