/**
 * ABOUTME: TUI component for monitoring multi-agent orchestration.
 * Displays phase progress, worker status, and live output from selected worker.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators } from '../theme.js';
import type { WorkerState, Phase } from '../../orchestrator/types.js';

export interface OrchestratorViewProps {
  currentPhase?: Phase;
  phaseIndex: number;
  totalPhases: number;
  workers: WorkerState[];
  selectedWorkerIndex: number;
  selectedWorkerOutput?: string;
  totalStories: number;
  completedStories: number;
  onSelectWorker?: (index: number) => void;
}

function getWorkerIcon(status: WorkerState['status']): string {
  const icons: Record<WorkerState['status'], string> = {
    running: statusIndicators.running,
    completed: statusIndicators.complete,
    failed: statusIndicators.blocked,
    killed: statusIndicators.stopped,
    idle: statusIndicators.idle,
  };
  return icons[status];
}

function getWorkerColor(status: WorkerState['status']): string {
  const map: Record<WorkerState['status'], string> = {
    running: colors.status.info,
    completed: colors.status.success,
    failed: colors.status.error,
    killed: colors.status.warning,
    idle: colors.fg.muted,
  };
  return map[status];
}

function WorkerRow({ worker, isSelected }: { worker: WorkerState; isSelected: boolean }): ReactNode {
  const icon = getWorkerIcon(worker.status);
  const color = getWorkerColor(worker.status);
  const range = `${worker.range.from}→${worker.range.to}`;
  const task = worker.currentTaskId ? ` [${worker.currentTaskId}]` : '';
  const pct = worker.status === 'running' ? ` ${worker.progress}%` : '';

  return (
    <box style={{ width: '100%', flexDirection: 'row', paddingLeft: 1, paddingRight: 1, backgroundColor: isSelected ? colors.bg.highlight : 'transparent' }}>
      <text>
        <span fg={color}>{icon}</span>
        <span fg={colors.fg.secondary}> {worker.id}</span>
        <span fg={colors.fg.muted}> ({range})</span>
        {task && <span fg={colors.accent.tertiary}>{task}</span>}
        {pct && <span fg={colors.status.info}>{pct}</span>}
        {worker.error && <span fg={colors.status.error}> {worker.error.slice(0, 30)}</span>}
      </text>
    </box>
  );
}

function PhaseHeader({ currentPhase, phaseIndex, totalPhases, totalStories, completedStories }: {
  currentPhase?: Phase; phaseIndex: number; totalPhases: number; totalStories: number; completedStories: number;
}): ReactNode {
  const name = currentPhase?.name ?? 'No active phase';
  const pct = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;
  const mode = currentPhase?.parallel ? '⫘' : '→';

  return (
    <box style={{ width: '100%', backgroundColor: colors.bg.secondary, padding: 1, border: true, borderColor: colors.border.normal, flexDirection: 'column' }}>
      <box style={{ flexDirection: 'row' }}>
        <text>
          <span fg={colors.accent.primary}>Phase {phaseIndex + 1}/{totalPhases}:</span>
          <span fg={colors.fg.primary}> {name}</span>
          <span fg={colors.fg.muted}> {mode}</span>
        </text>
      </box>
      <box><text fg={colors.fg.secondary}>Progress: {completedStories}/{totalStories} ({pct}%)</text></box>
    </box>
  );
}

function WorkerList({ workers, selectedIndex, width }: { workers: WorkerState[]; selectedIndex: number; width: number }): ReactNode {
  const active = workers.filter((w) => w.status === 'running').length;
  const title = active > 0 ? `Workers (${active} active)` : `Workers (${workers.length})`;
  void width;

  return (
    <box title={title} style={{ flexGrow: 1, flexShrink: 1, minWidth: 30, maxWidth: 50, flexDirection: 'column', backgroundColor: colors.bg.primary, border: true, borderColor: colors.accent.primary }}>
      <scrollbox style={{ flexGrow: 1, width: '100%' }}>
        {workers.length === 0 ? (
          <box style={{ padding: 1 }}><text fg={colors.fg.muted}>No workers spawned</text></box>
        ) : (
          workers.map((w, i) => <WorkerRow key={w.id} worker={w} isSelected={i === selectedIndex} />)
        )}
      </scrollbox>
      <box style={{ padding: 1, backgroundColor: colors.bg.tertiary }}>
        <text fg={colors.fg.dim}>↑↓ select worker</text>
      </box>
    </box>
  );
}

function WorkerOutput({ worker, output }: { worker?: WorkerState; output?: string }): ReactNode {
  const title = worker ? `Output: ${worker.id}` : 'Output';

  return (
    <box title={title} style={{ flexGrow: 2, flexShrink: 1, minWidth: 40, flexDirection: 'column', backgroundColor: colors.bg.primary, border: true, borderColor: colors.border.normal }}>
      <scrollbox style={{ flexGrow: 1, padding: 1 }}>
        {output ? (
          <box style={{ flexDirection: 'column' }}>
            {output.split('\n').map((line, i) => <text key={i} fg={colors.fg.secondary}>{line}</text>)}
          </box>
        ) : worker ? (
          <text fg={colors.fg.muted}>Waiting for output from {worker.id}...</text>
        ) : (
          <text fg={colors.fg.muted}>Select a worker to view output</text>
        )}
      </scrollbox>
    </box>
  );
}

export function OrchestratorView({
  currentPhase, phaseIndex, totalPhases, workers, selectedWorkerIndex, selectedWorkerOutput, totalStories, completedStories,
}: OrchestratorViewProps): ReactNode {
  const selected = workers[selectedWorkerIndex];

  return (
    <box style={{ flexDirection: 'column', flexGrow: 1, backgroundColor: colors.bg.primary }}>
      <PhaseHeader currentPhase={currentPhase} phaseIndex={phaseIndex} totalPhases={totalPhases} totalStories={totalStories} completedStories={completedStories} />
      <box style={{ flexDirection: 'row', flexGrow: 1 }}>
        <WorkerList workers={workers} selectedIndex={selectedWorkerIndex} width={45} />
        <WorkerOutput worker={selected} output={selectedWorkerOutput} />
      </box>
    </box>
  );
}
