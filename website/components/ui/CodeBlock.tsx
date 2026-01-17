/**
 * ABOUTME: CodeBlock component that wraps shiki/rehype-pretty-code output.
 * Features a language badge, copy-to-clipboard with feedback, and terminal-inspired styling.
 */

'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { CopyButton } from './CopyButton';

interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
  /** Programming language for the badge display */
  language?: string;
  /** Code content as string (for copy functionality) */
  code?: string;
  /** Whether to show line numbers */
  showLineNumbers?: boolean;
  /** Custom title for the code block header */
  title?: string;
  /** Pre-highlighted code from rehype-pretty-code (children) */
  children?: ReactNode;
}

/**
 * Language display names for common languages.
 * Maps file extensions/identifiers to human-readable labels.
 */
const languageLabels: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  jsx: 'JSX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  mdx: 'MDX',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  sql: 'SQL',
  graphql: 'GraphQL',
  dockerfile: 'Dockerfile',
  docker: 'Docker',
  plaintext: 'Text',
  text: 'Text',
  txt: 'Text',
};

/**
 * Get display label for a language.
 */
function getLanguageLabel(lang?: string): string {
  if (!lang) return '';
  const normalized = lang.toLowerCase().trim();
  return languageLabels[normalized] || lang.toUpperCase();
}

/**
 * Base container styles - terminal window aesthetic.
 */
const containerStyles = [
  'group relative',
  'rounded-sm',
  'border border-border',
  'bg-bg-primary',
  'overflow-hidden',
  'transition-all duration-200 ease-out',
  // Subtle glow on hover
  'hover:border-border-active/30',
  'hover:shadow-[0_0_20px_rgba(122,162,247,0.08)]',
].join(' ');

/**
 * Header bar styles - mimics terminal title bar.
 */
const headerStyles = [
  'flex items-center justify-between',
  'px-4 py-2',
  'border-b border-border-muted',
  'bg-bg-secondary/50',
].join(' ');

/**
 * Language badge styles.
 */
const badgeStyles = [
  'inline-flex items-center',
  'px-2 py-0.5',
  'rounded-sm',
  'bg-bg-tertiary',
  'border border-border-muted',
  'font-mono text-[10px] font-medium tracking-wider uppercase',
  'text-fg-muted',
  'select-none',
].join(' ');

/**
 * Code content wrapper styles.
 */
const codeWrapperStyles = [
  'overflow-x-auto',
  'p-4',
  // Custom scrollbar styling
  '[&::-webkit-scrollbar]:h-2',
  '[&::-webkit-scrollbar-track]:bg-bg-secondary',
  '[&::-webkit-scrollbar-thumb]:bg-bg-highlight',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb:hover]:bg-fg-dim',
].join(' ');

/**
 * Pre element styles for code content.
 */
const preStyles = [
  'font-mono text-sm leading-relaxed',
  'text-fg-primary',
  'm-0 p-0',
  'bg-transparent',
  // Style code elements
  '[&_code]:bg-transparent',
  '[&_code]:p-0',
  '[&_code]:font-mono',
  '[&_code]:text-sm',
  // Line number styling
  '[&_.line]:inline-block',
  '[&_.line-number]:inline-block',
  '[&_.line-number]:w-8',
  '[&_.line-number]:mr-4',
  '[&_.line-number]:text-right',
  '[&_.line-number]:text-fg-dim',
  '[&_.line-number]:select-none',
  // Highlighted line styling
  '[&_.highlighted]:bg-accent-primary/10',
  '[&_.highlighted]:border-l-2',
  '[&_.highlighted]:border-accent-primary',
  '[&_.highlighted]:pl-3',
  '[&_.highlighted]:-ml-4',
  '[&_.highlighted]:pr-4',
].join(' ');

/**
 * Terminal decoration dots (optional visual element).
 */
function TerminalDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full bg-status-error/60" />
      <span className="h-2.5 w-2.5 rounded-full bg-status-warning/60" />
      <span className="h-2.5 w-2.5 rounded-full bg-status-success/60" />
    </div>
  );
}

/**
 * CodeBlock component that wraps syntax-highlighted code with terminal styling.
 *
 * @example
 * // Basic usage with pre-highlighted content
 * <CodeBlock language="typescript">
 *   <pre><code>const x = 1;</code></pre>
 * </CodeBlock>
 *
 * @example
 * // With copy functionality
 * <CodeBlock language="bash" code="npm install react">
 *   <pre><code>npm install react</code></pre>
 * </CodeBlock>
 *
 * @example
 * // With custom title
 * <CodeBlock language="tsx" title="components/Button.tsx" code={sourceCode}>
 *   {highlightedCode}
 * </CodeBlock>
 */
export const CodeBlock = forwardRef<HTMLDivElement, CodeBlockProps>(
  (
    {
      className = '',
      language,
      code,
      showLineNumbers = false,
      title,
      children,
      ...props
    },
    ref,
  ) => {
    const displayLabel = getLanguageLabel(language);
    const showHeader = displayLabel || title || code;

    const classes = [containerStyles, className].filter(Boolean).join(' ');

    return (
      <div ref={ref} className={classes} {...props}>
        {/* Header bar with terminal dots, language badge, and copy button */}
        {showHeader && (
          <div className={headerStyles}>
            <div className="flex items-center gap-3">
              <TerminalDots />
              {title && (
                <span className="font-mono text-xs text-fg-secondary truncate max-w-[200px]">
                  {title}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {displayLabel && (
                <span className={badgeStyles}>{displayLabel}</span>
              )}

              {code && (
                <CopyButton
                  text={code}
                  size="sm"
                  ariaLabelPrefix="Copy code to clipboard"
                />
              )}
            </div>
          </div>
        )}

        {/* Code content area */}
        <div
          className={`${codeWrapperStyles} ${showLineNumbers ? '[&_.line-number]:inline-block' : '[&_.line-number]:hidden'}`}
        >
          <div className={preStyles}>{children}</div>
        </div>
      </div>
    );
  },
);

CodeBlock.displayName = 'CodeBlock';

export type { CodeBlockProps };
