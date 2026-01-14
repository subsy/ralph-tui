/**
 * ABOUTME: Custom MDX components registry for documentation pages.
 * Maps HTML elements and custom components for MDX rendering with
 * terminal-inspired styling consistent with the Ralph TUI theme.
 */

import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { CodeBlock } from '@/components/ui';
import { Callout, Steps, Step, Tabs, TabsRoot, TabsList, TabsTrigger, TabsContent } from '@/components/mdx';

/**
 * Custom link component that handles internal vs external links.
 */
function CustomLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isInternal = href?.startsWith('/') || href?.startsWith('#');

  if (isInternal && href) {
    return (
      <Link
        href={href}
        className={[
          'text-accent-primary',
          'underline decoration-accent-primary/30 underline-offset-2',
          'transition-colors duration-150',
          'hover:text-accent-tertiary hover:decoration-accent-tertiary/50',
        ].join(' ')}
        {...props}
      >
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        'text-accent-primary',
        'underline decoration-accent-primary/30 underline-offset-2',
        'transition-colors duration-150',
        'hover:text-accent-tertiary hover:decoration-accent-tertiary/50',
        // External link indicator
        "after:content-['_↗'] after:text-[0.7em] after:opacity-60",
      ].join(' ')}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * Custom heading components with anchor links.
 */
function H1({ children, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      id={id}
      className={[
        'scroll-mt-24',
        'text-3xl font-bold tracking-tight',
        'text-fg-primary',
        'mt-8 mb-4 first:mt-0',
        // Gradient accent on first heading
        'first:bg-gradient-to-r first:from-accent-primary first:via-accent-secondary first:to-accent-tertiary',
        'first:bg-clip-text first:text-transparent',
      ].join(' ')}
      {...props}
    >
      {children}
    </h1>
  );
}

function H2({ children, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      id={id}
      className={[
        'group scroll-mt-24',
        'text-2xl font-semibold tracking-tight',
        'text-fg-primary',
        'mt-12 mb-4',
        'border-b border-border pb-2',
      ].join(' ')}
      {...props}
    >
      {children}
    </h2>
  );
}

function H3({ children, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      id={id}
      className={[
        'group scroll-mt-24',
        'text-xl font-semibold',
        'text-fg-primary',
        'mt-8 mb-3',
      ].join(' ')}
      {...props}
    >
      {children}
    </h3>
  );
}

function H4({ children, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4
      id={id}
      className={[
        'scroll-mt-24',
        'text-lg font-medium',
        'text-fg-secondary',
        'mt-6 mb-2',
      ].join(' ')}
      {...props}
    >
      {children}
    </h4>
  );
}

/**
 * Custom paragraph with proper spacing.
 */
function P({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={[
        'text-fg-secondary',
        'leading-7',
        'my-4',
      ].join(' ')}
      {...props}
    >
      {children}
    </p>
  );
}

/**
 * Custom list components with terminal-inspired bullets.
 */
function Ul({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={[
        'my-4 ml-4 space-y-2',
        'list-none', // Remove default bullets
        // Custom bullet using accent color
        '[&>li]:relative [&>li]:pl-5',
        "[&>li]:before:content-['▸'] [&>li]:before:absolute [&>li]:before:left-0",
        '[&>li]:before:text-accent-primary [&>li]:before:text-sm',
      ].join(' ')}
      {...props}
    >
      {children}
    </ul>
  );
}

function Ol({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      className={[
        'my-4 ml-4 space-y-2',
        'list-none [counter-reset:item]',
        // Custom numbered list with accent color
        '[&>li]:relative [&>li]:pl-7 [&>li]:[counter-increment:item]',
        "[&>li]:before:content-[counter(item)'.'] [&>li]:before:absolute [&>li]:before:left-0",
        '[&>li]:before:text-accent-primary [&>li]:before:font-mono [&>li]:before:text-sm',
      ].join(' ')}
      {...props}
    >
      {children}
    </ol>
  );
}

/**
 * Custom blockquote with terminal-style border.
 */
