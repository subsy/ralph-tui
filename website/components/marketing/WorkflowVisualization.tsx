/**
 * ABOUTME: WorkflowVisualization component showing the ralph-tui 4-step execution loop.
 * Features a circular/cyclical flow with terminal-inspired aesthetics, scroll-triggered
 * animations, and interactive hover states using framer-motion.
 */

'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Crosshair, Hammer, Zap, CheckCircle, ArrowRight } from 'lucide-react';
import type { Variants } from 'framer-motion';

/**
 * Workflow step data structure.
 */
interface WorkflowStep {
  id: string;
  number: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  glowColor: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'select',
    number: '01',
    title: 'SELECT',
    description: 'Pick next task from the issue tracker based on priority and dependencies',
    icon: Crosshair,
    accentColor: 'text-accent-primary',
    glowColor: 'rgba(122, 162, 247, 0.4)',
  },
  {
    id: 'prompt',
    number: '02',
    title: 'PROMPT',
    description: 'Generate smart prompts from templates with minimal relevant context injection',
    icon: Hammer,
    accentColor: 'text-accent-secondary',
    glowColor: 'rgba(187, 154, 247, 0.4)',
  },
  {
    id: 'evaluate',
    number: '04',
    title: 'EVALUATE',
    description: 'Analyze output to determine completion status and next actions',
    icon: CheckCircle,
    accentColor: 'text-status-success',
    glowColor: 'rgba(158, 206, 106, 0.4)',
  },
  {
    id: 'execute',
    number: '03',
    title: 'EXECUTE',
    description: 'Run autonomous AI coding agent with real-time progress monitoring',
    icon: Zap,
    accentColor: 'text-status-warning',
    glowColor: 'rgba(224, 175, 104, 0.4)',
  },
];

/**
 * Animation variants for staggered reveal.
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
};

const centerVariants: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.6,
      delay: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
};

// Arrow variants for future animation use
const _arrowVariants: Variants = {
  hidden: { opacity: 0, pathLength: 0 },
  visible: {
    opacity: 1,
    pathLength: 1,
    transition: {
      duration: 0.8,
      delay: 0.7,
      ease: 'easeOut' as const,
    },
  },
};

/**
 * Single workflow step card component.
 */
