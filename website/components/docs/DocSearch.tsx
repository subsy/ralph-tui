/**
 * ABOUTME: Command palette search component for documentation.
 * Opens with Cmd+K (Mac) or Ctrl+K (Windows/Linux), featuring terminal-inspired aesthetics.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileText, Hash, ArrowRight, Command as CommandIcon, CornerDownLeft } from 'lucide-react';
import { searchDocs, type SearchItem } from '@/lib/search';

interface DocSearchProps {
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

/**
 * DocSearch command palette with terminal-inspired design.
 * Provides keyboard-first navigation through documentation.
 */
export function DocSearch({ open: controlledOpen, onOpenChange }: DocSearchProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // Handle keyboard shortcut
  // Note: We include `open` in deps because we toggle based on current value.
  // This is necessary because onOpenChange callback doesn't accept functions.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  // Search on query change
  useEffect(() => {
    if (query) {
      const searchResults = searchDocs(query, 12);
      setResults(searchResults);
    } else {
      setResults([]);
    }
  }, [query]);

  // Reset query when closing
  useEffect(() => {
    if (!open) {
      // Small delay to allow animation to complete
      const timeout = setTimeout(() => setQuery(''), 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      // Small delay to ensure the dialog is rendered
      const timeout = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  const handleSelect = useCallback((item: SearchItem) => {
    const url = item.anchor ? `${item.href}#${item.anchor}` : item.href;
    router.push(url);
    setOpen(false);
  }, [router, setOpen]);

  // Group results by category
  const groupedResults = results.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, SearchItem[]>);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop with scan line effect */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            {/* CRT scan line overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.03]"
              style={{
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
              }}
            />
          </motion.div>

          {/* Command Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{
              duration: 0.2,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="fixed left-1/2 top-[15%] z-50 w-full max-w-2xl -translate-x-1/2"
          >
            <Command
              className={[
                'overflow-hidden rounded-lg',
                'bg-bg-primary/95 backdrop-blur-xl',
                'border border-border',
                'shadow-[0_0_0_1px_rgba(122,162,247,0.1),0_25px_50px_-12px_rgba(0,0,0,0.5)]',
              ].join(' ')}
              shouldFilter={false}
              loop
            >
              {/* Terminal-style header bar */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-status-error/60" />
                  <div className="h-3 w-3 rounded-full bg-status-warning/60" />
                  <div className="h-3 w-3 rounded-full bg-status-success/60" />
                </div>
                <span className="ml-2 font-mono text-xs text-fg-muted">
                  ralph-search ~ docs
                </span>
              </div>

              {/* Search input with terminal prompt */}
              <div className="flex items-center border-b border-border/50 px-4">
                <span className="font-mono text-sm text-accent-primary">❯</span>
                <Command.Input
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search documentation..."
                  className={[
                    'flex-1 bg-transparent px-3 py-4',
                    'font-mono text-sm text-fg-primary',
                    'placeholder:text-fg-muted',
                    'focus:outline-none',
                  ].join(' ')}
                />
                {query && (
                  <kbd className="hidden sm:flex items-center gap-1 rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-xs text-fg-muted">
                    <span>ESC</span>
                  </kbd>
                )}
              </div>

              {/* Results list */}
              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                <Command.Empty className="py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Search className="h-12 w-12 text-fg-dim" />
                    <p className="font-mono text-sm text-fg-muted">
                      {query ? (
                        <>No results for &ldquo;<span className="text-accent-primary">{query}</span>&rdquo;</>
                      ) : (
                        'Type to search documentation...'
                      )}
                    </p>
                    <p className="text-xs text-fg-dim">
                      Try searching for &ldquo;configuration&rdquo;, &ldquo;cli&rdquo;, or &ldquo;plugins&rdquo;
                    </p>
                  </div>
                </Command.Empty>

                {/* Grouped results */}
                {Object.entries(groupedResults).map(([category, items]) => (
                  <Command.Group
                    key={category}
                    heading={
                      <div className="flex items-center gap-2 px-2 py-2">
                        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-fg-muted">
                          {category}
                        </span>
                        <div className="flex-1 border-b border-border/30" />
                      </div>
                    }
                  >
                    {items.map((item) => (
                      <SearchResultItem
                        key={item.id}
                        item={item}
                        onSelect={() => handleSelect(item)}
                      />
                    ))}
                  </Command.Group>
                ))}

                {/* Quick actions when no query */}
                {!query && (
                  <Command.Group
                    heading={
                      <div className="flex items-center gap-2 px-2 py-2">
                        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-fg-muted">
                          Quick Links
                        </span>
                        <div className="flex-1 border-b border-border/30" />
                      </div>
                    }
                  >
                    <QuickLinkItem
                      title="Getting Started"
                      description="Introduction to Ralph TUI"
                      href="/docs/getting-started/introduction"
                      onSelect={() => {
                        router.push('/docs/getting-started/introduction');
                        setOpen(false);
                      }}
                    />
                    <QuickLinkItem
                      title="Configuration"
                      description="Customize your setup"
                      href="/docs/configuration/overview"
                      onSelect={() => {
                        router.push('/docs/configuration/overview');
                        setOpen(false);
                      }}
                    />
                    <QuickLinkItem
                      title="CLI Commands"
                      description="All available commands"
                      href="/docs/cli/overview"
                      onSelect={() => {
                        router.push('/docs/cli/overview');
                        setOpen(false);
                      }}
                    />
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer with keyboard hints */}
              <div className="flex items-center justify-between border-t border-border bg-bg-secondary/50 px-4 py-2">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <kbd className="inline-flex h-5 items-center rounded border border-border bg-bg-tertiary px-1.5 font-mono text-[10px]">
                      ↑↓
                    </kbd>
                    <span>Navigate</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <kbd className="inline-flex h-5 items-center rounded border border-border bg-bg-tertiary px-1.5 font-mono text-[10px]">
                      <CornerDownLeft className="h-3 w-3" />
                    </kbd>
                    <span>Select</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <kbd className="inline-flex h-5 items-center rounded border border-border bg-bg-tertiary px-1.5 font-mono text-[10px]">
                      ESC
                    </kbd>
                    <span>Close</span>
                  </span>
                </div>
                <span className="font-mono text-xs text-fg-dim">
                  <span className="text-accent-primary">{results.length}</span> results
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Individual search result item with terminal-inspired styling.
 */
function SearchResultItem({
  item,
  onSelect
}: {
  item: SearchItem;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={item.id}
      onSelect={onSelect}
      className={[
        'group relative flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5',
        'transition-colors duration-100',
        'data-[selected=true]:bg-bg-tertiary',
        'data-[selected=true]:text-fg-primary',
      ].join(' ')}
    >
      {/* Icon */}
      <div className={[
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded',
        'bg-bg-secondary text-fg-muted',
        'transition-colors duration-100',
        'group-data-[selected=true]:bg-accent-primary/20 group-data-[selected=true]:text-accent-primary',
      ].join(' ')}>
        {item.section ? (
          <Hash className="h-3.5 w-3.5" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg-primary truncate">
            {item.title}
          </span>
          {item.section && (
            <>
              <ArrowRight className="h-3 w-3 shrink-0 text-fg-dim" />
              <span className="truncate text-accent-tertiary">
                {item.section}
              </span>
            </>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-fg-muted">
          {item.snippet}
        </p>
      </div>

      {/* Selection indicator */}
      <div className={[
        'absolute right-3 top-1/2 -translate-y-1/2',
        'opacity-0 transition-opacity duration-100',
        'group-data-[selected=true]:opacity-100',
      ].join(' ')}>
        <CornerDownLeft className="h-4 w-4 text-fg-muted" />
      </div>
    </Command.Item>
  );
}

/**
 * Quick link item for default state browsing.
 */
function QuickLinkItem({
  title,
  description,
  href,
  onSelect,
}: {
  title: string;
  description: string;
  href: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`quick-${href}`}
      onSelect={onSelect}
      className={[
        'group relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5',
        'transition-colors duration-100',
        'data-[selected=true]:bg-bg-tertiary',
      ].join(' ')}
    >
      <div className={[
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        'bg-accent-primary/10 text-accent-primary',
        'transition-all duration-150',
        'group-data-[selected=true]:bg-accent-primary/20 group-data-[selected=true]:shadow-[0_0_12px_rgba(122,162,247,0.3)]',
      ].join(' ')}>
        <FileText className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <span className="font-medium text-fg-primary">{title}</span>
        <p className="text-sm text-fg-muted">{description}</p>
      </div>
      <ArrowRight className={[
        'h-4 w-4 text-fg-dim',
        'transition-all duration-150',
        'group-data-[selected=true]:translate-x-1 group-data-[selected=true]:text-accent-primary',
      ].join(' ')} />
    </Command.Item>
  );
}

/**
 * Search trigger button for use in the header.
 */
export function SearchButton({ onClick }: { onClick: () => void }) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // Use userAgentData if available, fall back to userAgent string
    const isMacOS =
      // @ts-expect-error - userAgentData is not yet in all TypeScript DOM types
      navigator.userAgentData?.platform === 'macOS' ||
      navigator.userAgent.toLowerCase().includes('mac');
    setIsMac(isMacOS);
  }, []);

  return (
    <button
      onClick={onClick}
      className={[
        'group flex items-center gap-2 px-3 py-1.5',
        'rounded-md border border-border bg-bg-secondary/50',
        'font-mono text-sm text-fg-muted',
        'transition-all duration-200',
        'hover:border-accent-primary/50 hover:bg-bg-tertiary hover:text-fg-secondary',
        'hover:shadow-[0_0_15px_rgba(122,162,247,0.15)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary',
      ].join(' ')}
      aria-label="Search documentation"
    >
      <Search className="h-4 w-4 text-fg-muted transition-colors group-hover:text-accent-primary" />
      <span className="hidden sm:inline">Search</span>
      <kbd className={[
        'hidden sm:flex items-center gap-0.5',
        'rounded border border-border/60 bg-bg-tertiary px-1.5 py-0.5',
        'text-xs text-fg-dim',
        'transition-colors group-hover:border-accent-primary/30 group-hover:text-fg-muted',
      ].join(' ')}>
        {isMac ? (
          <>
            <CommandIcon className="h-3 w-3" />
            <span>K</span>
          </>
        ) : (
          <span>Ctrl+K</span>
        )}
      </kbd>
    </button>
  );
}
