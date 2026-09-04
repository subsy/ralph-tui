/**
 * ABOUTME: File browser component for navigating directories and selecting files.
 * Provides keyboard-driven navigation through the filesystem to find and select files.
 * Includes fuzzy search for quick file filtering within the current directory.
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { homedir } from 'node:os';
import { dirname, resolve, sep, isAbsolute } from 'node:path';
import { colors } from '../theme.js';
import { listDirectory, isDirectory, pathExists, type DirectoryEntry } from '../../utils/files.js';
import { fuzzySearch } from '../../utils/fuzzy-search.js';
import { isPrintableKeySequence } from '../../utils/printable-key.js';

/**
 * Props for the FileBrowser component
 */
export interface FileBrowserProps {
  /** Whether the browser is visible */
  visible: boolean;

  /** Initial directory path (defaults to process.cwd()) */
  initialPath?: string;

  /** File extension filter (e.g., '.json') */
  fileExtension?: string;

  /** Filename prefix filter (e.g., 'prd' to match prd*.json) */
  filenamePrefix?: string;

  /** Tracker label shown in header */
  trackerLabel?: string;

  /** File pattern hint text (e.g., 'prd*.json') - derived from filenamePrefix and fileExtension if not provided */
  filePatternHint?: string;

  /** External error message to display (e.g., PRD load failure) */
  errorMessage?: string;

  /** Callback when a file is selected */
  onSelect: (path: string) => void;

  /** Callback when user cancels */
  onCancel: () => void;
}

/**
 * Truncate path for display, replacing home directory with ~
 */
export function formatPath(path: string): string {
  const home = homedir();
  if (path === home || path.startsWith(home + sep)) {
    return '~' + path.slice(home.length);
  }
  return path;
}

/**
 * Truncate text to fit within a given width
 */
export function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * File browser component for navigating and selecting files.
 * Supports keyboard navigation through directories.
 */
