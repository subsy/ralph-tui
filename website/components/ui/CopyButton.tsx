/**
 * ABOUTME: Reusable copy-to-clipboard button component with visual feedback.
 * Provides a hook for clipboard functionality and a styled button component
 * that can be used across the website for consistent copy UX.
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * Hook for clipboard copy functionality with visual feedback.
 * Handles both modern clipboard API and fallback for older browsers.
 *
 * @param text - The text to copy to clipboard
 * @param resetDelay - How long to show "Copied!" state (default: 2000ms)
 * @returns Object with `copied` state and `handleCopy` function
 */
export function useCopyToClipboard(text: string, resetDelay = 2000) {
  const [copied, setCopied] = useState(false);
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
    if (!text) return;

    try {
      // Try modern clipboard API first
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for HTTP or older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
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
      timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text, resetDelay]);

  return { copied, handleCopy };
}

/**
 * Props for the CopyButton component.
 */
export interface CopyButtonProps {
  /** Text to copy to clipboard */
  text: string;
  /** Optional className for custom styling */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Whether to show the label text */
  showLabel?: boolean;
  /** Custom aria-label prefix (default: "Copy") */
  ariaLabelPrefix?: string;
}

/**
 * Default button styles
 */
const baseStyles = [
  'flex items-center gap-1.5 rounded-md',
  'font-mono font-medium tracking-wide',
  'transition-all duration-150 ease-out',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
].join(' ');

const sizeStyles = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-2.5 py-1.5 text-xs',
};

const stateStyles = {
  default:
    'bg-bg-tertiary/50 text-fg-muted hover:bg-bg-tertiary hover:text-fg-secondary',
  copied: 'bg-status-success/20 text-status-success',
};

/**
 * Reusable copy button component with clipboard functionality and visual feedback.
 * Shows a copy icon that changes to a check icon when clicked.
 */
export function CopyButton({
  text,
  className = '',
  size = 'sm',
  showLabel = true,
  ariaLabelPrefix = 'Copy',
}: CopyButtonProps) {
  const { copied, handleCopy } = useCopyToClipboard(text);

  const buttonClasses = [
    baseStyles,
    sizeStyles[size],
    copied ? stateStyles.copied : stateStyles.default,
    className,
  ].join(' ');

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={buttonClasses}
      aria-label={copied ? 'Copied!' : ariaLabelPrefix}
    >
      {copied ? (
        <>
          <Check
            className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'}
            aria-hidden="true"
          />
          {showLabel && <span className="hidden sm:inline">Copied!</span>}
        </>
      ) : (
        <>
          <Copy
            className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'}
            aria-hidden="true"
          />
          {showLabel && <span className="hidden sm:inline">Copy</span>}
        </>
      )}
    </button>
  );
}

export default CopyButton;
