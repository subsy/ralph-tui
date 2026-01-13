/**
 * ABOUTME: ParallelProgressView is the main container for parallel work monitoring.
 * Combines summary and drill-down views with keyboard navigation between them.
 */

import { useKeyboard } from '@opentui/react';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { colors } from '../theme.js';
import type {
  WorkStreamProgress,
  ParallelProgressStats,
  ParallelProgressViewMode,
  DisplayBroadcast,
  ParallelProgressEvent,
  ParallelProgressEventListener,
} from '../parallel-progress-types.js';
import { ParallelProgressSummary } from './ParallelProgressSummary.js';
import { WorkStreamDrillDown } from './WorkStreamDrillDown.js';

export interface ParallelProgressViewProps {
  streams: WorkStreamProgress[];
  stats: ParallelProgressStats;
  broadcasts: DisplayBroadcast[];
  onAcknowledgeBroadcast?: (broadcastId: string) => void;
  onRefresh?: () => void;
  onClose?: () => void;
  addEventListener?: (listener: ParallelProgressEventListener) => void;
  removeEventListener?: (listener: ParallelProgressEventListener) => void;
}

export function ParallelProgressView({
  streams,
  stats,
  broadcasts,
  onAcknowledgeBroadcast,
  onRefresh,
  onClose,
  addEventListener,
  removeEventListener,
}: ParallelProgressViewProps): ReactNode {
  const [viewMode, setViewMode] = useState<ParallelProgressViewMode>('summary');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [streamOutputs, setStreamOutputs] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!addEventListener || !removeEventListener) return;

    const handleEvent = (event: ParallelProgressEvent) => {
      switch (event.type) {
        case 'stream_updated':
          if (event.stream.outputPreview) {
            setStreamOutputs(prev => {
              const next = new Map(prev);
              const current = next.get(event.stream.id) || '';
              next.set(event.stream.id, current + '\n' + event.stream.outputPreview);
              return next;
            });
          }
          break;
        case 'stream_removed':
          setStreamOutputs(prev => {
            const next = new Map(prev);
            next.delete(event.streamId);
            return next;
          });
          if (selectedStreamId === event.streamId) {
            setViewMode('summary');
            setSelectedStreamId(null);
          }
          break;
      }
    };

    addEventListener(handleEvent);
    return () => removeEventListener(handleEvent);
  }, [addEventListener, removeEventListener, selectedStreamId]);

  useEffect(() => {
    if (streams.length > 0 && selectedIndex >= streams.length) {
      setSelectedIndex(Math.max(0, streams.length - 1));
    }
  }, [streams.length, selectedIndex]);

  const handleDrillDown = useCallback((streamId: string) => {
    setSelectedStreamId(streamId);
    setViewMode('drilldown');
  }, []);

  const handleBack = useCallback(() => {
    setViewMode('summary');
    setSelectedStreamId(null);
  }, []);

  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string }) => {
      if (viewMode === 'summary') {
        switch (key.name) {
          case 'up':
          case 'k':
            setSelectedIndex(prev => Math.max(0, prev - 1));
            break;
          case 'down':
          case 'j':
            setSelectedIndex(prev => Math.min(streams.length - 1, prev + 1));
            break;
          case 'return':
          case 'enter':
            if (streams[selectedIndex]) {
              handleDrillDown(streams[selectedIndex].id);
            }
            break;
          case 'r':
            onRefresh?.();
            break;
          case 'escape':
          case 'q':
            onClose?.();
            break;
        }
      } else {
        switch (key.name) {
          case 'escape':
            handleBack();
            break;
          case 'a':
            if (selectedStreamId) {
              const streamBroadcasts = broadcasts.filter(b => b.requiresAction);
              if (streamBroadcasts.length > 0) {
                onAcknowledgeBroadcast?.(streamBroadcasts[0].id);
              }
            }
            break;
          case 'q':
            onClose?.();
            break;
        }
      }
    },
    [viewMode, streams, selectedIndex, handleDrillDown, handleBack, onRefresh, onClose, selectedStreamId, broadcasts, onAcknowledgeBroadcast]
  );

  useKeyboard(handleKeyboard);

  const selectedStream = selectedStreamId
    ? streams.find(s => s.id === selectedStreamId)
    : null;

  const streamBroadcasts = selectedStreamId
    ? broadcasts.filter(b => b.fromAgentName !== selectedStream?.agentName)
    : [];

  const sentBroadcasts = selectedStreamId
    ? broadcasts.filter(b => b.fromAgentName === selectedStream?.agentName)
    : [];

  const streamOutput = selectedStreamId
    ? streamOutputs.get(selectedStreamId) || ''
    : '';

  if (streams.length === 0) {
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
        <text fg={colors.fg.muted}>No parallel work streams active</text>
        <text fg={colors.fg.dim}>Parallel execution will show work streams here</text>
        <text fg={colors.fg.dim}>Press Esc to close</text>
      </box>
    );
  }

  if (viewMode === 'drilldown' && selectedStream) {
    return (
      <WorkStreamDrillDown
        stream={selectedStream}
        output={streamOutput}
        broadcasts={streamBroadcasts}
        sentBroadcasts={sentBroadcasts}
        onBack={handleBack}
        onAcknowledgeBroadcast={onAcknowledgeBroadcast}
      />
    );
  }

  return (
    <ParallelProgressSummary
      streams={streams}
      stats={stats}
      selectedIndex={selectedIndex}
      viewMode={viewMode}
      onSelectStream={setSelectedIndex}
      onDrillDown={handleDrillDown}
      onBack={handleBack}
    />
  );
}