function WorkflowStepCard({ step, index: _index }: { step: WorkflowStep; index: number }) {
  const Icon = step.icon;

  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ scale: 1.02, y: -4 }}
      className="group relative"
    >
      {/* Glow effect on hover */}
      <div
        className="absolute -inset-1 rounded-lg opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-50"
        style={{ backgroundColor: step.glowColor }}
        aria-hidden="true"
      />

      {/* Card content */}
      <div className="relative flex flex-col gap-4 rounded-lg border border-border bg-bg-secondary/80 p-6 backdrop-blur-sm transition-colors duration-200 group-hover:border-border-active/60">
        {/* Step number and icon row */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tracking-widest text-fg-muted">
            {step.number}
          </span>
          <div
            className={`rounded-md border border-border-muted bg-bg-tertiary/50 p-2.5 transition-all duration-200 group-hover:border-border-active/40 ${step.accentColor}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>

        {/* Title */}
        <h3
          className={`font-mono text-xl font-bold tracking-tight transition-colors duration-200 ${step.accentColor}`}
        >
          {step.title}
        </h3>

        {/* Description */}
        <p className="text-sm leading-relaxed text-fg-secondary">
          {step.description}
        </p>

        {/* Terminal-style decorator */}
        <div className="flex items-center gap-2 border-t border-border-muted pt-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-dim">
            Ready
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Simple arrows connecting workflow steps in clockwise order (desktop only).
 * SELECT → PROMPT → EXECUTE → EVALUATE → loop
 */
function CircularFlowArrows() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {/* Lines - centered in gaps between card pairs */}
      {/* Arrow 1: SELECT → PROMPT (top horizontal gap, centered at x=50) */}
      <line x1="46" y1="25" x2="51" y2="25" stroke="rgb(var(--fg-muted))" strokeWidth="0.8" opacity="0.5" />
      {/* Arrow 2: PROMPT → EXECUTE (right vertical gap, centered at y=50) */}
      <line x1="75" y1="46" x2="75" y2="51" stroke="rgb(var(--fg-muted))" strokeWidth="0.8" opacity="0.5" />
      {/* Arrow 3: EXECUTE → EVALUATE (bottom horizontal gap, centered at x=50) */}
      <line x1="54" y1="75" x2="49" y2="75" stroke="rgb(var(--fg-muted))" strokeWidth="0.8" opacity="0.5" />
      {/* Arrow 4: EVALUATE → SELECT (left vertical gap, centered at y=50) */}
      <line x1="25" y1="54" x2="25" y2="49" stroke="rgb(var(--fg-muted))" strokeWidth="0.8" opacity="0.5" />

      {/* Arrowheads - centered with lines */}
      <path d="M 51 23.5 L 54 25 L 51 26.5 Z" fill="rgb(var(--fg-muted))" opacity="0.5" />
      <path d="M 73.5 51 L 75 54 L 76.5 51 Z" fill="rgb(var(--fg-muted))" opacity="0.5" />
      <path d="M 49 76.5 L 46 75 L 49 73.5 Z" fill="rgb(var(--fg-muted))" opacity="0.5" />
      <path d="M 26.5 49 L 25 46 L 23.5 49 Z" fill="rgb(var(--fg-muted))" opacity="0.5" />
    </svg>
  );
}

/**
 * Mobile flow arrows between steps.
 */
function MobileFlowArrow({ color }: { color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="flex justify-center py-2"
    >
      <ArrowRight
        className={`h-6 w-6 rotate-90 ${color}`}
        aria-hidden="true"
      />
    </motion.div>
  );
}

/**
 * Central loop indicator for the circular layout.
 */
function CentralLoopIndicator() {
  return (
    <motion.div
      variants={centerVariants}
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <div className="relative">
        {/* Outer glow ring */}
        <div
          className="absolute -inset-5 animate-pulse rounded-full bg-accent-primary/10 blur-xl"
          aria-hidden="true"
        />

        {/* Inner content */}
        <div className="relative flex h-32 w-32 flex-col items-center justify-center rounded-full border border-border-active/40 bg-bg-secondary/90 backdrop-blur-sm">
          {/* Rotating ring effect */}
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent"
            style={{
              borderTopColor: 'rgba(122, 162, 247, 0.5)',
              animation: 'spin 8s linear infinite',
            }}
            aria-hidden="true"
          />

          {/* Text */}
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            Ralph
          </span>
          <span className="font-mono text-lg font-bold tracking-tight text-accent-primary">
            LOOP
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * WorkflowVisualization component displaying the 4-step ralph-tui execution loop.
 *
 * Features:
 * - Circular/cyclical layout on desktop (2x2 grid with center indicator)
 * - Vertical stack on mobile with connecting arrows
 * - Scroll-triggered staggered animations
 * - Hover effects with glow and lift
 * - Terminal-inspired dark theme aesthetic
 *
 * @example
 * <WorkflowVisualization />
 */
export function WorkflowVisualization() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: '-100px' });

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Background effects */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        {/* Subtle gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg-secondary/30 to-transparent" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(122, 162, 247, 0.5) 1px, transparent 1px),
              linear-gradient(90deg, rgba(122, 162, 247, 0.5) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="container mx-auto px-4">
        {/* Section header */}
        <div className="mb-12 text-center sm:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
          >
            <span className="mb-4 inline-block font-mono text-xs uppercase tracking-widest text-accent-primary">
              How It Works
            </span>
            <h2 className="mb-4 font-mono text-3xl font-bold tracking-tight text-fg-primary sm:text-4xl">
              The Execution Loop
            </h2>
            <p className="mx-auto max-w-2xl text-fg-secondary">
              Ralph TUI orchestrates autonomous AI agents through a continuous
              four-step cycle, processing tasks until your entire backlog is
              complete.
            </p>
          </motion.div>
        </div>

        {/* Workflow visualization */}
        <motion.div
          ref={containerRef}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="relative mx-auto max-w-4xl"
        >
          {/* Desktop: 2x2 grid with circular flow */}
          <div className="hidden md:block">
            <div className="relative aspect-square max-w-[600px] mx-auto">
              {/* Grid of cards */}
              <div className="grid grid-cols-2 gap-16 p-8">
                {WORKFLOW_STEPS.map((step, index) => (
                  <WorkflowStepCard key={step.id} step={step} index={index} />
                ))}
              </div>

              {/* Circular flow arrows - positioned above cards */}
              <div className="absolute inset-0 z-10 pointer-events-none">
                <CircularFlowArrows />
              </div>

              {/* Central loop indicator */}
              <CentralLoopIndicator />
            </div>
          </div>

          {/* Mobile: Vertical stack with arrows */}
          <div className="md:hidden">
            <div className="flex flex-col">
              {WORKFLOW_STEPS.map((step, index) => (
                <div key={step.id}>
                  <WorkflowStepCard step={step} index={index} />
                  {index < WORKFLOW_STEPS.length - 1 && (
                    <MobileFlowArrow
                      color={WORKFLOW_STEPS[index + 1].accentColor}
                    />
                  )}
                </div>
              ))}
              {/* Loop back arrow */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ delay: 0.8 }}
                className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border-muted bg-bg-secondary/50 py-3"
              >
                <ArrowRight
                  className="-rotate-90 h-4 w-4 text-accent-primary"
                  aria-hidden="true"
                />
                <span className="font-mono text-xs uppercase tracking-widest text-fg-muted">
                  Loop continues
                </span>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Inline keyframes for spin animation */}
      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </section>
  );
}

export default WorkflowVisualization;
