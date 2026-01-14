/**
 * ABOUTME: Hero section component for the Ralph TUI landing page.
 * Features animated gradient background, typing cursor effect, and terminal-inspired
 * install command block with copy functionality.
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';

/**
 * Copy icon SVG for the install command.
 */
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/**
 * Check icon for copied state feedback.
 */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * GitHub icon for the secondary CTA button.
 */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/**
 * Arrow icon for the primary CTA button.
 */
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

const INSTALL_COMMAND = 'bun install -g ralph-tui';

/**
 * Install command block component with copy-to-clipboard functionality.
 */
function InstallCommand() {
  const [copied, setCopied] = useState(false);

  // Track timeout for cleanup
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
      } else {
        // Fallback for HTTP or older browsers
        const textArea = document.createElement('textarea');
        textArea.value = INSTALL_COMMAND;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  return (
    <div className="group relative w-full max-w-md">
      {/* Glow effect behind the command block */}
      <div
        className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-tertiary opacity-30 blur-sm transition-opacity duration-500 group-hover:opacity-50"
        aria-hidden="true"
      />

      <div className="relative flex items-center justify-between gap-3 rounded-lg border border-border-active/40 bg-bg-primary/90 px-4 py-3 backdrop-blur-sm">
        {/* Terminal prompt indicator */}
        <div className="flex items-center gap-3">
          <span className="select-none font-mono text-sm text-accent-tertiary">
            $
          </span>
          <code className="font-mono text-sm text-fg-primary sm:text-base">
            {INSTALL_COMMAND}
          </code>
        </div>

        {/* Copy button */}
        <button
          type="button"
          onClick={handleCopy}
          className={[
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5',
            'font-mono text-xs font-medium tracking-wide',
            'transition-all duration-150 ease-out',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
            copied
              ? 'bg-status-success/20 text-status-success'
              : 'bg-bg-tertiary text-fg-muted hover:bg-bg-highlight hover:text-fg-secondary',
          ].join(' ')}
          aria-label={copied ? 'Copied!' : 'Copy install command'}
        >
          {copied ? (
            <>
              <CheckIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Copied!</span>
            </>
          ) : (
            <>
              <CopyIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Animated typing cursor that blinks.
 */
function TypingCursor() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <span
      className={[
        'ml-1 inline-block h-[1.1em] w-[3px] translate-y-[0.1em] rounded-sm bg-accent-primary',
        'transition-opacity duration-100',
        visible ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
      aria-hidden="true"
    />
  );
}

/**
 * Hero section component for the Ralph TUI landing page.
 *
 * Features:
 * - Animated gradient mesh background
 * - Large headline with typing cursor effect
 * - Descriptive subheadline
 * - Install command block with copy functionality
 * - Dual CTA buttons (Get Started + GitHub)
 *
 * @example
 * <Hero />
 */
export function Hero() {
  return (
    <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      {/* Background layer with gradient mesh */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        {/* Base dark gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-bg-primary via-bg-secondary/50 to-bg-primary" />

        {/* Animated gradient orbs */}
        <div className="absolute left-1/4 top-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-accent-primary/10 blur-[100px]" />
        <div
          className="absolute right-1/4 top-1/3 h-[400px] w-[400px] translate-x-1/2 animate-pulse rounded-full bg-accent-secondary/10 blur-[80px]"
          style={{ animationDelay: '1s', animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-1/4 left-1/3 h-[350px] w-[350px] animate-pulse rounded-full bg-accent-tertiary/10 blur-[90px]"
          style={{ animationDelay: '2s', animationDuration: '5s' }}
        />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(122, 162, 247, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(122, 162, 247, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />

        {/* Scanline effect for terminal aesthetic */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 0, 0, 0.3) 2px, rgba(0, 0, 0, 0.3) 4px)',
          }}
        />

        {/* Vignette effect - theme aware */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgb(var(--bg-primary)/0.4)_70%,rgb(var(--bg-primary)/0.8)_100%)]" />
      </div>

      {/* Content */}
      <div className="container mx-auto flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-16 sm:py-20">
        {/* Badge */}
        <div className="mb-6 animate-fade-in sm:mb-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent-primary/30 bg-accent-primary/10 px-4 py-1.5 font-mono text-xs font-medium tracking-wider text-accent-primary">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success"
              aria-hidden="true"
            />
            PROUDLY OPEN SOURCE
          </span>
        </div>

        {/* Headline */}
        <h1
          className="mb-4 animate-slide-up text-center font-mono text-4xl font-bold tracking-tight text-fg-primary sm:mb-6 sm:text-5xl md:text-6xl lg:text-7xl"
          style={{ animationDelay: '100ms' }}
        >
          <span className="bg-gradient-to-r from-fg-primary via-accent-primary to-accent-tertiary bg-clip-text text-transparent">
            AI Agent Loop
          </span>
          <br />
          <span className="text-fg-primary">Orchestrator</span>
          <TypingCursor />
        </h1>

        {/* Subheadline */}
        <p
          className="mb-8 max-w-2xl animate-slide-up text-center text-lg leading-relaxed text-fg-secondary sm:mb-10 sm:text-xl"
          style={{ animationDelay: '200ms' }}
        >
          Orchestrate autonomous AI coding agents with ease - all from your terminal.
        </p>

        {/* Install command */}
        <div
          className="mb-8 w-full animate-slide-up sm:mb-10"
          style={{ animationDelay: '300ms' }}
        >
          <div className="flex justify-center">
            <InstallCommand />
          </div>
        </div>

        {/* CTA Buttons */}
        <div
          className="flex animate-slide-up flex-col items-center gap-4 sm:flex-row"
          style={{ animationDelay: '400ms' }}
        >
          <Link
            href="/docs"
            className={[
              // Base button styles
              'group inline-flex items-center justify-center gap-2',
              'font-mono font-medium tracking-wide',
              'rounded-sm',
              'transition-all duration-150 ease-out',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
              'select-none',
              // Size lg
              'h-12 px-7 text-base',
              // Default variant
              'bg-accent-primary text-bg-primary',
              'hover:bg-accent-primary/90 hover:shadow-[0_0_20px_rgba(122,162,247,0.4)]',
              'active:bg-accent-primary/80 active:shadow-[0_0_10px_rgba(122,162,247,0.3)]',
              'border border-accent-primary/50',
              // Custom
              'min-w-[180px]',
            ].join(' ')}
          >
            Get Started
            <ArrowRightIcon className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>

          <a
            href="https://github.com/subsy/ralph-tui"
            target="_blank"
            rel="noopener noreferrer"
            className={[
              // Base button styles
              'inline-flex items-center justify-center gap-2',
              'font-mono font-medium tracking-wide',
              'rounded-sm',
              'transition-all duration-150 ease-out',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
              'select-none',
              // Size lg
              'h-12 px-7 text-base',
              // Outline variant
              'bg-transparent text-accent-primary',
              'border-2 border-accent-primary/60',
              'hover:bg-accent-primary/10 hover:border-accent-primary hover:shadow-[0_0_15px_rgba(122,162,247,0.2)]',
              'active:bg-accent-primary/20',
              // Custom
              'min-w-[180px]',
            ].join(' ')}
          >
            <GitHubIcon className="h-5 w-5" />
            View on GitHub
          </a>
        </div>

        {/* Scroll indicator */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce"
          style={{ animationDelay: '1s' }}
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-2">
            <span className="font-mono text-xs tracking-widest text-fg-muted">
              SCROLL
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fg-muted"
            >
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
