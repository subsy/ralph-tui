/**
 * ABOUTME: Scope filter bar for multi-epic Ralph sessions.
 * Shows the aggregate All view and per-scope task counts for local filtering.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { ExecutionScope } from '../../plugins/trackers/types.js';

export interface ScopeFilterCount {
  scopeId?: string;
  total: number;
  active: number;
  done: number;
  completedLocally: number;
  blocked: number;
  closed: number;
}

export interface ScopeFilterBarProps {
  scopes: ExecutionScope[];
  selectedScopeId: string;
  counts: Map<string, ScopeFilterCount>;
  allCount: ScopeFilterCount;
}

function truncateLabel(label: string, maxWidth: number): string {
  if (label.length <= maxWidth) return label;
  if (maxWidth <= 1) return label.slice(0, maxWidth);
  return `${label.slice(0, maxWidth - 1)}…`;
}

function formatCount(count: ScopeFilterCount): string {
  const completed = count.done + count.closed + count.completedLocally;
  const extras: string[] = [];
  if (count.active > 0) extras.push(`a${count.active}`);
  if (count.blocked > 0) extras.push(`b${count.blocked}`);
  const suffix = extras.length > 0 ? ` ${extras.join(' ')}` : '';
  return `${completed}/${count.total}${suffix}`;
}

function ScopePill({
  label,
  selected,
  count,
}: {
  label: string;
  selected: boolean;
  count: ScopeFilterCount;
}): ReactNode {
  const fg = selected ? colors.fg.primary : colors.fg.secondary;
  const bg = selected ? colors.bg.tertiary : colors.bg.secondary;
  const safeLabel = truncateLabel(label, 18);

  return (
    <box
      style={{
        flexDirection: 'row',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: bg,
      }}
    >
      <text>
        <span fg={fg}>{safeLabel}</span>
        <span fg={colors.fg.dim}> {formatCount(count)}</span>
      </text>
    </box>
  );
}

export function ScopeFilterBar({
  scopes,
  selectedScopeId,
  counts,
  allCount,
}: ScopeFilterBarProps): ReactNode {
  if (scopes.length <= 1) {
    return null;
  }

  return (
    <box
      style={{
        width: '100%',
        height: 1,
        flexDirection: 'row',
        backgroundColor: colors.bg.secondary,
      }}
    >
      <ScopePill
        label="All"
        selected={selectedScopeId === 'all'}
        count={allCount}
      />
      {scopes.map((scope) => (
        <ScopePill
          key={scope.id}
          label={scope.title || scope.id}
          selected={selectedScopeId === scope.id}
          count={counts.get(scope.id) ?? {
            scopeId: scope.id,
            total: 0,
            active: 0,
            done: 0,
            completedLocally: 0,
            blocked: 0,
            closed: 0,
          }}
        />
      ))}
      <box style={{ flexGrow: 1 }} />
      <box style={{ paddingRight: 1 }}>
        <text fg={colors.fg.dim}>g next  G all</text>
      </box>
    </box>
  );
}
