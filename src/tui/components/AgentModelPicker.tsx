/**
 * ABOUTME: Overlay component for switching the active agent and model.
 * Provides a two-column picker with known model lists and free-text fallback.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { colors } from '../theme.js';
import { getAgentRegistry } from '../../plugins/agents/registry.js';
import type { AgentPluginConfig } from '../../plugins/agents/types.js';
import { isPrintableKeySequence } from '../../utils/printable-key.js';

type PickerFocus = 'agent' | 'model';

/**
 * User selection returned by the picker.
 */
export interface AgentModelSelection {
  agentName: string;
  model: string | undefined;
  saveAsDefault: boolean;
}

/**
 * Props for the AgentModelPicker component.
 */
export interface AgentModelPickerProps {
  visible: boolean;
  agents: string[];
  agentConfigs?: AgentPluginConfig[];
  currentAgent?: string;
  currentModel?: string;
  onConfirm: (selection: AgentModelSelection) => Promise<void>;
  onClose: () => void;
}

const MAX_VISIBLE_ROWS = 10;

/**
 * Normalize free-text model input for runtime use.
 */
export function normalizeModelValue(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve a picker agent name to an agent config.
 */
export function resolveAgentConfigForSelection(
  agentName: string,
  agentConfigs: AgentPluginConfig[] = []
): AgentPluginConfig {
  const configured = agentConfigs.find(
    (agent) => agent.name === agentName || agent.plugin === agentName
  );
  if (configured) {
    return {
      ...configured,
      options: { ...configured.options },
    };
  }

  return {
    name: agentName,
    plugin: agentName,
    options: {},
  };
}

/**
 * Return known model names for an agent, or an empty array for free-text agents.
 */
export function listModelsForAgent(
  agentName: string,
  agentConfigs: AgentPluginConfig[] = []
): string[] {
  const agentConfig = resolveAgentConfigForSelection(agentName, agentConfigs);
  const plugin = getAgentRegistry().createInstance(agentConfig.plugin);
  if (!plugin) {
    return [];
  }

  try {
    return plugin.listModels();
  } finally {
    void plugin.dispose();
  }
}

/**
 * Validate a model selection with the selected agent plugin.
 */
export function validateModelForAgent(
  agentName: string,
  agentConfigs: AgentPluginConfig[] = [],
  model: string | undefined
): string | null {
  const agentConfig = resolveAgentConfigForSelection(agentName, agentConfigs);
  const plugin = getAgentRegistry().createInstance(agentConfig.plugin);
  if (!plugin) {
    return `Unknown agent plugin: ${agentConfig.plugin}`;
  }

  try {
    return plugin.validateModel(normalizeModelValue(model) ?? '');
  } finally {
    void plugin.dispose();
  }
}

function findInitialAgentIndex(agents: string[], currentAgent: string | undefined): number {
  if (agents.length === 0) return 0;
  const index = currentAgent ? agents.indexOf(currentAgent) : -1;
  return index >= 0 ? index : 0;
}

function getWindowStart(selectedIndex: number, itemCount: number): number {
  if (itemCount <= MAX_VISIBLE_ROWS) return 0;
  const halfWindow = Math.floor(MAX_VISIBLE_ROWS / 2);
  return Math.min(
    Math.max(0, selectedIndex - halfWindow),
    itemCount - MAX_VISIBLE_ROWS
  );
}

function renderListItem(
  label: string,
  selected: boolean,
  focused: boolean,
  key: string
): ReactNode {
  return (
    <box
      key={key}
      style={{
        flexDirection: 'row',
        backgroundColor: selected ? colors.bg.highlight : undefined,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={selected ? colors.accent.primary : colors.fg.dim}>
        {selected ? '> ' : '  '}
      </text>
      <text
        fg={
          selected && focused
            ? colors.fg.primary
            : selected
              ? colors.accent.tertiary
              : colors.fg.secondary
        }
      >
        {label}
      </text>
    </box>
  );
}

/**
 * Agent and model picker overlay.
 */
export function AgentModelPicker({
  visible,
  agents,
  agentConfigs = [],
  currentAgent,
  currentModel,
  onConfirm,
  onClose,
}: AgentModelPickerProps): ReactNode {
  const [focusedColumn, setFocusedColumn] = useState<PickerFocus>('agent');
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(() =>
    findInitialAgentIndex(agents, currentAgent)
  );
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [modelInput, setModelInput] = useState(currentModel ?? '');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const selectedAgent = agents[selectedAgentIndex];

  const modelOptions = useMemo(() => {
    if (!selectedAgent) return [];

    const knownModels = listModelsForAgent(selectedAgent, agentConfigs);
    const normalizedCurrent = normalizeModelValue(currentModel);
    if (
      normalizedCurrent &&
      knownModels.length > 0 &&
      !knownModels.includes(normalizedCurrent)
    ) {
      return [normalizedCurrent, ...knownModels];
    }
    return knownModels;
  }, [selectedAgent, agentConfigs, currentModel]);

  const selectedModel = modelOptions[selectedModelIndex] ?? '';
  const candidateModel = modelOptions.length > 0 ? selectedModel : modelInput;
  const validationError = useMemo(() => {
    if (!selectedAgent) return 'No agent selected';
    return validateModelForAgent(selectedAgent, agentConfigs, candidateModel);
  }, [selectedAgent, agentConfigs, candidateModel]);

  useEffect(() => {
    if (!visible) return;

    const initialAgentIndex = findInitialAgentIndex(agents, currentAgent);
    setSelectedAgentIndex(initialAgentIndex);
    setFocusedColumn('agent');
    setModelInput(currentModel ?? '');
    setSaveAsDefault(false);
    setApplyError(null);
    setApplying(false);
  }, [visible, agents, currentAgent, currentModel]);

  useEffect(() => {
    const normalizedCurrent = normalizeModelValue(currentModel);
    const currentIndex = normalizedCurrent
      ? modelOptions.indexOf(normalizedCurrent)
      : -1;
    setSelectedModelIndex(currentIndex >= 0 ? currentIndex : 0);
    setModelInput(currentModel ?? '');
  }, [selectedAgent, modelOptions, currentModel]);

  const handleApply = useCallback(async () => {
    if (!selectedAgent || applying) return;
    if (validationError) {
      setApplyError(validationError);
      return;
    }

    setApplying(true);
    setApplyError(null);
    try {
      await onConfirm({
        agentName: selectedAgent,
        model: normalizeModelValue(candidateModel),
        saveAsDefault,
      });
      onClose();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'Failed to switch agent');
      setApplying(false);
    }
  }, [
    applying,
    candidateModel,
    onClose,
    onConfirm,
    saveAsDefault,
    selectedAgent,
    validationError,
  ]);

  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string; shift?: boolean }) => {
      if (!visible) return;
      setApplyError(null);

      switch (key.name) {
        case 'escape':
          onClose();
          return;

        case 'tab':
          setFocusedColumn((prev) => (prev === 'agent' ? 'model' : 'agent'));
          return;

        case 'space':
          setSaveAsDefault((prev) => !prev);
          return;

        case 'return':
        case 'enter':
          void handleApply();
          return;

        case 'up':
        case 'k':
          if (focusedColumn === 'agent') {
            setSelectedAgentIndex((prev) => Math.max(0, prev - 1));
          } else if (modelOptions.length > 0) {
            setSelectedModelIndex((prev) => Math.max(0, prev - 1));
          }
          return;

        case 'down':
        case 'j':
          if (focusedColumn === 'agent' && agents.length > 0) {
            setSelectedAgentIndex((prev) => Math.min(agents.length - 1, prev + 1));
          } else if (modelOptions.length > 0) {
            setSelectedModelIndex((prev) =>
              Math.min(modelOptions.length - 1, prev + 1)
            );
          }
          return;

        case 'backspace':
          if (focusedColumn === 'model' && modelOptions.length === 0) {
            setModelInput((prev) => prev.slice(0, -1));
          }
          return;

        default:
          if (
            focusedColumn === 'model' &&
            modelOptions.length === 0 &&
            isPrintableKeySequence(key.sequence)
          ) {
            setModelInput((prev) => prev + key.sequence);
          }
      }
    },
    [
      agents.length,
      focusedColumn,
      handleApply,
      modelOptions.length,
      onClose,
      visible,
    ]
  );

  useKeyboard(handleKeyboard);

  if (!visible) return null;

  const agentWindowStart = getWindowStart(selectedAgentIndex, agents.length);
  const visibleAgents = agents.slice(agentWindowStart, agentWindowStart + MAX_VISIBLE_ROWS);
  const modelWindowStart = getWindowStart(selectedModelIndex, modelOptions.length);
  const visibleModels = modelOptions.slice(modelWindowStart, modelWindowStart + MAX_VISIBLE_ROWS);
  const displayError = applyError ?? validationError;

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
        backgroundColor: '#000000B3',
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          padding: 2,
          backgroundColor: colors.bg.secondary,
          borderColor: colors.accent.primary,
          minWidth: 72,
          maxWidth: 88,
        }}
        border
      >
        <box style={{ marginBottom: 1, justifyContent: 'center' }}>
          <text fg={colors.accent.primary}>Agent & Model</text>
        </box>

        <box style={{ flexDirection: 'row', gap: 2 }}>
          <box style={{ flexDirection: 'column', width: 28 }}>
            <box style={{ marginBottom: 1 }}>
              <text fg={focusedColumn === 'agent' ? colors.accent.primary : colors.fg.secondary}>
                Agents
              </text>
            </box>
            {visibleAgents.length > 0 ? (
              visibleAgents.map((agent, index) =>
                renderListItem(
                  agent,
                  agentWindowStart + index === selectedAgentIndex,
                  focusedColumn === 'agent',
                  agent
                )
              )
            ) : (
              <text fg={colors.status.error}>No agents configured</text>
            )}
          </box>

          <box style={{ flexDirection: 'column', flexGrow: 1, minWidth: 32 }}>
            <box style={{ marginBottom: 1 }}>
              <text fg={focusedColumn === 'model' ? colors.accent.primary : colors.fg.secondary}>
                Models
              </text>
            </box>

            {modelOptions.length > 0 ? (
              visibleModels.map((model, index) =>
                renderListItem(
                  model,
                  modelWindowStart + index === selectedModelIndex,
                  focusedColumn === 'model',
                  model
                )
              )
            ) : (
              <box
                style={{
                  backgroundColor: focusedColumn === 'model' ? colors.bg.tertiary : colors.bg.primary,
                  borderColor: focusedColumn === 'model' ? colors.accent.primary : colors.border.muted,
                  paddingLeft: 1,
                  paddingRight: 1,
                  minHeight: 3,
                }}
                border={focusedColumn === 'model'}
              >
                <text fg={focusedColumn === 'model' ? colors.fg.primary : colors.fg.secondary}>
                  {modelInput || '(default model)'}
                  {focusedColumn === 'model' ? '|' : ''}
                </text>
              </box>
            )}

            {displayError && (
              <box style={{ marginTop: 1 }}>
                <text fg={colors.status.error}>{displayError}</text>
              </box>
            )}
          </box>
        </box>

        <box style={{ marginTop: 1 }}>
          <text fg={saveAsDefault ? colors.accent.tertiary : colors.fg.muted}>
            [{saveAsDefault ? 'x' : ' '}] Save as default
          </text>
        </box>

        <box style={{ marginTop: 1, justifyContent: 'center' }}>
          <text fg={colors.fg.muted}>
            {applying ? 'Applying...' : 'Tab switch | Space save default | Enter apply | Esc cancel'}
          </text>
        </box>
      </box>
    </box>
  );
}
