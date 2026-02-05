/**
 * ABOUTME: Settings view component for configuring Ralph TUI.
 * Displays current configuration values and allows modification.
 * Changes are persisted to .ralph-tui/config.toml in the project directory.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { colors } from '../theme.js';
import type { StoredConfig, SubagentDetailLevel, NotificationSoundMode } from '../../config/types.js';
import type { AgentPluginMeta } from '../../plugins/agents/types.js';
import type { TrackerPluginMeta } from '../../plugins/trackers/types.js';

/**
 * Setting item types for different field kinds
 */
type SettingType = 'select' | 'number' | 'boolean' | 'text';

/**
 * Individual setting definition
 */
interface SettingDefinition {
  key: string;
  label: string;
  type: SettingType;
  description: string;
  options?: string[]; // For select type
  min?: number; // For number type
  max?: number; // For number type
  getValue: (config: StoredConfig) => string | number | boolean | undefined;
  setValue: (config: StoredConfig, value: string | number | boolean) => StoredConfig;
  requiresRestart?: boolean;
}

/**
 * Props for the SettingsView component
 */
export interface SettingsViewProps {
  /** Whether the settings view is visible */
  visible: boolean;
  /** Current stored configuration */
  config: StoredConfig;
  /** Available agent plugins */
  agents: AgentPluginMeta[];
  /** Available tracker plugins */
  trackers: TrackerPluginMeta[];
  /** Callback when settings should be saved */
  onSave: (config: StoredConfig) => Promise<void>;
  /** Callback when settings view should close */
  onClose: () => void;
}

/**
 * Build setting definitions based on available plugins
 */
function buildSettingDefinitions(
  agents: AgentPluginMeta[],
  trackers: TrackerPluginMeta[]
): SettingDefinition[] {
  return [
    {
      key: 'tracker',
      label: 'Tracker',
      type: 'select',
      description: 'Issue tracker plugin to use',
      options: trackers.map((t) => t.id),
      getValue: (config) => config.tracker ?? config.defaultTracker,
      setValue: (config, value) => ({
        ...config,
        tracker: value as string,
        defaultTracker: value as string,
      }),
      requiresRestart: true,
    },
    {
      key: 'agent',
      label: 'Worker',
      type: 'select',
      description: 'AI agent plugin to execute tasks',
      options: agents.map((a) => a.id),
      getValue: (config) => config.agent ?? config.defaultAgent,
      setValue: (config, value) => ({
        ...config,
        agent: value as string,
        defaultAgent: value as string,
      }),
      requiresRestart: true,
    },
    {
      key: 'reviewer',
      label: 'Reviewer',
      type: 'select',
      description: 'Optional reviewer agent (choose none to disable)',
      options: ['none', ...agents.map((a) => a.id)],
      getValue: (config) =>
        config.review?.enabled
          ? (config.review.agent ?? 'none')
          : 'none',
      setValue: (config, value) => {
        if (value === 'none') {
          return {
            ...config,
            review: {
              ...config.review,
              enabled: false,
              agent: undefined,
            },
          };
        }
        return {
          ...config,
          review: {
            ...config.review,
            enabled: true,
            agent: value as string,
          },
        };
      },
      requiresRestart: true,
    },
    {
      key: 'maxIterations',
      label: 'Max Iterations',
      type: 'number',
      description: 'Maximum iterations per run (0 = unlimited)',
      min: 0,
      max: 1000,
      getValue: (config) => config.maxIterations,
      setValue: (config, value) => ({
        ...config,
        maxIterations: value as number,
      }),
      requiresRestart: false,
    },
    {
      key: 'iterationDelay',
      label: 'Iteration Delay',
      type: 'number',
      description: 'Delay between iterations in milliseconds',
      min: 0,
      max: 60000,
      getValue: (config) => config.iterationDelay,
      setValue: (config, value) => ({
        ...config,
        iterationDelay: value as number,
      }),
      requiresRestart: false,
    },
    {
      key: 'autoCommit',
      label: 'Auto Commit',
      type: 'boolean',
      description: 'Automatically commit after each task completion',
      getValue: (config) => config.autoCommit,
      setValue: (config, value) => ({
        ...config,
        autoCommit: value as boolean,
      }),
      requiresRestart: false,
    },
    {
      key: 'subagentTracingDetail',
      label: 'Subagent Detail',
      type: 'select',
      description: 'Detail level for subagent tracing display (cycle with "t")',
      options: ['off', 'minimal', 'moderate', 'full'],
      getValue: (config) => config.subagentTracingDetail ?? 'off',
      setValue: (config, value) => ({
        ...config,
        subagentTracingDetail: value as SubagentDetailLevel,
      }),
      requiresRestart: false,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      type: 'boolean',
      description: 'Enable desktop notifications for task completion',
      getValue: (config) => config.notifications?.enabled ?? true,
      setValue: (config, value) => ({
        ...config,
        notifications: {
          ...config.notifications,
          enabled: value as boolean,
        },
      }),
      requiresRestart: false,
    },
    {
      key: 'notificationSound',
      label: 'Notif Sound',
      type: 'select',
      description: 'Sound mode: off, system (OS default), or ralph (Wiggum quotes)',
      options: ['off', 'system', 'ralph'],
      getValue: (config) => config.notifications?.sound ?? 'off',
      setValue: (config, value) => ({
        ...config,
        notifications: {
          ...config.notifications,
          sound: value as NotificationSoundMode,
        },
      }),
      requiresRestart: false,
    },
  ];
}

