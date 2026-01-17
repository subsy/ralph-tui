/**
 * ABOUTME: Terminal-style command block with copy-to-clipboard functionality.
 * Displays a command with a $ prompt. Click anywhere to copy. Supports different
 * visual variants for use in hero sections vs inline contexts.
 */

'use client';

import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from './CopyButton';

/**
 * Props for the CopyableCommand component.
 */
export interface CopyableCommandProps {
  /** The command text to display and copy */
  children: string;
  /** Visual variant - 'hero' has more prominent styling with glow effects */
  variant?: 'default' | 'hero';
  /** Optional className for the outer container */
  className?: string;
}

/**
 * Button styles for the command block.
 */
const buttonStyles = {
  default: [
    'group relative inline-flex items-center justify-between gap-4',
    'cursor-pointer',
    'rounded-md border border-border-muted/50',
    'bg-bg-primary backdrop-blur-sm',
    'px-4 py-2',
    'transition-all duration-150',
    'hover:border-border-muted',
  ].join(' '),
  hero: [
    'group relative flex w-full max-w-md items-center justify-between gap-4',
    'cursor-pointer',
    'rounded-lg border border-border-active/40',
    'bg-bg-primary backdrop-blur-sm',
    'px-4 py-3',
    'transition-all duration-150',
    'hover:border-border-active/60',
  ].join(' '),
};

/**
 * Glow effect styles - subtle border glow, not filling the box.
 */
const glowStyles = [
  'absolute -inset-0.5 -z-10 rounded-lg',
  'bg-gradient-to-r from-accent-primary/20 via-accent-secondary/20 to-accent-tertiary/20',
  'opacity-0 blur-sm',
  'transition-opacity duration-300 group-hover:opacity-30',
].join(' ');

/**
 * Code text styles - bg-transparent overrides global inline code styling.
 */
const codeStyles = {
  default: 'bg-transparent px-0 py-0 font-mono text-sm text-fg-secondary',
  hero: 'bg-transparent px-0 py-0 font-mono text-sm text-fg-primary sm:text-base',
};

/**
 * Prompt ($) styles.
 */
const promptStyles = {
  default: 'text-fg-muted',
  hero: 'text-accent-tertiary',
};

/**
 * Copy indicator styles.
 */
const indicatorStyles = {
  default:
    'text-fg-muted group-hover:text-fg-secondary transition-colors duration-150 shrink-0',
  hero: 'text-fg-muted group-hover:text-fg-secondary transition-colors duration-150 shrink-0',
};

const copiedIndicatorStyles = 'text-status-success shrink-0';

/**
 * Terminal-style command block with copy functionality.
 *
 * Click anywhere on the block to copy the command. The $ prompt is visual only
 * and not included in the copied text.
 *
 * @example
 * // Simple inline command
 * <CopyableCommand>npm install react</CopyableCommand>
 *
 * @example
 * // Hero section with prominent styling
 * <CopyableCommand variant="hero">bun install -g ralph-tui</CopyableCommand>
 *
 * @example
 * // Multi-part command with &&
 * <CopyableCommand variant="hero">bun install -g ralph-tui && ralph-tui init</CopyableCommand>
 */
export function CopyableCommand({
  children,
  variant = 'default',
  className = '',
}: CopyableCommandProps) {
  const { copied, handleCopy } = useCopyToClipboard(children);

  const buttonClass = [buttonStyles[variant], className]
    .filter(Boolean)
    .join(' ');

  const iconSize = variant === 'hero' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={buttonClass}
      aria-label={copied ? 'Copied!' : `Copy command: ${children}`}
    >
      {/* Glow effect */}
      <div className={glowStyles} aria-hidden="true" />

      {/* Terminal prompt and command */}
      <code className={codeStyles[variant]}>
        <span className={promptStyles[variant]} aria-hidden="true">
          ${' '}
        </span>
        {children}
      </code>

      {/* Copy indicator */}
      <span
        className={copied ? copiedIndicatorStyles : indicatorStyles[variant]}
        aria-hidden="true"
      >
        {copied ? (
          <Check className={iconSize} />
        ) : (
          <Copy className={iconSize} />
        )}
      </span>
    </button>
  );
}

export default CopyableCommand;
