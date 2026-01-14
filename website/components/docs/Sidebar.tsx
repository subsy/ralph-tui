/**
 * ABOUTME: Documentation sidebar component with collapsible tree navigation.
 * Renders the full docs navigation structure with terminal-inspired styling,
 * sticky positioning, and independent scrolling.
 */

'use client';

import { Terminal } from 'lucide-react';
import Link from 'next/link';
import { docsNavigation } from '@/lib/navigation';
import { SidebarNavItem } from './SidebarNav';

interface SidebarProps {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Documentation sidebar component.
 * Renders the navigation tree with collapsible sections and terminal-inspired aesthetics.
 */
export function Sidebar({ className = '' }: SidebarProps) {
  return (
    <aside
      className={[
        'flex h-full flex-col',
        'bg-bg-primary',
        className,
      ].join(' ')}
    >
      {/* Logo header for mobile sidebar */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4 md:hidden">
        <div
          className={[
            'flex items-center justify-center',
            'rounded-md p-1.5',
            'bg-accent-primary/10',
          ].join(' ')}
        >
          <Terminal className="h-5 w-5 text-accent-primary" />
        </div>
        <span className="font-mono text-base font-bold tracking-tight">
          Ralph<span className="text-accent-primary">TUI</span>
        </span>
      </div>

      {/* Search placeholder - future enhancement */}
      <div className="hidden border-b border-border px-4 py-3 md:block">
        <div
          className={[
            'flex items-center gap-2',
            'rounded-md px-3 py-2',
            'bg-bg-secondary/50',
            'border border-border/50',
            'text-fg-muted',
            'font-mono text-sm',
            'cursor-not-allowed opacity-50',
          ].join(' ')}
          title="Search coming soon"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <span>Search docs...</span>
          <kbd
            className={[
              'ml-auto hidden rounded px-1.5 py-0.5 sm:inline-block',
              'bg-bg-tertiary text-[10px] text-fg-dim',
              'font-mono',
            ].join(' ')}
          >
            /
          </kbd>
        </div>
      </div>

      {/* Navigation tree */}
      <nav
        className={[
          'flex-1 overflow-y-auto',
          'px-3 py-4',
          'scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border',
        ].join(' ')}
        aria-label="Documentation navigation"
      >
        {docsNavigation.map((item) => (
          <SidebarNavItem key={item.href || item.title} item={item} />
        ))}
      </nav>

      {/* Footer with version/links */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <Link
            href="https://github.com/subsy/ralph-tui"
            target="_blank"
            rel="noopener noreferrer"
            className={[
              'flex items-center gap-1.5',
              'font-mono text-xs',
              'text-fg-muted',
              'transition-colors duration-150',
              'hover:text-fg-secondary',
            ].join(' ')}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            <span>GitHub</span>
          </Link>

          {/* Version badge */}
          <span
            className={[
              'rounded-full px-2 py-0.5',
              'font-mono text-[10px] font-medium',
              'bg-status-success/10 text-status-success',
            ].join(' ')}
          >
            v0.1.3
          </span>
        </div>

        {/* Terminal prompt decoration */}
        <div className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-fg-dim">
          <span className="text-accent-primary">$</span>
          <span>ralph --help</span>
          <span className="animate-pulse text-accent-primary">_</span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
