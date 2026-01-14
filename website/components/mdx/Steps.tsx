/**
 * ABOUTME: Steps component for step-by-step documentation instructions.
 * Renders numbered steps with a vertical connector line in terminal-inspired style.
 * Supports custom titles, descriptions, and nested content for each step.
 */

'use client';

import { type ReactNode, Children, isValidElement, cloneElement } from 'react';
import { motion } from 'framer-motion';

export interface StepProps {
  /** The step title (required) */
  title: string;
  /** Optional description shown below the title */
  description?: string;
  /** The step number (auto-assigned by Steps parent) */
  stepNumber?: number;
  /** Whether this is the last step (auto-assigned by Steps parent) */
  isLast?: boolean;
  /** Content to display inside the step */
  children?: ReactNode;
}

export interface StepsProps {
  /** Step components as children */
  children: ReactNode;
}

/**
 * Container component that wraps multiple Step components.
 * Automatically assigns step numbers and handles connector line logic.
 *
 * @example
 * <Steps>
 *   <Step title="Install dependencies">
 *     Run `bun install` to install all dependencies.
 *   </Step>
 *   <Step title="Configure environment">
 *     Copy `.env.example` to `.env` and fill in values.
 *   </Step>
 *   <Step title="Start the server">
 *     Run `bun dev` to start the development server.
 *   </Step>
 * </Steps>
 */
export function Steps({ children }: StepsProps) {
  const childArray = Children.toArray(children).filter(isValidElement);
  const totalSteps = childArray.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="my-8"
      role="list"
      aria-label="Steps"
    >
      {childArray.map((child, index) => {
        if (isValidElement<StepProps>(child)) {
          return cloneElement(child, {
            stepNumber: index + 1,
            isLast: index === totalSteps - 1,
          });
        }
        return child;
      })}
    </motion.div>
  );
}

/**
 * Individual step component with number indicator and connector line.
 * Used as children of the Steps component.
 */
export function Step({
  title,
  description,
  stepNumber = 1,
  isLast = false,
  children,
}: StepProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: (stepNumber - 1) * 0.1 }}
      className={[
        'relative',
        'pl-12',
        // Add bottom padding except for last step
        isLast ? 'pb-0' : 'pb-8',
      ].join(' ')}
      role="listitem"
    >
      {/* Vertical connector line */}
      {!isLast && (
        <div
          className={[
            'absolute left-[18px] top-8',
            'w-[2px] h-[calc(100%-24px)]',
            // Gradient line that fades down
            'bg-gradient-to-b from-accent-primary/60 via-accent-primary/30 to-accent-primary/10',
          ].join(' ')}
          aria-hidden="true"
        />
      )}

      {/* Step number circle */}
      <div
        className={[
          'absolute left-0 top-0',
          'w-10 h-10',
          'flex items-center justify-center',
          // Terminal-inspired styling
          'rounded-sm',
          'border-2 border-accent-primary',
          'bg-bg-secondary',
          // Subtle inner shadow for depth
          'shadow-inner shadow-bg-primary/50',
          'font-mono text-sm font-bold',
          'text-accent-primary',
          // Glow effect
          'shadow-[0_0_12px_rgba(122,162,247,0.15)]',
        ].join(' ')}
        aria-hidden="true"
      >
        {/* Terminal prompt style */}
        <span className="text-fg-muted mr-0.5 text-xs">$</span>
        {stepNumber}
      </div>

      {/* Step content */}
      <div>
        {/* Title */}
        <h4
          className={[
            'text-lg font-semibold',
            'text-fg-primary',
            'mb-1',
            // Align with the circle
            'pt-[7px]',
          ].join(' ')}
        >
          {title}
        </h4>

        {/* Optional description */}
        {description && (
          <p
            className={[
              'text-sm text-fg-muted',
              'mb-3',
              'font-mono',
            ].join(' ')}
          >
            {description}
          </p>
        )}

        {/* Step content/children */}
        {children && (
          <div
            className={[
              'text-fg-secondary',
              'mt-3',
              // Reset nested MDX prose styles
              '[&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
              // Style nested code blocks
              '[&>pre]:my-3',
              // Nested lists
              '[&>ul]:my-2 [&>ol]:my-2',
            ].join(' ')}
          >
            {children}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default Steps;
