/**
 * ABOUTME: Tabs component built on Radix UI for tabbed documentation content.
 * Perfect for showing code examples in different languages or package managers.
 * Features terminal-inspired styling with smooth transitions.
 */

'use client';

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef, type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'framer-motion';

/**
 * Root tabs container component.
 * Wraps TabsList and TabsContent components.
 */
const TabsRoot = forwardRef<
  ComponentRef<typeof TabsPrimitive.Root>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className = '', ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    className={[
      'my-6',
      className,
    ].join(' ')}
    {...props}
  />
));
TabsRoot.displayName = 'Tabs';

/**
 * Tabs list container for tab triggers.
 * Renders as a horizontal list with terminal-style tab buttons.
 */
const TabsList = forwardRef<
  ComponentRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className = '', ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={[
      'flex',
      'overflow-x-auto',
      // Terminal tab bar styling
      'bg-bg-tertiary',
      'rounded-t-sm',
      'border border-b-0 border-border',
      // Hide scrollbar but allow scroll
      'scrollbar-none',
      className,
    ].join(' ')}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

/**
 * Individual tab trigger button.
 * Shows as an inactive tab until selected.
 */
const TabsTrigger = forwardRef<
  ComponentRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className = '', children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={[
      'relative',
      'px-4 py-2.5',
      // Typography
      'font-mono text-sm',
      'whitespace-nowrap',
      // Default state
      'text-fg-muted',
      'border-b-2 border-transparent',
      'transition-all duration-200',
      // Hover state
      'hover:text-fg-secondary',
      'hover:bg-bg-highlight/30',
      // Active/selected state
      'data-[state=active]:text-accent-primary',
      'data-[state=active]:border-accent-primary',
      'data-[state=active]:bg-bg-secondary',
      // Focus state
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50',
      className,
    ].join(' ')}
    {...props}
  >
    {/* Terminal command prefix for visual interest */}
    <span className="text-fg-dim mr-1.5" aria-hidden="true">
      {'>'}{' '}
    </span>
    {children}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

/**
 * Tab content panel that appears when its corresponding trigger is active.
 */
const TabsContent = forwardRef<
  ComponentRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className = '', children, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={[
      'rounded-b-sm',
      'border border-t-0 border-border',
      'bg-bg-secondary',
      'p-4',
      // Focus state
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50',
      // Reset prose styles for nested MDX content
      '[&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
      '[&>pre]:my-0',
      className,
    ].join(' ')}
    {...props}
  >
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  </TabsPrimitive.Content>
));
TabsContent.displayName = 'TabsContent';

/**
 * Pre-composed Tabs component for common use cases like package manager tabs.
 * Provides a simpler API for basic tabbed content.
 */
export interface TabItem {
  /** Unique identifier for the tab */
  value: string;
  /** Display label for the tab trigger */
  label: string;
  /** Content to show when this tab is active */
  content: ReactNode;
}

export interface TabsComposedProps {
  /** Array of tab items to render */
  items: TabItem[];
  /** Default active tab value */
  defaultValue?: string;
  /** Additional className for the root element */
  className?: string;
}

/**
 * Simplified composed Tabs component for easy use in MDX.
 *
 * @example
 * <Tabs
 *   items={[
 *     { value: 'npm', label: 'npm', content: <pre>npm install ralph-tui</pre> },
 *     { value: 'bun', label: 'bun', content: <pre>bun add ralph-tui</pre> },
 *     { value: 'pnpm', label: 'pnpm', content: <pre>pnpm add ralph-tui</pre> },
 *   ]}
 * />
 */
function TabsComposed({ items, defaultValue, className = '' }: TabsComposedProps) {
  const firstValue = items[0]?.value || '';

  return (
    <TabsRoot defaultValue={defaultValue || firstValue} className={className}>
      <TabsList>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.value} value={item.value}>
          {item.content}
        </TabsContent>
      ))}
    </TabsRoot>
  );
}

// Export both compound components and composed version
export const Tabs = Object.assign(TabsComposed, {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
});

export {
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
};

export default Tabs;
