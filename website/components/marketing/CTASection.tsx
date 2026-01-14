/**
 * ABOUTME: CTASection component for the Ralph TUI landing page final call-to-action.
 * Features terminal-inspired aesthetics with animated prompt cursor, gradient mesh
 * background, and dual CTA buttons. Uses framer-motion for scroll-triggered reveals.
 */

'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion, useInView } from 'framer-motion';
import { BookOpen, Star, ChevronRight } from 'lucide-react';
import type { Variants } from 'framer-motion';

/**
 * Animation variants for the container with staggered children.
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.1,
    },
  },
};

/**
 * Animation variants for individual elements sliding up.
 */
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

/**
 * Animation variants for the decorative border lines.
 */
const lineVariants: Variants = {
  hidden: { scaleX: 0, opacity: 0 },
  visible: {
    scaleX: 1,
    opacity: 1,
    transition: {
      duration: 0.8,
      ease: 'easeOut',
    },
  },
};

/**
 * Animation variants for the glowing orb in the background.
 */
const orbVariants: Variants = {
  hidden: { scale: 0.8, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: 1.2,
      ease: 'easeOut',
    },
  },
};

/**
 * Animated terminal prompt cursor that blinks.
 */
function PromptCursor() {
  return (
    <motion.span
      className="ml-2 inline-block h-6 w-3 rounded-sm bg-accent-primary sm:h-7 sm:w-3.5"
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{
        duration: 1.2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      aria-hidden="true"
    />
  );
}

/**
 * GitHub star icon component for the secondary CTA.
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
 * CTASection component - Final call-to-action section for the landing page.
 *
 * Features:
 * - Compelling headline with blinking terminal cursor
 * - Descriptive subheadline with value proposition
 * - Dual CTA buttons: "Read the Docs" (primary) and "Star on GitHub" (outline)
 * - Terminal-inspired background with gradient mesh and grid pattern
 * - Scroll-triggered staggered animations
 * - Fully responsive design
 *
 * @example
 * <CTASection />
 */
export function CTASection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: '-100px' });

  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      {/* Background effects layer */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg-secondary/50 to-bg-primary" />

        {/* Central glowing orb */}
        <motion.div
          variants={orbVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2"
        >
          <div className="h-full w-full rounded-full bg-gradient-radial from-accent-primary/12 via-accent-secondary/6 to-transparent blur-[80px] dark:from-accent-primary/15 dark:via-accent-secondary/8" />
        </motion.div>

        {/* Secondary accent orb */}
        <motion.div
          variants={orbVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          transition={{ delay: 0.2 }}
          className="absolute left-1/4 top-1/3 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2"
        >
          <div
            className="h-full w-full rounded-full bg-accent-tertiary/8 blur-[60px] dark:bg-accent-tertiary/10"
            style={{ animationDelay: '500ms' }}
          />
        </motion.div>

        {/* Grid overlay pattern */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(122, 162, 247, 0.5) 1px, transparent 1px),
              linear-gradient(90deg, rgba(122, 162, 247, 0.5) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />

        {/* Scanline effect for terminal aesthetic */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 0, 0, 0.4) 2px, rgba(0, 0, 0, 0.4) 4px)',
          }}
        />

        {/* Radial vignette - theme aware */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgb(var(--bg-primary)/0.5)_80%)]" />
      </div>

      <div className="container mx-auto px-4">
        {/* Top decorative border line */}
        <motion.div
          variants={lineVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="mx-auto mb-12 h-px max-w-md bg-gradient-to-r from-transparent via-accent-primary/50 to-transparent sm:mb-16"
          aria-hidden="true"
        />

        {/* Content container */}
        <motion.div
          ref={containerRef}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="mx-auto max-w-3xl text-center"
        >
          {/* Section label */}
          <motion.div variants={itemVariants} className="mb-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-secondary/30 bg-accent-secondary/10 px-4 py-1.5 font-mono text-xs font-medium uppercase tracking-widest text-accent-secondary">
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-secondary"
                aria-hidden="true"
              />
              Get Started
            </span>
          </motion.div>

          {/* Headline with blinking cursor */}
          <motion.h2
            variants={itemVariants}
            className="mb-6 flex flex-wrap items-center justify-center font-mono text-3xl font-bold leading-tight tracking-tight text-fg-primary sm:text-4xl md:text-5xl"
          >
            <span>Ready to&nbsp;</span>
            <span className="whitespace-nowrap">
              <span className="bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-tertiary bg-clip-text text-transparent">
                Ralph
              </span>
              <span className="text-fg-primary">?</span>
              <PromptCursor />
            </span>
          </motion.h2>

          {/* Subheadline */}
          <motion.p
            variants={itemVariants}
            className="mb-10 text-lg leading-relaxed text-fg-secondary sm:text-xl"
          >
            Join developers who ship faster with AI-powered task orchestration.
            <span className="hidden sm:inline">
              {' '}
              Set up in minutes, run autonomously for hours.
            </span>
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            variants={itemVariants}
            className="flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            {/* Primary CTA: Read the Docs */}
            <Link
              href="/docs"
              className={[
                // Base styles
                'group inline-flex items-center justify-center gap-2',
                'font-mono font-medium tracking-wide',
                'rounded-sm',
                'transition-all duration-150 ease-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                'select-none',
                // Size lg
                'h-12 px-7 text-base',
                // Default variant styling
                'bg-accent-primary text-bg-primary',
                'hover:bg-accent-primary/90 hover:shadow-[0_0_25px_rgba(122,162,247,0.5)]',
                'active:bg-accent-primary/80 active:shadow-[0_0_15px_rgba(122,162,247,0.4)]',
                'border border-accent-primary/50',
                // Width
                'min-w-[180px]',
              ].join(' ')}
            >
              <BookOpen className="h-5 w-5" aria-hidden="true" />
              Read the Docs
              <ChevronRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>

            {/* Secondary CTA: Star on GitHub */}
            <a
              href="https://github.com/subsy/ralph-tui"
              target="_blank"
              rel="noopener noreferrer"
              className={[
                // Base styles
                'group inline-flex items-center justify-center gap-2',
                'font-mono font-medium tracking-wide',
                'rounded-sm',
                'transition-all duration-150 ease-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                'select-none',
                // Size lg
                'h-12 px-7 text-base',
                // Outline variant styling
                'bg-transparent text-accent-primary',
                'border-2 border-accent-primary/60',
                'hover:bg-accent-primary/10 hover:border-accent-primary hover:shadow-[0_0_20px_rgba(122,162,247,0.25)]',
                'active:bg-accent-primary/20',
                // Width
                'min-w-[180px]',
              ].join(' ')}
            >
              <GitHubIcon className="h-5 w-5" />
              Star on GitHub
              <Star
                className="h-4 w-4 transition-all duration-200 group-hover:fill-accent-primary group-hover:text-accent-primary"
                aria-hidden="true"
              />
            </a>
          </motion.div>

          {/* Terminal command hint */}
          <motion.div
            variants={itemVariants}
            className="mt-10 flex items-center justify-center"
          >
            <div className="inline-flex items-center gap-2 rounded-md border border-border-muted/50 bg-bg-secondary/50 px-4 py-2 backdrop-blur-sm">
              <span className="font-mono text-xs text-fg-muted">$</span>
              <code className="font-mono text-sm text-fg-secondary">
                bun install -g ralph-tui
              </code>
              <span className="font-mono text-xs text-fg-dim">&&</span>
              <code className="font-mono text-sm text-fg-secondary">
                ralph-tui init
              </code>
            </div>
          </motion.div>
        </motion.div>

        {/* Bottom decorative border line */}
        <motion.div
          variants={lineVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          transition={{ delay: 0.4 }}
          className="mx-auto mt-12 h-px max-w-md bg-gradient-to-r from-transparent via-accent-secondary/40 to-transparent sm:mt-16"
          aria-hidden="true"
        />
      </div>
    </section>
  );
}

export default CTASection;
