/**
 * ABOUTME: Previous/Next navigation component for doc pages.
 * Provides keyboard-accessible navigation between documentation pages.
 */

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { docsNavigation, flattenNavigation } from '@/lib/navigation';

interface PrevNextNavProps {
  /** Current page path (e.g., '/docs/cli/run') */
  currentPath: string;
  /** Additional CSS classes */
  className?: string;
}

interface NavLink {
  title: string;
  href: string;
}

/**
 * Finds the previous and next pages relative to the current path.
 */
function findPrevNext(currentPath: string): { prev: NavLink | null; next: NavLink | null } {
  // Flatten the navigation tree
  const flatNav = flattenNavigation(docsNavigation);

  // Find current page index
  const currentIndex = flatNav.findIndex((item) => item.href === currentPath);

  if (currentIndex === -1) {
    return { prev: null, next: null };
  }

  const prev = currentIndex > 0 ? flatNav[currentIndex - 1] : null;
  const next = currentIndex < flatNav.length - 1 ? flatNav[currentIndex + 1] : null;

  return {
    prev: prev ? { title: prev.title, href: prev.href! } : null,
    next: next ? { title: next.title, href: next.href! } : null,
  };
}

/**
 * Previous/Next navigation component.
 * Card-based design with hover effects and terminal-inspired accents.
 */
export function PrevNextNav({ currentPath, className = '' }: PrevNextNavProps) {
  const { prev, next } = findPrevNext(currentPath);

  // Don't render if no navigation available
  if (!prev && !next) {
    return null;
  }

  return (
    <nav
      className={[
        'mt-16 pt-8',
        'border-t border-border',
        className,
      ].join(' ')}
      aria-label="Page navigation"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Previous page */}
        {prev ? (
          <Link
            href={prev.href}
            className={[
              'group relative flex flex-col p-4',
              'rounded-sm',
              'border border-border',
              'bg-bg-secondary/30',
              'transition-all duration-200',
              // Hover state
              'hover:border-accent-primary/50',
              'hover:bg-bg-secondary/50',
              'hover:shadow-[0_0_20px_rgba(122,162,247,0.1)]',
              // Focus state
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
            ].join(' ')}
          >
            {/* Direction indicator */}
            <span
              className={[
                'flex items-center gap-1.5 mb-2',
                'font-mono text-[10px] uppercase tracking-wider',
                'text-fg-dim',
                'transition-colors duration-150',
                'group-hover:text-fg-muted',
              ].join(' ')}
            >
              <ChevronLeft
                className={[
                  'h-3 w-3',
                  'transition-transform duration-200',
                  'group-hover:-translate-x-0.5',
                ].join(' ')}
              />
              <span>Previous</span>
            </span>

            {/* Page title */}
            <span
              className={[
                'font-mono text-sm',
                'text-fg-secondary',
                'transition-colors duration-150',
                'group-hover:text-accent-primary',
              ].join(' ')}
            >
              {prev.title}
            </span>

            {/* Hover accent line */}
            <span
              className={[
                'absolute left-0 top-0 h-full w-0.5',
                'bg-accent-primary',
                'opacity-0 transition-opacity duration-200',
                'group-hover:opacity-100',
              ].join(' ')}
              aria-hidden="true"
            />
          </Link>
        ) : (
          // Empty spacer for grid alignment
          <div className="hidden sm:block" />
        )}

        {/* Next page */}
        {next ? (
          <Link
            href={next.href}
            className={[
              'group relative flex flex-col items-end p-4 text-right',
              'rounded-sm',
              'border border-border',
              'bg-bg-secondary/30',
              'transition-all duration-200',
              // Hover state
              'hover:border-accent-primary/50',
              'hover:bg-bg-secondary/50',
              'hover:shadow-[0_0_20px_rgba(122,162,247,0.1)]',
              // Focus state
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
            ].join(' ')}
          >
            {/* Direction indicator */}
            <span
              className={[
                'flex items-center gap-1.5 mb-2',
                'font-mono text-[10px] uppercase tracking-wider',
                'text-fg-dim',
                'transition-colors duration-150',
                'group-hover:text-fg-muted',
              ].join(' ')}
            >
              <span>Next</span>
              <ChevronRight
                className={[
                  'h-3 w-3',
                  'transition-transform duration-200',
                  'group-hover:translate-x-0.5',
                ].join(' ')}
              />
            </span>

            {/* Page title */}
            <span
              className={[
                'font-mono text-sm',
                'text-fg-secondary',
                'transition-colors duration-150',
                'group-hover:text-accent-primary',
              ].join(' ')}
            >
              {next.title}
            </span>

            {/* Hover accent line */}
            <span
              className={[
                'absolute right-0 top-0 h-full w-0.5',
                'bg-accent-primary',
                'opacity-0 transition-opacity duration-200',
                'group-hover:opacity-100',
              ].join(' ')}
              aria-hidden="true"
            />
          </Link>
        ) : (
          // Empty spacer for grid alignment
          <div className="hidden sm:block" />
        )}
      </div>
    </nav>
  );
}

export default PrevNextNav;
