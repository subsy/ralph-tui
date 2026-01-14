/**
 * ABOUTME: Breadcrumbs component showing current location in docs hierarchy.
 * Terminal-inspired styling with path-like navigation.
 */

import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { docsNavigation, findNavItem, type NavItem } from '@/lib/navigation';

interface BreadcrumbsProps {
  /** Current page slug (e.g., 'cli/run' or 'getting-started/introduction') */
  slug: string[];
  /** Additional CSS classes */
  className?: string;
}

interface BreadcrumbItem {
  title: string;
  href: string;
  isCurrent: boolean;
}

/**
 * Builds breadcrumb trail from slug path.
 * Uses navigation config to resolve titles.
 */
function buildBreadcrumbs(slug: string[]): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [];

  // Walk through slug segments to build path
  let pathSoFar = '/docs';

  for (let i = 0; i < slug.length; i++) {
    const segment = slug[i];
    pathSoFar = i === 0 ? `/docs/${segment}` : `${pathSoFar}/${segment}`;
    const isLast = i === slug.length - 1;

    // Try to find nav item for this path
    const navItem = findNavItem(docsNavigation, pathSoFar);

    // If not found, try to find section title
    if (navItem) {
      crumbs.push({
        title: navItem.title,
        href: pathSoFar,
        isCurrent: isLast,
      });
    } else {
      // Format segment as title (kebab-case to Title Case)
      const title = segment
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      crumbs.push({
        title,
        href: pathSoFar,
        isCurrent: isLast,
      });
    }
  }

  return crumbs;
}

/**
 * Find the parent section title for the current path.
 */
function findParentSection(slug: string[]): string | null {
  const currentPath = '/docs' + (slug.length > 0 ? '/' + slug.join('/') : '');

  for (const section of docsNavigation) {
    if (!section.items) continue;

    // Check if any item in this section matches
    function checkItems(items: NavItem[]): boolean {
      for (const item of items) {
        if (item.href === currentPath) return true;
        if (item.items && checkItems(item.items)) return true;
      }
      return false;
    }

    if (checkItems(section.items)) {
      return section.title;
    }
  }

  return null;
}

/**
 * Breadcrumbs navigation component with terminal-inspired styling.
 * Shows the current location in the docs hierarchy.
 */
export function Breadcrumbs({ slug, className = '' }: BreadcrumbsProps) {
  const crumbs = buildBreadcrumbs(slug);
  const parentSection = findParentSection(slug);

  return (
    <nav
      className={[
        'flex items-center gap-1.5',
        'font-mono text-xs',
        className,
      ].join(' ')}
      aria-label="Breadcrumb navigation"
    >
      {/* Terminal prompt */}
      <span className="text-accent-primary mr-0.5" aria-hidden="true">~</span>

      {/* Docs root link */}
      <Link
        href="/docs"
        className={[
          'flex items-center gap-1',
          'text-fg-muted',
          'transition-colors duration-150',
          'hover:text-fg-secondary',
        ].join(' ')}
      >
        <Home className="h-3 w-3" />
        <span className="sr-only">Documentation home</span>
      </Link>

      {/* Separator */}
      <ChevronRight className="h-3 w-3 text-fg-dim" aria-hidden="true" />

      {/* Parent section (if found) */}
      {parentSection && crumbs.length > 0 && crumbs[0].title !== parentSection && (
        <>
          <span className="text-fg-muted">{parentSection}</span>
          <ChevronRight className="h-3 w-3 text-fg-dim" aria-hidden="true" />
        </>
      )}

      {/* Breadcrumb trail */}
      {crumbs.map((crumb, index) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {index > 0 && (
            <ChevronRight className="h-3 w-3 text-fg-dim" aria-hidden="true" />
          )}
          {crumb.isCurrent ? (
            <span
              className="text-fg-secondary font-medium"
              aria-current="page"
            >
              {crumb.title}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className={[
                'text-fg-muted',
                'transition-colors duration-150',
                'hover:text-fg-secondary',
              ].join(' ')}
            >
              {crumb.title}
            </Link>
          )}
        </span>
      ))}

      {/* Empty state */}
      {crumbs.length === 0 && (
        <span className="text-fg-secondary font-medium" aria-current="page">
          docs
        </span>
      )}
    </nav>
  );
}

export default Breadcrumbs;
