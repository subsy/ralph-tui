/**
 * ABOUTME: Central export for all custom MDX components.
 * These components are registered in mdx-components.tsx for use in documentation.
 */

// Callout component for tips, warnings, errors, and info boxes
export { Callout, type CalloutProps } from './Callout';

// Steps component for step-by-step instructions
export { Steps, Step, type StepsProps, type StepProps } from './Steps';

// Tabs component for tabbed content (e.g., different package managers)
export {
  Tabs,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabItem,
  type TabsComposedProps,
} from './Tabs';
