/**
 * ABOUTME: Main TUI app for orchestration mode.
 * Initializes orchestrator, subscribes to events, and handles keyboard input.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { OrchestratorView } from './OrchestratorView.js';
import type { Orchestrator, OrchestratorEvent, Phase, WorkerState } from '../../orchestrator/index.js';

export interface OrchestratorAppProps {
  orchestrator: Orchestrator;
  onQuit: () => void;
}

interface AppState {
  currentPhase?: Phase;
  phaseIndex: number;
  totalPhases: number;
  workers: WorkerState[];
  selectedWorkerIndex: number;
  totalStories: number;
  completedStories: number;
}

const INITIAL_STATE: AppState = {
  phaseIndex: 0, totalPhases: 0, workers: [], selectedWorkerIndex: 0, totalStories: 0, completedStories: 0,
};

function updateWorker(workers: WorkerState[], id: string, patch: Partial<WorkerState>): WorkerState[] {
  return workers.map((w) => (w.id === id ? { ...w, ...patch } : w));
}

function useOrchestratorEvents(orchestrator: Orchestrator, setState: React.Dispatch<React.SetStateAction<AppState>>): void {
  useEffect(() => {
    const handlers: Record<string, (e: OrchestratorEvent) => void> = {
      'phase:started': (e) => e.type === 'phase:started' && setState((s) => ({ ...s, phaseIndex: e.phaseIndex, totalPhases: e.totalPhases })),
      'worker:started': (e) => e.type === 'worker:started' && setState((s) => ({
        ...s, workers: [...s.workers, { id: e.workerId, range: e.range, status: 'running', progress: 0 }],
      })),
      'worker:progress': (e) => e.type === 'worker:progress' && setState((s) => ({
        ...s, workers: updateWorker(s.workers, e.workerId, { progress: e.progress, currentTaskId: e.currentTaskId }),
      })),
      'worker:completed': (e) => e.type === 'worker:completed' && setState((s) => ({
        ...s, workers: updateWorker(s.workers, e.workerId, { status: 'completed', progress: 100 }), completedStories: s.completedStories + 1,
      })),
      'worker:failed': (e) => e.type === 'worker:failed' && setState((s) => ({
        ...s, workers: updateWorker(s.workers, e.workerId, { status: 'failed', error: e.error }),
      })),
    };
    for (const [event, handler] of Object.entries(handlers)) orchestrator.on(event, handler);
    return () => { for (const [event, handler] of Object.entries(handlers)) orchestrator.removeListener(event, handler); };
  }, [orchestrator, setState]);
}

export function OrchestratorApp({ orchestrator, onQuit }: OrchestratorAppProps): ReactNode {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  useOrchestratorEvents(orchestrator, setState);

  const handleKeyboard = useCallback((key: { name: string }) => {
    if (key.name === 'q') { orchestrator.shutdown(); onQuit(); return; }
    const num = parseInt(key.name, 10);
    if (num >= 1 && num <= 9) setState((s) => (num - 1 < s.workers.length ? { ...s, selectedWorkerIndex: num - 1 } : s));
  }, [orchestrator, onQuit]);

  useKeyboard(handleKeyboard);

  return (
    <OrchestratorView
      currentPhase={state.currentPhase}
      phaseIndex={state.phaseIndex}
      totalPhases={state.totalPhases}
      workers={state.workers}
      selectedWorkerIndex={state.selectedWorkerIndex}
      totalStories={state.totalStories}
      completedStories={state.completedStories}
    />
  );
}
