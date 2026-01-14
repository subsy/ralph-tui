/**
 * ABOUTME: Sticky header component with navigation, theme toggle, search, and mobile menu trigger.
 * Features blur backdrop, terminal-inspired styling, and responsive collapse to hamburger.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Terminal, Sun, Moon, Menu, Github, FileText, Home } from 'lucide-react';
import { MobileNav } from './MobileNav';
import { DocSearch, SearchButton } from '../docs/DocSearch';

interface NavLink {
  label: string;
  href: string;
  icon: React.ReactNode;
  external?: boolean;
}

const navLinks: NavLink[] = [
  { label: 'Home', href: '/', icon: <Home className="h-4 w-4" /> },
  { label: 'Docs', href: '/docs', icon: <FileText className="h-4 w-4" /> },
  {
    label: 'GitHub',
    href: 'https://github.com/subsy/ralph-tui',
    icon: <Github className="h-4 w-4" />,
    external: true,
  },
];

/**
 * Header component with sticky positioning and blur backdrop.
 * Collapses to hamburger menu on mobile (<768px).
 */
export function Header() {
  const [mounted, setMounted] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { theme, setTheme } = useTheme();

  // Avoid hydration mismatch for theme toggle
  useEffect(() => {
    setMounted(true);
  }, []);

  // Track scroll position for enhanced header styling
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <>
      <header
        className={[
          // Positioning
          'sticky top-0 z-50',
          // Layout
          'w-full',
          // Background with blur - enhanced when scrolled
          'backdrop-blur-md',
          scrolled
            ? 'bg-bg-primary/95 shadow-[0_1px_0_0_rgb(var(--border)),0_4px_20px_rgba(0,0,0,0.3)]'
            : 'bg-bg-primary/80',
          // Border
          'border-b border-border/50',
          // Transition
          'transition-all duration-300',
        ].join(' ')}
      >
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link
              href="/"
              className={[
                'group flex items-center gap-2.5',
                'transition-all duration-200',
                'hover:opacity-90',
              ].join(' ')}
            >
              {/* Terminal icon with glow effect */}
              <div
                className={[
                  'relative flex items-center justify-center',
                  'rounded-md p-1.5',
                  'bg-accent-primary/10',
                  'transition-all duration-300',
                  'group-hover:bg-accent-primary/20',
                  'group-hover:shadow-[0_0_20px_rgba(122,162,247,0.3)]',
                ].join(' ')}
              >
                <Terminal className="h-6 w-6 text-accent-primary" />
                {/* Scan line effect */}
                <div
                  className={[
                    'absolute inset-0 rounded-md overflow-hidden',
                    'pointer-events-none opacity-0 group-hover:opacity-100',
                    'transition-opacity duration-300',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'absolute inset-0',
                      'bg-gradient-to-b from-transparent via-accent-primary/10 to-transparent',
                      'animate-[scan_2s_ease-in-out_infinite]',
                    ].join(' ')}
                    style={{
                      backgroundSize: '100% 200%',
                    }}
                  />
                </div>
              </div>
              {/* Logo text */}
              <span className="font-mono text-lg font-bold tracking-tight">
                Ralph<span className="text-accent-primary">TUI</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <NavLinkItem key={link.href} link={link} />
              ))}

              {/* Divider */}
              <div className="mx-2 h-5 w-px bg-border" />

              {/* Search Button */}
              <SearchButton onClick={() => setSearchOpen(true)} />

              {/* Divider */}
              <div className="mx-2 h-5 w-px bg-border" />

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className={[
                  'flex items-center justify-center',
                  'h-9 w-9 rounded-md',
                  'text-fg-secondary',
                  'transition-all duration-200',
                  'hover:bg-bg-tertiary hover:text-fg-primary',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
                ].join(' ')}
                aria-label={mounted ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'}
              >
                {mounted ? (
                  theme === 'dark' ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )
                ) : (
                  <div className="h-5 w-5" /> // Placeholder to prevent layout shift
                )}
              </button>
            </nav>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className={[
                'flex items-center justify-center md:hidden',
                'h-10 w-10 rounded-md',
                'text-fg-secondary',
                'transition-all duration-200',
                'hover:bg-bg-tertiary hover:text-fg-primary',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
              ].join(' ')}
              aria-label="Open navigation menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Decorative bottom border accent */}
        <div
          className={[
            'absolute bottom-0 left-0 right-0 h-px',
            'bg-gradient-to-r from-transparent via-accent-primary/50 to-transparent',
            'opacity-0 transition-opacity duration-300',
            scrolled ? 'opacity-100' : '',
          ].join(' ')}
        />
      </header>

      {/* Mobile Navigation Drawer */}
      <MobileNav
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        links={navLinks}
      />

      {/* Documentation Search */}
      <DocSearch open={searchOpen} onOpenChange={setSearchOpen} />

      {/* CSS for scan animation */}
      <style jsx global>{`
        @keyframes scan {
          0%,
          100% {
            background-position: 0% 0%;
          }
          50% {
            background-position: 0% 100%;
          }
        }
      `}</style>
    </>
  );
}

/**
 * Individual navigation link with terminal-inspired hover effects.
 */
function NavLinkItem({ link }: { link: NavLink }) {
  const Component = link.external ? 'a' : Link;
  const externalProps = link.external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Component
      href={link.href}
      className={[
        'group relative flex items-center gap-2 px-3 py-2',
        'font-mono text-sm',
        'text-fg-secondary',
        'rounded-md',
        'transition-all duration-200',
        'hover:bg-bg-tertiary hover:text-fg-primary',
      ].join(' ')}
      {...externalProps}
    >
      {/* Icon with subtle animation */}
      <span className="transition-transform duration-200 group-hover:scale-110">
        {link.icon}
      </span>
      {link.label}
      {/* Underline effect on hover */}
      <span
        className={[
          'absolute bottom-1 left-3 right-3 h-px',
          'bg-accent-primary',
          'origin-left scale-x-0',
          'transition-transform duration-200',
          'group-hover:scale-x-100',
        ].join(' ')}
      />
    </Component>
  );
}

export type { NavLink };
