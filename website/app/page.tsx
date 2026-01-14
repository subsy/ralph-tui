/**
 * ABOUTME: Home page component for the Ralph TUI website.
 * Composes the full landing page with Hero, WorkflowVisualization,
 * FeatureGrid, and CTASection marketing components.
 */

import {
  Hero,
  PlanningPhase,
  WorkflowVisualization,
  FeatureGrid,
  CTASection,
} from '@/components/marketing';

export default function Home() {
  return (
    <main className="flex flex-col">
      {/* Hero Section - Above the fold with headline, install command, and CTAs */}
      <Hero />

      {/* Planning Phase - AI-driven PRD and task creation */}
      <PlanningPhase />

      {/* Workflow Visualization - 4-step execution loop explanation */}
      <WorkflowVisualization />

      {/* Feature Grid - Key capabilities showcase */}
      <FeatureGrid />

      {/* CTA Section - Final call-to-action */}
      <CTASection />
    </main>
  );
}
