/**
 * ABOUTME: FeatureGrid component showcasing ralph-tui's key features in an
 * interactive grid layout. Uses terminal-inspired aesthetics with hover glow
 * effects, staggered scroll animations, and responsive grid columns.
 */

'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  Database,
  Bot,
  FileCode,
  Save,
  LayoutDashboard,
  GitBranch,
  Terminal,
  Sparkles,
  Heart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Variants } from 'framer-motion';

/**
 * Feature data structure for grid cards.
 */
interface Feature {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accentColor: string;
  glowColor: string;
}

/**
 * Feature definitions for ralph-tui capabilities.
 */
const FEATURES: Feature[] = [
  {
    id: 'task-trackers',
    title: 'Multiple Task Trackers',
    description:
      'Seamlessly integrate with JSON files, Beads issue tracker, or Beads-BV for graph-aware task prioritization.',
    icon: Database,
    accentColor: 'text-accent-primary',
    glowColor: 'rgba(122, 162, 247, 0.35)',
  },
  {
    id: 'ai-agents',
    title: 'AI Agent Plugins',
    description:
      'Run Claude Code, OpenCode, or custom agents with full plugin architecture and real-time output streaming.',
    icon: Bot,
    accentColor: 'text-accent-secondary',
    glowColor: 'rgba(187, 154, 247, 0.35)',
  },
  {
    id: 'prompt-templates',
    title: 'Custom Prompt Templates',
    description:
      'Define reusable Handlebars templates with context injection for consistent, high-quality agent prompts.',
    icon: FileCode,
    accentColor: 'text-accent-tertiary',
    glowColor: 'rgba(125, 207, 255, 0.35)',
  },
  {
    id: 'session-persistence',
    title: 'Session Persistence',
    description:
      'Resume interrupted work seamlessly with automatic state saving and intelligent context recovery.',
    icon: Save,
    accentColor: 'text-status-success',
    glowColor: 'rgba(158, 206, 106, 0.35)',
  },
  {
    id: 'tui-dashboard',
    title: 'Real-time TUI Dashboard',
    description:
      'Monitor agent progress, task status, and system metrics through an elegant terminal interface.',
    icon: LayoutDashboard,
    accentColor: 'text-status-warning',
    glowColor: 'rgba(224, 175, 104, 0.35)',
  },
  {
    id: 'subagent-tracing',
    title: 'Subagent Tracing',
    description:
      'Trace and debug nested agent calls with full visibility into execution paths and decision trees.',
    icon: GitBranch,
    accentColor: 'text-status-error',
    glowColor: 'rgba(247, 118, 142, 0.35)',
  },
  {
    id: 'cli-first',
    title: 'CLI-First Design',
    description:
      'Composable commands, scriptable automation, and full keyboard navigation for terminal power users.',
    icon: Terminal,
    accentColor: 'text-accent-primary',
    glowColor: 'rgba(122, 162, 247, 0.35)',
  },
  {
    id: 'smart-routing',
    title: 'Intelligent Task Routing',
    description:
      'Automatic dependency resolution and parallel execution scheduling based on task graph analysis.',
    icon: Sparkles,
    accentColor: 'text-accent-secondary',
    glowColor: 'rgba(187, 154, 247, 0.35)',
  },
  {
    id: 'faithful-origins',
    title: 'True to Origins',
    description:
      "Designed to be faithful to Geoffrey Huntley's original Ralph approach — autonomous agents working through task backlogs.",
    icon: Heart,
    accentColor: 'text-status-error',
    glowColor: 'rgba(247, 118, 142, 0.35)',
  },
];

/**
 * Animation variants for container with staggered children.
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
};

/**
 * Animation variants for individual feature cards.
 */
const cardVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 24,
    scale: 0.96,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

/**
 * Single feature card component with hover effects.
 */
function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;

  return (
    <motion.article
      variants={cardVariants}
      whileHover={{ y: -6, scale: 1.02 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="group relative h-full"
    >
      {/* Hover glow effect */}
      <div
        className="pointer-events-none absolute -inset-px rounded-lg opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-50"
        style={{ backgroundColor: feature.glowColor }}
        aria-hidden="true"
      />

      {/* Card container */}
      <div className="relative flex h-full flex-col rounded-lg border border-border bg-bg-secondary/70 p-5 backdrop-blur-sm transition-all duration-200 group-hover:border-border-active/50 group-hover:bg-bg-secondary/90">
        {/* Icon container with accent border */}
        <div
          className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-md border border-border-muted bg-bg-tertiary/60 transition-all duration-200 group-hover:border-border-active/40 ${feature.accentColor}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>

        {/* Title */}
        <h3 className="mb-2 font-mono text-base font-semibold tracking-tight text-fg-primary transition-colors duration-200 group-hover:text-accent-primary">
          {feature.title}
        </h3>

        {/* Description */}
        <p className="flex-1 text-sm leading-relaxed text-fg-secondary">
          {feature.description}
        </p>

        {/* Terminal-style status indicator */}
        <div className="mt-4 flex items-center gap-2 border-t border-border-muted pt-3">
          <span
            className="h-1.5 w-1.5 rounded-full bg-status-success"
            aria-hidden="true"
          />
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-dim">
            Available
          </span>
        </div>

        {/* Corner accent decoration */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-12 w-12 opacity-0 transition-opacity duration-300 group-hover:opacity-50"
          aria-hidden="true"
        >
          <svg
            className="h-full w-full"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M48 0V48L0 0H48Z"
              fill="url(#corner-gradient)"
              fillOpacity="0.15"
            />
            <defs>
              <linearGradient
                id="corner-gradient"
                x1="0"
                y1="0"
                x2="48"
                y2="48"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#7aa2f7" />
                <stop offset="1" stopColor="#bb9af7" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    </motion.article>
  );
}

/**
 * FeatureGrid component displaying ralph-tui's key capabilities.
 *
 * Features:
 * - 8 feature cards with icons, titles, and descriptions
 * - Responsive grid: 3 columns (desktop), 2 columns (tablet), 1 column (mobile)
 * - Scroll-triggered staggered reveal animations
 * - Hover effects with glow, lift, and accent highlights
 * - Terminal-inspired dark theme aesthetic
 *
 * @example
 * <FeatureGrid />
 */
export function FeatureGrid() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: '-80px' });

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Subtle background texture */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg-tertiary/20 to-transparent" />

        {/* Dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(circle at center, rgba(122, 162, 247, 0.8) 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      <div className="container mx-auto px-4">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center sm:mb-16"
        >
          <span className="mb-4 inline-block font-mono text-xs uppercase tracking-widest text-accent-primary">
            Capabilities
          </span>
          <h2 className="mb-4 font-mono text-3xl font-bold tracking-tight text-fg-primary sm:text-4xl">
            Built for Power Users
          </h2>
          <p className="mx-auto max-w-2xl text-fg-secondary">
            Everything you need to orchestrate autonomous AI agents at scale,
            from flexible task tracking to deep execution tracing.
          </p>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          ref={containerRef}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="mx-auto grid max-w-6xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:gap-6"
        >
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} />
          ))}
        </motion.div>

        {/* Bottom accent line */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          animate={isInView ? { scaleX: 1, opacity: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.6, ease: 'easeOut' }}
          className="mx-auto mt-16 h-px max-w-lg bg-gradient-to-r from-transparent via-accent-primary/40 to-transparent"
          aria-hidden="true"
        />
      </div>
    </section>
  );
}

export default FeatureGrid;
