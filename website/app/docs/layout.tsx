/**
 * ABOUTME: Documentation layout component with responsive sidebar.
 * Provides a two-column layout with sticky sidebar on desktop and
 * toggleable drawer on mobile.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Sidebar } from '@/components/docs';

interface DocsLayoutProps {
  children: React.ReactNode;
}

/**
 * Documentation layout with responsive sidebar.
 * - Desktop: Fixed sidebar on left (280px), scrollable content on right
 * - Mobile: Hidden sidebar with toggle button, full-width content
 */
export default function DocsLayout({ children }: DocsLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Handle escape key to close mobile sidebar
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };

    if (sidebarOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when sidebar is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)]">
      {/* Mobile sidebar toggle button */}
      <button
        onClick={toggleSidebar}
        className={[
          'fixed bottom-6 right-6 z-40 md:hidden',
          'flex h-14 w-14 items-center justify-center',
          'rounded-full',
          'bg-accent-primary text-bg-primary',
          'shadow-[0_4px_20px_rgba(122,162,247,0.4)]',
          'transition-all duration-200',
          'hover:bg-accent-primary/90 hover:shadow-[0_4px_30px_rgba(122,162,247,0.5)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
          sidebarOpen ? 'rotate-90' : '',
        ].join(' ')}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Menu className="h-6 w-6" />
        )}
      </button>

      {/* Mobile sidebar backdrop */}
      <div
        className={[
          'fixed inset-0 z-30 md:hidden',
          'bg-bg-primary/80 backdrop-blur-sm',
          'transition-opacity duration-300',
          sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <div
        className={[
          // Mobile: slide-in drawer
          'fixed inset-y-0 left-0 z-40 w-72 md:z-0',
          'transition-transform duration-300 ease-out md:transition-none',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          // Desktop: sticky sidebar
          'md:sticky md:top-16 md:w-72 md:shrink-0',
          'md:h-[calc(100vh-4rem)]',
          // Styling
          'border-r border-border',
          'bg-bg-primary',
          'shadow-[4px_0_30px_rgba(0,0,0,0.2)] md:shadow-none',
        ].join(' ')}
      >
        <Sidebar />
      </div>

      {/* Main content area - TOC is rendered by page component */}
      <main
        className={[
          'flex-1',
          'min-w-0', // Prevent content from overflowing
          'px-4 py-8 sm:px-6 md:px-8 lg:px-12',
        ].join(' ')}
      >
        {children}
      </main>
    </div>
  );
}
