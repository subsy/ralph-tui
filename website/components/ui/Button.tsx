/**
 * ABOUTME: Button component with terminal-inspired styling and multiple variants.
 * Supports default (accent), secondary, outline, and ghost variants with sm/default/lg sizes.
 */

'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'default' | 'sm' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Size preset */
  size?: ButtonSize;
  /** Whether button should fill container width */
  fullWidth?: boolean;
}

/**
 * Base styles shared across all button variants.
 * Uses terminal-inspired aesthetics with crisp edges and subtle glow effects.
 */
const baseStyles = [
  // Layout
  'inline-flex items-center justify-center gap-2',
  // Typography
  'font-mono font-medium tracking-wide',
  // Shape
  'rounded-sm',
  // Transitions
  'transition-all duration-150 ease-out',
  // Focus state - terminal cursor glow effect
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
  // Disabled state
  'disabled:pointer-events-none disabled:opacity-50',
  // Selection
  'select-none',
].join(' ');

/**
 * Variant-specific styles.
 * Each variant has a distinct visual treatment while maintaining cohesion.
 */
const variantStyles: Record<ButtonVariant, string> = {
  // Default: Primary accent with terminal glow on hover
  default: [
    'bg-accent-primary text-bg-primary',
    'hover:bg-accent-primary/90 hover:shadow-[0_0_20px_rgba(122,162,247,0.4)]',
    'active:bg-accent-primary/80 active:shadow-[0_0_10px_rgba(122,162,247,0.3)]',
    // Border for crispness
    'border border-accent-primary/50',
  ].join(' '),

  // Secondary: Muted background with accent highlights
  secondary: [
    'bg-bg-tertiary text-fg-primary',
    'hover:bg-bg-highlight hover:text-accent-tertiary',
    'active:bg-bg-secondary',
    'border border-border',
    'hover:border-accent-tertiary/50',
  ].join(' '),

  // Outline: Transparent with visible border, fills on hover
  outline: [
    'bg-transparent text-accent-primary',
    'border-2 border-accent-primary/60',
    'hover:bg-accent-primary/10 hover:border-accent-primary hover:shadow-[0_0_15px_rgba(122,162,247,0.2)]',
    'active:bg-accent-primary/20',
  ].join(' '),

  // Ghost: Minimal style, reveals on hover
  ghost: [
    'bg-transparent text-fg-secondary',
    'hover:bg-bg-tertiary hover:text-fg-primary',
    'active:bg-bg-highlight',
    'border border-transparent',
    'hover:border-border-muted',
  ].join(' '),
};

/**
 * Size-specific styles controlling padding and font size.
 */
const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  default: 'h-10 px-5 text-sm',
  lg: 'h-12 px-7 text-base',
};

/**
 * Button component with terminal-inspired styling.
 *
 * @example
 * // Default accent button
 * <Button>Execute</Button>
 *
 * @example
 * // Outline variant, large size
 * <Button variant="outline" size="lg">Configure</Button>
 *
 * @example
 * // Ghost button for subtle actions
 * <Button variant="ghost" size="sm">Cancel</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'default',
      size = 'default',
      fullWidth = false,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const classes = [
      baseStyles,
      variantStyles[variant],
      sizeStyles[size],
      fullWidth ? 'w-full' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return <button ref={ref} type={type} className={classes} {...props} />;
  }
);

Button.displayName = 'Button';

export type { ButtonProps, ButtonVariant, ButtonSize };
