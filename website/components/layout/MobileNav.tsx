/**
 * ABOUTME: Mobile navigation drawer component with slide-out animation.
 * Provides accessible mobile menu with theme toggle and navigation links.
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { X, Sun, Moon, Terminal } from 'lucide-react';
import type { NavLink } from './Header';

interface MobileNavProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Callback to close the drawer */
  onClose: () => void;
  /** Navigation links to display */
  links: NavLink[];
}

/**
 * Mobile navigation drawer with slide-out animation.
 * Includes backdrop overlay and focus trap for accessibility.
 */
export function MobileNav({ isOpen, onClose, links }: MobileNavProps) {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Avoid hydration mismatch for theme toggle
  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus close button when drawer opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure drawer is rendered
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isOpen, handleKeyDown]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 z-40',
          'bg-bg-primary/80 backdrop-blur-sm',
          'transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={[
          'fixed right-0 top-0 z-50',
          'h-full w-80 max-w-[85vw]',
          'bg-bg-secondary',
          'border-l border-border',
          'shadow-[-4px_0_30px_rgba(0,0,0,0.4)]',
          'transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div
              className={[
                'flex items-center justify-center',
                'rounded-md p-1.5',
                'bg-accent-primary/10',
              ].join(' ')}
            >
              <Terminal className="h-5 w-5 text-accent-primary" />
            </div>
            <span className="font-mono text-base font-bold">
              Ralph<span className="text-accent-primary">TUI</span>
            </span>
          </div>

          {/* Close button */}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className={[
              'flex items-center justify-center',
              'h-10 w-10 rounded-md',
              'text-fg-secondary',
              'transition-all duration-200',
              'hover:bg-bg-tertiary hover:text-fg-primary',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
            ].join(' ')}
            aria-label="Close navigation menu"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-col gap-1 p-4">
          {links.map((link, index) => (
            <MobileNavLink
              key={link.href}
              link={link}
              onClose={onClose}
              index={index}
              isOpen={isOpen}
            />
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-4 h-px bg-border" />

        {/* Theme Toggle */}
        <div className="p-4">
          <button
            onClick={toggleTheme}
            className={[
              'flex w-full items-center gap-3 px-4 py-3',
              'rounded-lg',
              'font-mono text-sm',
              'text-fg-secondary',
              'transition-all duration-200',
              'hover:bg-bg-tertiary hover:text-fg-primary',
            ].join(' ')}
          >
            {mounted ? (
              theme === 'dark' ? (
                <>
                  <Sun className="h-5 w-5" />
                  <span>Switch to Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="h-5 w-5" />
                  <span>Switch to Dark Mode</span>
                </>
              )
            ) : (
              <>
                <div className="h-5 w-5" />
                <span>Toggle Theme</span>
              </>
            )}
          </button>
        </div>

        {/* Decorative terminal prompt at bottom */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-border p-4">
          <div className="flex items-center gap-2 font-mono text-xs text-fg-muted">
            <span className="text-accent-primary">$</span>
            <span>ready_</span>
            <span className="animate-pulse text-accent-primary">|</span>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Individual mobile navigation link with staggered animation.
 */
function MobileNavLink({
  link,
  onClose,
  index,
  isOpen,
}: {
  link: NavLink;
  onClose: () => void;
  index: number;
  isOpen: boolean;
}) {
  const Component = link.external ? 'a' : Link;
  const externalProps = link.external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <Component
      href={link.href}
      onClick={() => {
        if (!link.external) {
          onClose();
        }
      }}
      className={[
        'group flex items-center gap-3 px-4 py-3',
        'rounded-lg',
        'font-mono text-base',
        'text-fg-secondary',
        'transition-all duration-300',
        'hover:bg-bg-tertiary hover:text-fg-primary',
        'hover:translate-x-1',
        // Staggered animation
        isOpen ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0',
      ].join(' ')}
      style={{
        transitionDelay: isOpen ? `${index * 50 + 100}ms` : '0ms',
      }}
      {...externalProps}
    >
      {/* Icon */}
      <span className="text-accent-primary transition-transform duration-200 group-hover:scale-110">
        {link.icon}
      </span>
      {link.label}
      {/* External link indicator */}
      {link.external && (
        <span className="ml-auto text-xs text-fg-muted">
          <svg
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </span>
      )}
    </Component>
  );
}
