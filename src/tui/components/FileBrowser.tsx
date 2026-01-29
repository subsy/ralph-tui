/**
 * ABOUTME: File browser component for navigating directories and selecting files.
 * Provides keyboard-driven navigation through the filesystem to find and select files.
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { colors } from '../theme.js';
import { listDirectory, isDirectory, type DirectoryEntry } from '../../utils/files.js';

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

  /** Callback when a file is selected */
  onSelect: (path: string) => void;

  /** Callback when user cancels */
  onCancel: () => void;
}

/**
 * Truncate path for display, replacing home directory with ~
 */
function formatPath(path: string): string {
  const home = homedir();
  if (path === home || path.startsWith(home + sep)) {
    return '~' + path.slice(home.length);
  }
  return path;
}

/**
 * Truncate text to fit within a given width
 */
function truncateText(text: string, maxWidth: number): string {
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
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);

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
    }
  }, [visible, initialPath]);

  // Scroll to keep selected item in view (only when it goes out of the visible area)
  useEffect(() => {
    if (scrollboxRef.current && !loading && !error) {
      const itemHeight = 1;
      const visibleRows = 10;
      const itemTop = selectedIndex * itemHeight;
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
  }, [selectedIndex, loading, error]);

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

  // Expand ~ to home directory and resolve path
  const expandPath = useCallback((path: string): string => {
    let expanded = path.trim();
    if (expanded.startsWith('~')) {
      expanded = homedir() + expanded.slice(1);
    }
    return resolve(expanded);
  }, []);

  // Navigate to a typed path
  const navigateToPath = useCallback(async (path: string) => {
    const expanded = expandPath(path);
    const isDir = await isDirectory(expanded);
    if (isDir) {
      setCurrentPath(expanded);
      setEditingPath(false);
      setEditedPath('');
    } else {
      setError(`Not a directory: ${path}`);
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
  // Note: selectedIndex 0 is "..", so actual entries start at index 1
  const enterOrSelect = useCallback(() => {
    const entry = entries[selectedIndex - 1];
    if (!entry) return;

    if (entry.isDirectory) {
      setCurrentPath(entry.path);
    } else {
      onSelect(entry.path);
    }
  }, [entries, selectedIndex, onSelect]);

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
            if (key.sequence && key.sequence.length === 1 && key.sequence >= ' ') {
              setEditedPath((prev) => prev + key.sequence);
            }
            break;
        }
        return;
      }

      // Normal navigation mode
      switch (key.name) {
        case 'escape':
          onCancel();
          break;

        case 'up':
        case 'k':
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;

        case 'down':
        case 'j':
          setSelectedIndex((prev) => Math.min(entries.length, prev + 1));
          break;

        case 'return':
        case 'enter':
        case 'right':
        case 'l':
          if (selectedIndex === 0) {
            goToParent();
          } else {
            enterOrSelect();
          }
          break;

        case 'backspace':
        case 'left':
        case 'h':
          goToParent();
          break;

        default:
          if (key.sequence === '~') {
            goToHome();
          } else if (key.sequence === '.') {
            setShowHidden((prev) => !prev);
          } else if (key.sequence === '/' || key.sequence === 'g') {
            startEditingPath();
          }
          break;
      }
    },
    [visible, editingPath, editedPath, entries.length, selectedIndex, onCancel, goToParent, goToHome, enterOrSelect, cancelEditingPath, navigateToPath, startEditingPath]
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

        {/* Path breadcrumb / editor */}
        <box
          style={{
            width: '100%',
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: editingPath ? colors.bg.highlight : colors.bg.primary,
          }}
        >
          {editingPath ? (
            <>
              <text fg={colors.accent.primary}>→ </text>
              <text fg={colors.fg.primary}>{editedPath}</text>
              <text fg={colors.accent.primary}>_</text>
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
        ) : error ? (
          <box
            style={{
              flexGrow: 1,
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <text fg={colors.status.error}>Error: {truncateText(error, 60)}</text>
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
              {/* Parent directory entry */}
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

              {/* Directory entries */}
              {entries.map((entry, index) => {
                const displayIndex = index + 1;
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
          ) : (
            <>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>Enter</span> Select
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>↑↓</span> Nav
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>/</span> Path
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>~</span> Home
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>.</span> Hidden{showHidden ? '✓' : ''}
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
