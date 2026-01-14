/**
 * ABOUTME: Individual navigation item component for the docs sidebar.
 * Renders navigation items with terminal-inspired styling, active state highlighting,
 * and support for nested items with collapsible sections.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { NavItem } from '@/lib/navigation';

interface SidebarNavItemProps {
  /** Navigation item to render */
  item: NavItem;
  /** Nesting depth for indentation */
  depth?: number;
}

/**
 * Determines if a path is active or if any child paths are active.
 */
function isPathActive(item: NavItem, currentPath: string): boolean {
  if (item.href === currentPath) return true;
  if (item.items) {
    return item.items.some((child) => isPathActive(child, currentPath));
  }
  return false;
}

/**
 * Navigation item component with support for nested collapsible sections.
 * Features terminal-inspired styling with hover effects and active state highlighting.
 */
export function SidebarNavItem({ item, depth = 0 }: SidebarNavItemProps) {
  const pathname = usePathname();
  const hasChildren = item.items && item.items.length > 0;
  const isActive = item.href === pathname;
  const isExpanded = isPathActive(item, pathname);
  const [isOpen, setIsOpen] = useState(isExpanded);

  // Sync isOpen state when navigation changes
  useEffect(() => {
    if (isExpanded) {
      setIsOpen(true);
    }
  }, [isExpanded]);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Section header (no href, has children) - collapsible section title
  if (!item.href && hasChildren) {
    return (
      <div className="mt-6 first:mt-0">
        <button
          onClick={toggleOpen}
          className={[
            'group flex w-full items-center gap-2 px-3 py-2',
            'font-mono text-xs font-semibold uppercase tracking-wider',
            'text-fg-muted',
            'transition-colors duration-150',
            'hover:text-fg-secondary',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
          ].join(' ')}
          aria-expanded={isOpen}
        >
          {/* Terminal prompt indicator */}
          <span className="text-accent-primary opacity-60 transition-opacity group-hover:opacity-100">
            {'>'}
          </span>
          <span>{item.title}</span>
          {/* Chevron indicator */}
          <ChevronRight
            className={[
              'ml-auto h-3.5 w-3.5',
              'text-fg-dim',
              'transition-transform duration-200',
              isOpen ? 'rotate-90' : '',
            ].join(' ')}
          />
        </button>

        {/* Nested items with slide animation */}
        <div
          className={[
            'overflow-hidden transition-all duration-300 ease-out',
            isOpen ? 'mt-1 opacity-100' : 'max-h-0 opacity-0',
          ].join(' ')}
          style={{
            maxHeight: isOpen ? `${item.items!.length * 100}px` : '0px',
          }}
        >
          <div className="relative ml-3 border-l border-border-muted pl-0">
            {item.items!.map((child, index) => (
              <SidebarNavItem key={`${child.href || child.title}-${index}`} item={child} depth={depth + 1} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Regular navigation link
  if (item.href) {
    return (
      <div className="relative">
        <Link
          href={item.href}
          className={[
            'group relative flex items-center gap-2 px-3 py-2',
            'font-mono text-sm',
            'rounded-sm',
            'transition-all duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
            // Active state
            isActive
              ? 'bg-accent-primary/10 text-accent-primary'
              : 'text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary',
          ].join(' ')}
          aria-current={isActive ? 'page' : undefined}
        >
          {/* Active indicator line */}
          {isActive && (
            <span
              className={[
                'absolute left-0 top-1/2 -translate-y-1/2',
                'h-5 w-0.5 rounded-full',
                'bg-accent-primary',
              ].join(' ')}
            />
          )}

          {/* Prompt cursor for active/hover */}
          <span
            className={[
              'text-xs font-medium',
              'transition-all duration-150',
              isActive
                ? 'text-accent-primary opacity-100'
                : 'text-accent-primary/50 opacity-0 group-hover:opacity-100',
            ].join(' ')}
          >
            {'$'}
          </span>

          <span className="truncate">{item.title}</span>

          {/* Optional label badge */}
          {item.label && (
            <span
              className={[
                'ml-auto shrink-0',
                'rounded-full px-1.5 py-0.5',
                'font-mono text-[10px] font-medium uppercase tracking-wide',
                'bg-accent-secondary/20 text-accent-secondary',
              ].join(' ')}
            >
              {item.label}
            </span>
          )}
        </Link>

        {/* Nested items for link items with children */}
        {hasChildren && (
          <div className="ml-4 mt-1 border-l border-border-muted pl-0">
            {item.items!.map((child, index) => (
              <SidebarNavItem key={`${child.href || child.title}-${index}`} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

export default SidebarNavItem;
