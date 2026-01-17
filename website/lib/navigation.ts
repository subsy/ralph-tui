/**
 * ABOUTME: Navigation configuration for the Ralph TUI documentation site.
 * Defines the sidebar structure with types for navigation items.
 */

/**
 * Represents a navigation item in the docs sidebar.
 * Supports nested items for hierarchical navigation.
 */
export interface NavItem {
  /** Display title for the navigation item */
  title: string;
  /** URL path for the page (omit for section headers) */
  href?: string;
  /** Nested navigation items */
  items?: NavItem[];
  /** Optional label badge (e.g., "New", "Beta") */
  label?: string;
}

/**
 * Documentation sidebar navigation structure.
 * Organized by major sections with nested pages.
 */
export const docsNavigation: NavItem[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Introduction', href: '/docs/getting-started/introduction' },
      { title: 'Quick Start', href: '/docs/getting-started/quick-start' },
      { title: 'Installation', href: '/docs/getting-started/installation' },
    ],
  },
  {
    title: 'CLI Commands',
    items: [
      { title: 'Overview', href: '/docs/cli/overview' },
      { title: 'run', href: '/docs/cli/run' },
      { title: 'resume', href: '/docs/cli/resume' },
      { title: 'status', href: '/docs/cli/status' },
      { title: 'logs', href: '/docs/cli/logs' },
      { title: 'setup', href: '/docs/cli/setup' },
      { title: 'create-prd', href: '/docs/cli/create-prd' },
      { title: 'convert', href: '/docs/cli/convert' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { title: 'Overview', href: '/docs/configuration/overview' },
      { title: 'Config File', href: '/docs/configuration/config-file' },
      { title: 'Options Reference', href: '/docs/configuration/options' },
      { title: 'Sandbox', href: '/docs/configuration/sandbox' },
    ],
  },
  {
    title: 'Plugins',
    items: [
      { title: 'Overview', href: '/docs/plugins/overview' },
      {
        title: 'Agents',
        items: [
          { title: 'Claude', href: '/docs/plugins/agents/claude' },
          { title: 'OpenCode', href: '/docs/plugins/agents/opencode' },
          { title: 'Factory Droid', href: '/docs/plugins/agents/droid' },
        ],
      },
      {
        title: 'Trackers',
        items: [
          { title: 'JSON', href: '/docs/plugins/trackers/json' },
          { title: 'Beads', href: '/docs/plugins/trackers/beads' },
          { title: 'Beads-BV', href: '/docs/plugins/trackers/beads-bv' },
        ],
      },
    ],
  },
  {
    title: 'Prompt Templates',
    items: [
      { title: 'Overview', href: '/docs/templates/overview' },
      { title: 'Customization', href: '/docs/templates/customization' },
      { title: 'Handlebars Reference', href: '/docs/templates/handlebars' },
    ],
  },
  {
    title: 'Troubleshooting',
    items: [
      { title: 'Common Issues', href: '/docs/troubleshooting/common-issues' },
      { title: 'Debugging', href: '/docs/troubleshooting/debugging' },
    ],
  },
];

/**
 * Flattens the navigation tree into a list of all pages with hrefs.
 * Useful for generating sitemaps or prev/next navigation.
 */
export function flattenNavigation(items: NavItem[]): NavItem[] {
  const result: NavItem[] = [];
  for (const item of items) {
    if (item.href) {
      result.push(item);
    }
    if (item.items) {
      result.push(...flattenNavigation(item.items));
    }
  }
  return result;
}

/**
 * Finds a navigation item by its href.
 * Returns undefined if not found.
 */
export function findNavItem(
  items: NavItem[],
  href: string
): NavItem | undefined {
  for (const item of items) {
    if (item.href === href) {
      return item;
    }
    if (item.items) {
      const found = findNavItem(item.items, href);
      if (found) return found;
    }
  }
  return undefined;
}
