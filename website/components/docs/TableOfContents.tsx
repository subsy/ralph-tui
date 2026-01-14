/**
 * ABOUTME: Table of Contents component with scroll-spy highlighting.
 * Renders h2/h3 headings as a sticky sidebar with active section tracking
 * and smooth scroll navigation.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TocItem } from '@/lib/docs';

interface TableOfContentsProps {
  /** Hierarchical list of headings from the document */
  items: TocItem[];
  /** Additional CSS classes */
  className?: string;
}

/**
 * Table of Contents component with scroll-spy functionality.
 * Highlights the currently visible section and provides smooth scroll navigation.
 */
export function TableOfContents({ items, className = '' }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);
  const headingIdsRef = useRef<string[]>([]);

  // Flatten items to get all heading IDs
  useEffect(() => {
    const ids: string[] = [];
    function collectIds(tocItems: TocItem[]) {
      for (const item of tocItems) {
        ids.push(item.id);
        if (item.children) {
          collectIds(item.children);
        }
      }
    }
    collectIds(items);
    headingIdsRef.current = ids;
  }, [items]);

  // Set up Intersection Observer for scroll-spy
  useEffect(() => {
    const headingIds = headingIdsRef.current;
    if (headingIds.length === 0) return;

    // Map to track visibility state of each heading
    const visibilityMap = new Map<string, boolean>();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Update visibility map
        for (const entry of entries) {
          visibilityMap.set(entry.target.id, entry.isIntersecting);
        }

        // Find the first visible heading (topmost in document)
        for (const id of headingIds) {
          if (visibilityMap.get(id)) {
            setActiveId(id);
            return;
          }
        }

        // If none visible, find the last heading we scrolled past
        const scrollY = window.scrollY;
        let lastPassedId = '';
        for (const id of headingIds) {
          const element = document.getElementById(id);
          if (element && element.offsetTop <= scrollY + 120) {
            lastPassedId = id;
          }
        }
        if (lastPassedId) {
          setActiveId(lastPassedId);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      }
    );

    // Observe all headings
    for (const id of headingIds) {
      const element = document.getElementById(id);
      if (element) {
        observerRef.current.observe(element);
      }
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [items]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      // Calculate offset for sticky header
      const offset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });

      // Update URL hash without scrolling
      window.history.pushState(null, '', `#${id}`);
      setActiveId(id);
    }
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      className={[
        'relative',
        className,
      ].join(' ')}
      aria-label="Table of contents"
    >
      {/* Header with terminal styling */}
      <div
        className={[
          'mb-4 flex items-center gap-2',
          'font-mono text-xs uppercase tracking-wider',
          'text-fg-muted',
        ].join(' ')}
      >
        <span className="text-accent-primary opacity-60">#</span>
        <span>On this page</span>
      </div>

      {/* TOC items with decorative vertical line */}
      <div className="relative">
        {/* Decorative line */}
        <div
          className={[
            'absolute left-0 top-0 h-full w-px',
            'bg-gradient-to-b from-border via-border/50 to-transparent',
          ].join(' ')}
          aria-hidden="true"
        />

        <ul className="space-y-1 pl-4">
          {items.map((item, index) => (
            <TocEntry
              key={`${item.id}-${index}`}
              item={item}
              activeId={activeId}
              onClick={handleClick}
            />
          ))}
        </ul>
      </div>

      {/* Scroll progress indicator */}
      <ScrollProgress />
    </nav>
  );
}

/**
 * Individual TOC entry component supporting nested items.
 */
function TocEntry({
  item,
  activeId,
  onClick,
  depth = 0,
}: {
  item: TocItem;
  activeId: string;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  depth?: number;
}) {
  const isActive = activeId === item.id;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <li className="relative">
      <a
        href={`#${item.id}`}
        onClick={(e) => onClick(e, item.id)}
        className={[
          'group relative block py-1.5',
          'font-mono text-sm leading-relaxed',
          'transition-all duration-200',
          // Base styles
          depth === 0 ? 'text-fg-secondary' : 'text-fg-muted',
          // Hover styles
          'hover:text-accent-primary',
          // Active state
          isActive
            ? 'text-accent-primary font-medium'
            : '',
        ].join(' ')}
        aria-current={isActive ? 'location' : undefined}
      >
        {/* Active indicator pip */}
        <span
          className={[
            'absolute -left-4 top-1/2 -translate-y-1/2',
            'h-1.5 w-1.5 rounded-full',
            'transition-all duration-200',
            isActive
              ? 'bg-accent-primary scale-100'
              : 'bg-border scale-0 group-hover:scale-100 group-hover:bg-fg-dim',
          ].join(' ')}
          aria-hidden="true"
        />

        {/* Text with subtle animation */}
        <span
          className={[
            'inline-block transition-transform duration-150',
            'group-hover:translate-x-0.5',
          ].join(' ')}
        >
          {item.title}
        </span>
      </a>

      {/* Nested children (h3 under h2) */}
      {hasChildren && (
        <ul className="mt-1 space-y-1 border-l border-border-muted pl-3 ml-0.5">
          {item.children!.map((child, index) => (
            <TocEntry
              key={`${child.id}-${index}`}
              item={child}
              activeId={activeId}
              onClick={onClick}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Subtle scroll progress indicator at bottom of TOC.
 */
function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0;
      setProgress(scrollPercent);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="mt-6 pt-4 border-t border-border-muted">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          Progress
        </span>
        <span className="font-mono text-[10px] text-fg-muted">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="h-0.5 w-full bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={[
            'h-full rounded-full',
            'bg-gradient-to-r from-accent-primary to-accent-secondary',
            'transition-[width] duration-150 ease-out',
          ].join(' ')}
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Page scroll progress"
        />
      </div>
    </div>
  );
}

export default TableOfContents;