export function FileBrowser({
  visible,
  initialPath,
  fileExtension,
  filenamePrefix,
  trackerLabel,
  filePatternHint,
  errorMessage,
  onSelect,
  onCancel,
}: FileBrowserProps): ReactNode {
  const [currentPath, setCurrentPath] = useState(initialPath ?? process.cwd());
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [editedPath, setEditedPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);

  // Combine internal error with external errorMessage
  const displayError = error || errorMessage || null;

  // Filter entries using fuzzy search when there's a search query
  const filteredEntries = useMemo(() => {
    if (!searchQuery) {
      return entries;
    }
    // Extract entry names for fuzzy matching
    const entryNames = entries.map((e) => e.name);
    const matches = fuzzySearch(entryNames, searchQuery, entries.length);
    // Map back to DirectoryEntry objects preserving fuzzy match order
    const matchedNames = new Set(matches.map((m) => m.item));
    return entries.filter((e) => matchedNames.has(e.name)).sort((a, b) => {
      // Sort by fuzzy score order
      const aIndex = matches.findIndex((m) => m.item === a.name);
      const bIndex = matches.findIndex((m) => m.item === b.name);
      return aIndex - bIndex;
    });
  }, [entries, searchQuery]);

  // Load directory contents when path or showHidden changes
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    listDirectory(currentPath, { showHidden, extension: fileExtension, filenamePrefix })
      .then((result) => {
        if (cancelled) return;
        setEntries(result);
        setSelectedIndex(0);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, currentPath, showHidden, fileExtension, filenamePrefix]);

  // Reset state when becoming visible
  useEffect(() => {
    if (visible) {
      setCurrentPath(initialPath ?? process.cwd());
      setSelectedIndex(0);
      setShowHidden(false);
      setEditingPath(false);
      setEditedPath('');
      setSearchQuery('');
    }
  }, [visible, initialPath]);

  // Clear search when changing directories
  useEffect(() => {
    setSearchQuery('');
    setSelectedIndex(0);
  }, [currentPath]);

  // Scroll to keep selected item in view (only when it goes out of the visible area)
  useEffect(() => {
    if (scrollboxRef.current && !loading && !displayError) {
      const itemHeight = 1;
      const visibleRows = 10;
      // Account for ".." entry only when not searching (search mode hides "..")
      const adjustedIndex = searchQuery ? selectedIndex : selectedIndex;
      const itemTop = adjustedIndex * itemHeight;
      const itemBottom = itemTop + itemHeight;
      const scrollTop = scrollboxRef.current.scrollTop;
      const scrollBottom = scrollTop + visibleRows;

      if (itemBottom > scrollBottom) {
        // Selection is below visible area - scroll down (increase scrollTop)
        scrollboxRef.current.scrollTop = itemBottom - visibleRows;
      } else if (itemTop < scrollTop) {
        // Selection is above visible area - scroll up (decrease scrollTop)
        scrollboxRef.current.scrollTop = itemTop;
      }
    }
  }, [selectedIndex, loading, displayError, searchQuery]);

  // Navigate to parent directory
  const goToParent = useCallback(() => {
    const parent = dirname(currentPath);
    if (parent !== currentPath) {
      setCurrentPath(parent);
    }
  }, [currentPath]);

  // Navigate to home directory
  const goToHome = useCallback(() => {
    setCurrentPath(homedir());
  }, []);

  // Expand ~ to home directory and resolve path relative to current browsing directory
  const expandPath = useCallback((path: string): string => {
    let expanded = path.trim();

    // Handle tilde expansion to home directory
    if (expanded.startsWith('~')) {
      expanded = homedir() + expanded.slice(1);
      return resolve(expanded);
    }

    // Absolute paths resolve directly
    if (isAbsolute(expanded)) {
      return resolve(expanded);
    }

    // Relative paths (including ./ and ../) resolve against current browsing directory
    return resolve(currentPath, expanded);
  }, [currentPath]);

  // Navigate to a typed path
  const navigateToPath = useCallback(async (path: string) => {
    const expanded = expandPath(path);
    try {
      const exists = await pathExists(expanded);
      if (!exists) {
        setError(`Path does not exist: ${path}`);
        return;
      }
      const isDir = await isDirectory(expanded);
      if (!isDir) {
        setError(`Not a directory: ${path}`);
        return;
      }
      setCurrentPath(expanded);
      setEditingPath(false);
      setEditedPath('');
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message})` : '';
      setError(`Cannot access path: ${path}${detail}`);
    }
  }, [expandPath]);

  // Start editing the path
  const startEditingPath = useCallback(() => {
    setEditedPath(formatPath(currentPath));
    setEditingPath(true);
  }, [currentPath]);

  // Cancel editing the path
  const cancelEditingPath = useCallback(() => {
    setEditingPath(false);
    setEditedPath('');
  }, []);

  // Enter directory or select file
  // Note: In normal mode selectedIndex 0 is "..", so actual entries start at index 1
  // In search mode there's no "..", so entries start at index 0
  const enterOrSelect = useCallback(() => {
    const entryIndex = searchQuery ? selectedIndex : selectedIndex - 1;
    const entry = filteredEntries[entryIndex];
    if (!entry) return;

    if (entry.isDirectory) {
      setCurrentPath(entry.path);
    } else {
      onSelect(entry.path);
    }
  }, [filteredEntries, selectedIndex, onSelect, searchQuery]);

  // Clear search query
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedIndex(0);
  }, []);

  // Handle keyboard input
  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string }) => {
      if (!visible) return;

      // Path editing mode
      if (editingPath) {
        switch (key.name) {
          case 'escape':
            cancelEditingPath();
            break;

          case 'return':
          case 'enter':
            if (editedPath.trim()) {
              navigateToPath(editedPath);
            }
            break;

          case 'backspace':
            setEditedPath((prev) => prev.slice(0, -1));
            break;

          default:
            if (isPrintableKeySequence(key.sequence)) {
              setEditedPath((prev) => prev + key.sequence);
            }
            break;
        }
        return;
      }

      // Calculate max index based on search mode
      // In search mode: no ".." entry, so max is filteredEntries.length - 1
      // In normal mode: ".." is index 0, entries are 1..entries.length
      const maxIndex = searchQuery ? filteredEntries.length - 1 : filteredEntries.length;

      // Navigation and search mode
      switch (key.name) {
        case 'escape':
          // If searching, clear search first; otherwise cancel browser
          if (searchQuery) {
            clearSearch();
          } else {
            onCancel();
          }
          break;

        case 'up':
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;

        case 'down':
          setSelectedIndex((prev) => Math.min(maxIndex, prev + 1));
          break;

        case 'return':
        case 'enter':
          // In search mode, directly select from filtered entries
          if (searchQuery) {
            enterOrSelect();
          } else if (selectedIndex === 0) {
            goToParent();
          } else {
            enterOrSelect();
          }
          break;

        case 'right':
          // In search mode, enter directory or select file
          if (searchQuery) {
            enterOrSelect();
          } else if (selectedIndex === 0) {
            goToParent();
          } else {
            enterOrSelect();
          }
          break;

        case 'tab':
          // Tab selects the highlighted entry (convenient keyboard shortcut)
          if (searchQuery && filteredEntries.length > 0) {
            enterOrSelect();
          } else if (!searchQuery && selectedIndex > 0) {
            enterOrSelect();
          }
          break;

        case 'left':
          // Clear search first, then go to parent
          if (searchQuery) {
            clearSearch();
          } else {
            goToParent();
          }
          break;

        case 'backspace':
          // In search mode, delete characters; otherwise go to parent
          if (searchQuery) {
            setSearchQuery((prev) => {
              const newQuery = prev.slice(0, -1);
              if (!newQuery) {
                setSelectedIndex(0);
              }
              return newQuery;
            });
          } else {
            goToParent();
          }
          break;

        default:
          // Handle special keys and search input
          if (key.sequence === '~' && !searchQuery) {
            goToHome();
          } else if (key.sequence === '.' && !searchQuery) {
            setShowHidden((prev) => !prev);
          } else if ((key.sequence === '/' || key.sequence === 'g') && !searchQuery) {
            startEditingPath();
          } else if (isPrintableKeySequence(key.sequence)) {
            // Start or continue fuzzy search with alphanumeric input
            setSearchQuery((prev) => prev + key.sequence);
            setSelectedIndex(0);
          }
          break;
      }
    },
    [visible, editingPath, editedPath, filteredEntries.length, selectedIndex, searchQuery, onCancel, goToParent, goToHome, enterOrSelect, cancelEditingPath, navigateToPath, startEditingPath, clearSearch]
  );

  useKeyboard(handleKeyboard);

  if (!visible) {
    return null;
  }

  const displayExtension = fileExtension ? fileExtension.replace('.', '') : 'file';
  const patternHint = filePatternHint ?? `${filenamePrefix ?? '*'}*${fileExtension ?? ''}`.replace('**', '*');

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#00000080',
      }}
    >
      <box
        style={{
          width: 70,
          height: 20,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.accent.primary,
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <box
          style={{
            width: '100%',
            height: 3,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: colors.bg.tertiary,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={colors.accent.primary}>Select PRD File</text>
          <text fg={colors.fg.muted}>[{trackerLabel ?? displayExtension}]</text>
        </box>

        {/* Path breadcrumb / editor / search */}
        <box
          style={{
            width: '100%',
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: editingPath || searchQuery ? colors.bg.highlight : colors.bg.primary,
          }}
        >
          {editingPath ? (
            <>
              <text fg={colors.accent.primary}>→ </text>
              <text fg={colors.fg.primary}>{editedPath}</text>
              <text fg={colors.accent.primary}>_</text>
            </>
          ) : searchQuery ? (
            <>
              <text fg={colors.accent.secondary}>🔍 </text>
              <text fg={colors.fg.primary}>{searchQuery}</text>
              <text fg={colors.accent.primary}>_</text>
              <text fg={colors.fg.muted}> ({filteredEntries.length} match{filteredEntries.length !== 1 ? 'es' : ''})</text>
            </>
          ) : (
            <text fg={colors.fg.secondary}>{truncateText(formatPath(currentPath), 66)}</text>
          )}
        </box>

        {/* Hint for file pattern and typical location */}
        <box
          style={{
            width: '100%',
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={colors.fg.dim}>Pattern: {patternHint} | Hint: ./tasks/&lt;feature&gt;/</text>
        </box>

        {/* Content */}
        {loading ? (
          <box
            style={{
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <text fg={colors.fg.secondary}>Loading...</text>
          </box>
        ) : displayError ? (
          <box
            style={{
              flexGrow: 1,
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <text fg={colors.status.error}>Error: {truncateText(displayError, 60)}</text>
            <box style={{ height: 1 }} />
            <text fg={colors.fg.muted}>Press Backspace to go back</text>
          </box>
        ) : (
          <box
            style={{
              flexGrow: 1,
              flexDirection: 'column',
              paddingTop: 1,
              paddingLeft: 1,
              paddingRight: 1,
            }}
          >
            <scrollbox ref={scrollboxRef} style={{ flexGrow: 1 }}>
              {/* Parent directory entry (hidden during search) */}
              {!searchQuery && (
                <box
                  style={{
                    width: '100%',
                    height: 1,
                    flexDirection: 'row',
                    backgroundColor: selectedIndex === 0 ? colors.bg.highlight : 'transparent',
                  }}
                >
                  <text fg={selectedIndex === 0 ? colors.accent.primary : 'transparent'}>
                    {selectedIndex === 0 ? '▸ ' : '  '}
                  </text>
                  <text fg={colors.accent.tertiary}>📁 </text>
                  <text fg={selectedIndex === 0 ? colors.fg.primary : colors.fg.secondary}>..</text>
                </box>
              )}

              {/* Directory entries (filtered when searching) */}
              {filteredEntries.map((entry, index) => {
                // In search mode: index directly maps to selectedIndex
                // In normal mode: offset by 1 for ".." entry
                const displayIndex = searchQuery ? index : index + 1;
                const isSelected = displayIndex === selectedIndex;
                const icon = entry.isDirectory ? '📁' : '📄';
                const textColor = entry.isDirectory ? colors.accent.tertiary : colors.fg.primary;

                return (
                  <box
                    key={entry.path}
                    style={{
                      width: '100%',
                      height: 1,
                      flexDirection: 'row',
                      backgroundColor: isSelected ? colors.bg.highlight : 'transparent',
                    }}
                  >
                    <text fg={isSelected ? colors.accent.primary : 'transparent'}>
                      {isSelected ? '▸ ' : '  '}
                    </text>
                    <text fg={textColor}>{icon} </text>
                    <text fg={isSelected ? colors.fg.primary : colors.fg.secondary}>
                      {truncateText(entry.name, 58)}
                    </text>
                  </box>
                );
              })}

              {/* Empty search results message */}
              {searchQuery && filteredEntries.length === 0 && (
                <box style={{ width: '100%', height: 1, paddingLeft: 2 }}>
                  <text fg={colors.fg.muted}>No matches for "{searchQuery}"</text>
                </box>
              )}
            </scrollbox>
          </box>
        )}

        {/* Footer */}
        <box
          style={{
            width: '100%',
            height: 2,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: colors.bg.tertiary,
            gap: 2,
          }}
        >
          {editingPath ? (
            <>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Enter</span> Go
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Esc</span> Cancel
              </text>
            </>
          ) : searchQuery ? (
            <>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Enter</span> Select
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>↑↓</span> Nav
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>⌫</span> Delete
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Esc</span> Clear
              </text>
            </>
          ) : (
            <>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Enter</span> Select
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>↑↓</span> Nav
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>abc</span> Search
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>/</span> Path
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>~.</span> Home/Hidden{showHidden ? '✓' : ''}
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Esc</span> ✗
              </text>
            </>
          )}
        </box>
      </box>
    </box>
  );
}
