/**
 * ABOUTME: PlanningPhase component explaining the AI-driven PRD generation
 * and atomic task creation that happens before the execution loop.
 * Features a two-column layout with terminal-inspired aesthetics.
 */

'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { FileText, GitBranch, Sparkles, CheckSquare } from 'lucide-react';
import type { Variants } from 'framer-motion';

/**
 * Planning step data structure.
 */
interface PlanningStep {
  id: string;
  number: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  features: string[];
  accentColor: string;
  glowColor: string;
}

const PLANNING_STEPS: PlanningStep[] = [
  {
    id: 'prd-generation',
    number: '01',
    title: 'AI-Driven PRD Generation',
    description:
      'Interactively create comprehensive Product Requirements Documents through natural conversation with AI.',
    icon: FileText,
    features: [
      'Natural language feature description',
      'Clarifying questions with smart defaults',
      'Structured user stories with acceptance criteria',
      'Automatic scope boundary definition',
    ],
    accentColor: 'text-accent-primary',
    glowColor: 'rgba(122, 162, 247, 0.4)',
  },
  {
    id: 'task-decomposition',
    number: '02',
    title: 'Atomic Task Creation',
    description:
      'Transform PRDs into dependency-aware, right-sized tasks that agents can complete in a single iteration.',
    icon: GitBranch,
    features: [
      'Automatic dependency graph generation',
      'Context-window-aware task sizing',
      'Priority-based execution ordering',
      'Quality gates baked into each task',
    ],
    accentColor: 'text-accent-secondary',
    glowColor: 'rgba(187, 154, 247, 0.4)',
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
      staggerChildren: 0.2,
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

/**
 * Single planning step card component.
 */
function PlanningStepCard({ step }: { step: PlanningStep }) {
  const Icon = step.icon;

  return (
    <motion.div variants={itemVariants} className="group relative h-full">
      {/* Glow effect on hover */}
      <div
        className="absolute -inset-1 rounded-xl opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-50"
        style={{ backgroundColor: step.glowColor }}
        aria-hidden="true"
      />

      {/* Card content */}
      <div className="relative flex h-full flex-col gap-5 rounded-xl border border-border bg-bg-secondary/80 p-6 backdrop-blur-sm transition-colors duration-200 group-hover:border-border-active/60 sm:p-8">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <span className="mb-2 block font-mono text-xs tracking-widest text-fg-muted">
              STEP {step.number}
            </span>
            <h3
              className={`font-mono text-xl font-bold tracking-tight sm:text-2xl ${step.accentColor}`}
            >
              {step.title}
            </h3>
          </div>
          <div
            className={`rounded-lg border border-border-muted bg-bg-tertiary/50 p-3 transition-all duration-200 group-hover:border-border-active/40 ${step.accentColor}`}
          >
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>

        {/* Description */}
        <p className="text-base leading-relaxed text-fg-secondary">
          {step.description}
        </p>

        {/* Features list */}
        <ul className="flex-grow space-y-2.5">
          {step.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <CheckSquare
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${step.accentColor}`}
                aria-hidden="true"
              />
              <span className="text-sm text-fg-secondary">{feature}</span>
            </li>
          ))}
        </ul>

        {/* Terminal-style decorator */}
        <div className="mt-auto flex items-center gap-2 border-t border-border-muted pt-4">
          <Sparkles className="h-3.5 w-3.5 text-status-success" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-dim">
            AI-Powered
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * PlanningPhase component displaying the pre-execution planning workflow.
 *
 * @example
 * <PlanningPhase />
 */
export function PlanningPhase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: '-100px' });

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Background effects */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        {/* Subtle gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-bg-primary via-bg-secondary/20 to-bg-primary" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(187, 154, 247, 0.5) 1px, transparent 1px),
              linear-gradient(90deg, rgba(187, 154, 247, 0.5) 1px, transparent 1px)
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
            <span className="mb-4 inline-block font-mono text-xs uppercase tracking-widest text-accent-secondary">
              Before You Execute
            </span>
            <h2 className="mb-4 font-mono text-3xl font-bold tracking-tight text-fg-primary sm:text-4xl">
              The Planning Phase
            </h2>
            <p className="mx-auto max-w-2xl text-fg-secondary">
              Great autonomous execution starts with great planning. Ralph TUI
              helps you create structured, dependency-aware task breakdowns
              through interactive AI collaboration.
            </p>
          </motion.div>
        </div>

        {/* Planning steps grid */}
        <motion.div
          ref={containerRef}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2"
        >
          {PLANNING_STEPS.map((step) => (
            <PlanningStepCard key={step.id} step={step} />
          ))}
        </motion.div>

        {/* Connecting arrow to execution phase */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-12 flex flex-col items-center gap-2 sm:mt-16"
        >
          <span className="font-mono text-xs uppercase tracking-widest text-fg-muted">
            Then execute
          </span>
          <div className="flex flex-col items-center gap-1">
            <div className="h-8 w-px bg-gradient-to-b from-accent-secondary/50 to-transparent" />
            <div className="h-2 w-2 rotate-45 border-b border-r border-accent-secondary/50" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default PlanningPhase;