/**
 * Format a setting value for display
 */
function formatValue(value: string | number | boolean | undefined): string {
  if (value === undefined) return '(not set)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Settings view component
 */
export function SettingsView({
  visible,
  config,
  agents,
  trackers,
  onSave,
  onClose,
}: SettingsViewProps): ReactNode {
  const [editingConfig, setEditingConfig] = useState<StoredConfig>(config);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const settings = buildSettingDefinitions(agents, trackers);

  // Reset state when config changes externally
  useEffect(() => {
    setEditingConfig(config);
    setHasChanges(false);
    setError(null);
  }, [config]);

  // Get current setting
  const currentSetting = settings[selectedIndex];

  // Handle keyboard navigation and editing
  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string }) => {
      if (!visible) return;

      // Clear error on any key press
      setError(null);

      if (editMode) {
        // In edit mode, handle value editing
        switch (key.name) {
          case 'escape':
            setEditMode(false);
            setEditValue('');
            break;

          case 'return':
          case 'enter': {
            // Apply the edited value
            const setting = currentSetting;
            if (!setting) break;

            let newValue: string | number | boolean;
            if (setting.type === 'number') {
              const num = parseInt(editValue, 10);
              if (isNaN(num)) {
                setError('Please enter a valid number');
                break;
              }
              if (setting.min !== undefined && num < setting.min) {
                setError(`Value must be at least ${setting.min}`);
                break;
              }
              if (setting.max !== undefined && num > setting.max) {
                setError(`Value must be at most ${setting.max}`);
                break;
              }
              newValue = num;
            } else if (setting.type === 'boolean') {
              newValue = editValue.toLowerCase() === 'yes' || editValue.toLowerCase() === 'true' || editValue === '1';
            } else {
              newValue = editValue;
            }

            setEditingConfig(setting.setValue(editingConfig, newValue));
            setHasChanges(true);
            setEditMode(false);
            setEditValue('');
            break;
          }

          case 'backspace':
            setEditValue((prev) => prev.slice(0, -1));
            break;

          default:
            // Append character to edit value
            if (key.sequence && key.sequence.length === 1) {
              setEditValue((prev) => prev + key.sequence);
            }
            break;
        }
        return;
      }

      // Normal navigation mode
      switch (key.name) {
        case 'escape':
        case 'q':
          if (hasChanges) {
            // Discard changes and close
            setEditingConfig(config);
            setHasChanges(false);
          }
          onClose();
          break;

        case 'up':
        case 'k':
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;

        case 'down':
        case 'j':
          setSelectedIndex((prev) => Math.min(settings.length - 1, prev + 1));
          break;

        case 'return':
        case 'enter':
        case 'e': {
          // Enter edit mode for current setting
          const setting = currentSetting;
          if (!setting) break;

          if (setting.type === 'select' && setting.options) {
            // Cycle through select options
            const currentValue = setting.getValue(editingConfig);
            const currentIdx = setting.options.indexOf(String(currentValue ?? ''));
            const nextIdx = (currentIdx + 1) % setting.options.length;
            const nextValue = setting.options[nextIdx];
            if (nextValue !== undefined) {
              setEditingConfig(setting.setValue(editingConfig, nextValue));
              setHasChanges(true);
            }
          } else if (setting.type === 'boolean') {
            // Toggle boolean
            const currentValue = setting.getValue(editingConfig);
            setEditingConfig(setting.setValue(editingConfig, !currentValue));
            setHasChanges(true);
          } else {
            // Enter text edit mode
            const currentValue = setting.getValue(editingConfig);
            setEditValue(currentValue !== undefined ? String(currentValue) : '');
            setEditMode(true);
          }
          break;
        }

        case 'left':
        case 'h': {
          // For select type, go to previous option
          const setting = currentSetting;
          if (!setting || setting.type !== 'select' || !setting.options) break;

          const currentValue = setting.getValue(editingConfig);
          const currentIdx = setting.options.indexOf(String(currentValue ?? ''));
          const prevIdx = currentIdx <= 0 ? setting.options.length - 1 : currentIdx - 1;
          const prevValue = setting.options[prevIdx];
          if (prevValue !== undefined) {
            setEditingConfig(setting.setValue(editingConfig, prevValue));
            setHasChanges(true);
          }
          break;
        }

        case 'right':
        case 'l': {
          // For select type, go to next option
          const setting = currentSetting;
          if (!setting || setting.type !== 'select' || !setting.options) break;

          const currentValue = setting.getValue(editingConfig);
          const currentIdx = setting.options.indexOf(String(currentValue ?? ''));
          const nextIdx = (currentIdx + 1) % setting.options.length;
          const nextValue = setting.options[nextIdx];
          if (nextValue !== undefined) {
            setEditingConfig(setting.setValue(editingConfig, nextValue));
            setHasChanges(true);
          }
          break;
        }

        case 's': {
          // Save changes
          if (!hasChanges) break;

          setSaving(true);
          onSave(editingConfig)
            .then(() => {
              setSaving(false);
              setHasChanges(false);
            })
            .catch((err: Error) => {
              setSaving(false);
              setError(`Failed to save: ${err.message}`);
            });
          break;
        }

        case 'space': {
          // Toggle boolean or cycle select
          const setting = currentSetting;
          if (!setting) break;

          if (setting.type === 'boolean') {
            const currentValue = setting.getValue(editingConfig);
            setEditingConfig(setting.setValue(editingConfig, !currentValue));
            setHasChanges(true);
          } else if (setting.type === 'select' && setting.options) {
            const currentValue = setting.getValue(editingConfig);
            const currentIdx = setting.options.indexOf(String(currentValue ?? ''));
            const nextIdx = (currentIdx + 1) % setting.options.length;
            const nextValue = setting.options[nextIdx];
            if (nextValue !== undefined) {
              setEditingConfig(setting.setValue(editingConfig, nextValue));
              setHasChanges(true);
            }
          }
          break;
        }
      }
    },
    [
      visible,
      editMode,
      editValue,
      selectedIndex,
      settings,
      currentSetting,
      editingConfig,
      config,
      hasChanges,
      onClose,
      onSave,
    ]
  );

  useKeyboard(handleKeyboard);

  if (!visible) {
    return null;
  }

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000000B3', // 70% opacity black (OpenTUI doesn't support rgba syntax)
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          padding: 2,
          backgroundColor: colors.bg.secondary,
          borderColor: colors.accent.primary,
          minWidth: 60,
          maxWidth: 70,
        }}
        border
      >
        {/* Header */}
        <box style={{ marginBottom: 1, justifyContent: 'center' }}>
          <text fg={colors.accent.primary}>⚙ Settings</text>
        </box>

        {/* Settings list */}
        {settings.map((setting, index) => {
          const isSelected = index === selectedIndex;
          const value = setting.getValue(editingConfig);
          const displayValue = editMode && isSelected ? editValue : formatValue(value);

          return (
            <box
              key={setting.key}
              style={{
                flexDirection: 'row',
                backgroundColor: isSelected ? colors.bg.highlight : undefined,
                paddingLeft: 1,
                paddingRight: 1,
              }}
            >
              {/* Selection indicator */}
              <text fg={isSelected ? colors.accent.primary : colors.fg.dim}>
                {isSelected ? '▶ ' : '  '}
              </text>

              {/* Label */}
              <box style={{ width: 18 }}>
                <text fg={isSelected ? colors.fg.primary : colors.fg.secondary}>
                  {setting.label}
                </text>
              </box>

              {/* Value */}
              <box style={{ flexGrow: 1 }}>
                {setting.type === 'select' && setting.options ? (
                  <box style={{ flexDirection: 'row' }}>
                    <text fg={colors.fg.muted}>{isSelected ? '‹ ' : '  '}</text>
                    <text fg={isSelected ? colors.accent.tertiary : colors.fg.primary}>
                      {displayValue}
                    </text>
                    <text fg={colors.fg.muted}>{isSelected ? ' ›' : ''}</text>
                  </box>
                ) : (
                  <text
                    fg={
                      editMode && isSelected
                        ? colors.accent.secondary
                        : isSelected
                          ? colors.accent.tertiary
                          : colors.fg.primary
                    }
                  >
                    {displayValue}
                    {editMode && isSelected ? '▏' : ''}
                  </text>
                )}
              </box>

              {/* Restart indicator */}
              {setting.requiresRestart && (
                <text fg={colors.status.warning}> ⟳</text>
              )}
            </box>
          );
        })}

        {/* Description */}
        {currentSetting && (
          <box style={{ marginTop: 1, paddingLeft: 3 }}>
            <text fg={colors.fg.muted}>{currentSetting.description}</text>
          </box>
        )}

        {/* Error message */}
        {error && (
          <box style={{ marginTop: 1, paddingLeft: 3 }}>
            <text fg={colors.status.error}>{error}</text>
          </box>
        )}

        {/* Status line */}
        <box style={{ marginTop: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
          <text fg={colors.fg.muted}>
            {hasChanges ? '● Modified' : ''}
            {saving ? ' Saving...' : ''}
          </text>
          <text fg={colors.status.warning}>⟳ = requires restart</text>
        </box>

        {/* Footer with keyboard hints */}
        <box style={{ marginTop: 1, justifyContent: 'center' }}>
          <text fg={colors.fg.muted}>
            {editMode
              ? 'Enter: Apply  Esc: Cancel'
              : '↑↓: Navigate  Enter/Space: Edit  ←→: Cycle  s: Save  q/Esc: Close'}
          </text>
        </box>
      </box>
    </box>
  );
}
