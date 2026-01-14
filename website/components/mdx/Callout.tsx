/**
 * ABOUTME: Callout component for documentation with terminal-inspired styling.
 * Supports info (blue), warning (yellow), error (red), and tip (green) variants.
 * Each variant has a distinctive icon, color scheme, and subtle animation.
 */

'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Info,
  AlertTriangle,
  XCircle,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';

/**
 * Callout variant configuration defining icons and color schemes.
 */
interface CalloutVariantConfig {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Display label for the callout type */
  label: string;
  /** Border color class */
  borderColor: string;
  /** Background color class */
  bgColor: string;
  /** Icon/accent color class */
  accentColor: string;
  /** Header background with subtle gradient */
  headerBg: string;
  /** Glow effect color for the border */
  glowColor: string;
}

const variants: Record<string, CalloutVariantConfig> = {
  info: {
    icon: Info,
    label: 'INFO',
    borderColor: 'border-accent-primary',
    bgColor: 'bg-accent-primary/5',
    accentColor: 'text-accent-primary',
    headerBg: 'bg-accent-primary/10',
    glowColor: 'shadow-accent-primary/20',
  },
  warning: {
    icon: AlertTriangle,
    label: 'WARNING',
    borderColor: 'border-status-warning',
    bgColor: 'bg-status-warning/5',
    accentColor: 'text-status-warning',
    headerBg: 'bg-status-warning/10',
    glowColor: 'shadow-status-warning/20',
  },
  error: {
    icon: XCircle,
    label: 'ERROR',
    borderColor: 'border-status-error',
    bgColor: 'bg-status-error/5',
    accentColor: 'text-status-error',
    headerBg: 'bg-status-error/10',
    glowColor: 'shadow-status-error/20',
  },
  tip: {
    icon: Lightbulb,
    label: 'TIP',
    borderColor: 'border-status-success',
    bgColor: 'bg-status-success/5',
    accentColor: 'text-status-success',
    headerBg: 'bg-status-success/10',
    glowColor: 'shadow-status-success/20',
  },
};

export interface CalloutProps {
  /** The callout variant: info (blue), warning (yellow), error (red), or tip (green) */
  variant?: 'info' | 'warning' | 'error' | 'tip';
  /** Optional title displayed in the header */
  title?: string;
  /** Content to display inside the callout */
  children: ReactNode;
}

/**
 * Terminal-inspired callout component for documentation.
 *
 * @example
 * // Basic info callout
 * <Callout variant="info" title="Note">
 *   This is important information.
 * </Callout>
 *
 * @example
 * // Warning without title
 * <Callout variant="warning">
 *   Be careful with this operation.
 * </Callout>
 */
export function Callout({
  variant = 'info',
  title,
  children,
}: CalloutProps) {
  const config = variants[variant];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={[
        // Container base styles
        'my-6 overflow-hidden rounded-sm',
        // Border styling - left accent bar + subtle surrounding border
        'border',
        'border-l-[3px]',
        config.borderColor,
        'border-r-border-muted border-t-border-muted border-b-border-muted',
        // Background
        config.bgColor,
        // Subtle glow effect
        'shadow-sm',
        config.glowColor,
      ].join(' ')}
      role="note"
      aria-label={`${config.label}: ${title || 'Callout'}`}
    >
      {/* Terminal-style header bar */}
      <div
        className={[
          'flex items-center gap-2',
          'px-4 py-2',
          config.headerBg,
          'border-b border-border-muted',
          'font-mono text-xs tracking-wider uppercase',
        ].join(' ')}
      >
        {/* Status indicator dot (like terminal window buttons) */}
        <span
          className={[
            'w-2 h-2 rounded-full',
            config.accentColor.replace('text-', 'bg-'),
            'animate-pulse',
          ].join(' ')}
          aria-hidden="true"
        />
        <Icon
          className={[config.accentColor, 'w-4 h-4'].join(' ')}
          aria-hidden="true"
        />
        <span className={config.accentColor}>
          {title || config.label}
        </span>
      </div>

      {/* Content area */}
      <div
        className={[
          'px-4 py-3',
          'text-fg-secondary',
          // Reset prose styles for nested MDX content
          '[&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
          '[&>ul]:my-2 [&>ol]:my-2',
        ].join(' ')}
      >
        {children}
      </div>
    </motion.div>
  );
}

export default Callout;
