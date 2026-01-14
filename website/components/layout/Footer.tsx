/**
 * ABOUTME: Footer component with links section, GitHub link, and attribution.
 * Features terminal-inspired styling with gradient accents and organized link sections.
 */

import Link from 'next/link';
import { Terminal, ExternalLink } from 'lucide-react';

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

interface FooterSection {
  title: string;
  links: FooterLink[];
}

const footerSections: FooterSection[] = [
  {
    title: 'Product',
    links: [
      { label: 'Home', href: '/' },
      { label: 'Documentation', href: '/docs/getting-started/introduction' },
      { label: 'Getting Started', href: '/docs/getting-started/quick-start' },
    ],
  },
  {
    title: 'Resources',
    links: [
      {
        label: 'GitHub',
        href: 'https://github.com/subsy/ralph-tui',
        external: true,
      },
      {
        label: 'Issues',
        href: 'https://github.com/subsy/ralph-tui/issues',
        external: true,
      },
      {
        label: 'Releases',
        href: 'https://github.com/subsy/ralph-tui/releases',
        external: true,
      },
    ],
  },
  {
    title: 'Community',
    links: [
      {
        label: 'Discussions',
        href: 'https://github.com/subsy/ralph-tui/discussions',
        external: true,
      },
      {
        label: 'Contributing',
        href: 'https://github.com/subsy/ralph-tui/blob/main/CONTRIBUTING.md',
        external: true,
      },
    ],
  },
];

/**
 * Footer component with organized link sections and terminal-inspired branding.
 */
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-bg-secondary">
      {/* Main footer content */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand section */}
          <div className="lg:col-span-1">
            <Link href="/" className="group inline-flex items-center gap-2">
              <div
                className={[
                  'flex items-center justify-center',
                  'rounded-md p-1.5',
                  'bg-accent-primary/10',
                  'transition-all duration-300',
                  'group-hover:bg-accent-primary/20',
                  'group-hover:shadow-[0_0_15px_rgba(122,162,247,0.2)]',
                ].join(' ')}
              >
                <Terminal className="h-5 w-5 text-accent-primary" />
              </div>
              <span className="font-mono text-lg font-bold">
                Ralph<span className="text-accent-primary">TUI</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-fg-secondary">
              An AI agent loop orchestrator that manages autonomous coding
              agents through intelligent task routing.
            </p>
            {/* Terminal-style status indicator */}
            <div className="mt-4 inline-flex items-center gap-2 rounded-md bg-bg-tertiary px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-status-success" />
              </span>
              <span className="font-mono text-xs text-fg-muted">
                All systems operational
              </span>
            </div>
          </div>

          {/* Link sections */}
          {footerSections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-fg-muted">
                {section.title}
              </h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <FooterLinkItem link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            {/* Copyright */}
            <p className="text-sm text-fg-muted">
              &copy; {currentYear} Ralph TUI. Open source under MIT License.
            </p>
          </div>
        </div>
      </div>

      {/* Decorative gradient line at bottom */}
      <div className="h-px bg-gradient-to-r from-transparent via-accent-primary/50 to-transparent" />
    </footer>
  );
}

/**
 * Individual footer link with hover effects.
 */
function FooterLinkItem({ link }: { link: FooterLink }) {
  const Component = link.external ? 'a' : Link;
  const externalProps = link.external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Component
      href={link.href}
      className={[
        'group inline-flex items-center gap-1',
        'text-sm text-fg-secondary',
        'transition-colors duration-200',
        'hover:text-accent-primary',
      ].join(' ')}
      {...externalProps}
    >
      {link.label}
      {link.external && (
        <ExternalLink className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
      )}
    </Component>
  );
}

export type { FooterLink, FooterSection };