function Blockquote({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      className={[
        'my-6 py-3 pl-4 pr-4',
        'border-l-2 border-accent-primary',
        'bg-bg-secondary/50',
        'rounded-r-sm',
        'text-fg-secondary italic',
        // Info icon style
        'relative',
      ].join(' ')}
      {...props}
    >
      <div className="absolute -left-3 top-3 w-5 h-5 rounded-full bg-bg-primary flex items-center justify-center">
        <span className="text-accent-primary text-xs font-bold">i</span>
      </div>
      {children}
    </blockquote>
  );
}

/**
 * Custom code block wrapper for syntax-highlighted code.
 * Works with rehype-pretty-code output.
 */
function Pre({
  children,
  ...props
}: React.HTMLAttributes<HTMLPreElement> & { 'data-language'?: string; raw?: string }) {
  // Extract language from data attribute
  const dataLanguage =
    (props as { 'data-language'?: string })['data-language'] ||
    // Try to get from child element
    (typeof children === 'object' &&
    children !== null &&
    'props' in children &&
    typeof (children as { props?: { className?: string } }).props?.className === 'string'
      ? (children as { props: { className: string } }).props.className.match(/language-(\w+)/)?.[1]
      : undefined);

  // Get raw code for copy functionality
  const rawCode =
    (props as { raw?: string }).raw ||
    (typeof children === 'object' &&
    children !== null &&
    'props' in children &&
    'children' in (children as { props: { children?: unknown } }).props
      ? String((children as { props: { children: unknown } }).props.children || '')
      : '');

  return (
    <CodeBlock language={dataLanguage} code={rawCode} className="my-6">
      <pre {...props}>{children}</pre>
    </CodeBlock>
  );
}

/**
 * Inline code styling.
 */
function Code({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
  // Check if this is inside a pre (block code) - don't style it
  const className = props.className || '';
  if (className.includes('language-')) {
    return <code {...props}>{children}</code>;
  }

  return (
    <code
      className={[
        'rounded px-1.5 py-0.5',
        'bg-bg-tertiary',
        'font-mono text-sm',
        'text-accent-tertiary',
      ].join(' ')}
      {...props}
    >
      {children}
    </code>
  );
}

/**
 * Custom horizontal rule with decorative styling.
 */
function Hr(props: React.HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      className={[
        'my-8 border-none',
        'h-px',
        'bg-gradient-to-r from-transparent via-border to-transparent',
      ].join(' ')}
      {...props}
    />
  );
}

/**
 * Custom table components with terminal-inspired styling.
 */
function Table({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="my-6 overflow-x-auto rounded-sm border border-border">
      <table
        className={[
          'w-full border-collapse',
          'font-mono text-sm',
        ].join(' ')}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

function Th({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={[
        'px-4 py-3',
        'bg-bg-secondary',
        'border-b border-border',
        'text-left font-semibold',
        'text-fg-primary',
      ].join(' ')}
      {...props}
    >
      {children}
    </th>
  );
}

function Td({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={[
        'px-4 py-3',
        'border-b border-border-muted',
        'text-fg-secondary',
      ].join(' ')}
      {...props}
    >
      {children}
    </td>
  );
}

/**
 * Custom image component with proper styling.
 */
function Img(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      className={[
        'my-6 rounded-sm',
        'border border-border',
        'max-w-full h-auto',
      ].join(' ')}
      alt={props.alt || ''}
      {...props}
    />
  );
}

/**
 * Base MDX components object for direct import.
 * Use this when you need components outside of a React component context
 * (e.g., in server components with compileMDX).
 */
export const mdxComponents: MDXComponents = {
  // HTML element overrides
  a: CustomLink,
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
  p: P,
  ul: Ul,
  ol: Ol,
  blockquote: Blockquote,
  pre: Pre,
  code: Code,
  hr: Hr,
  table: Table,
  th: Th,
  td: Td,
  img: Img,

  // Custom components available in MDX
  Callout,
  CodeBlock,

  // Steps component for step-by-step instructions
  Steps,
  Step,

  // Tabs components for tabbed content (e.g., package managers)
  Tabs,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
};

/**
 * Returns custom MDX components for use with @next/mdx.
 * This follows the convention expected by @next/mdx.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...mdxComponents,
    // Spread any additional components
    ...components,
  };
}
