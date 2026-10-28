/**
 * ABOUTME: Reusable chat interface component for the Ralph TUI.
 * Displays a conversation with an AI agent, supporting streaming output,
 * user input, and message history. Used primarily for PRD generation.
 */

import type { KeyEvent, PasteEvent, TextareaRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../chat/types.js';
import { colors } from '../theme.js';

import type { FormattedSegment } from '../../plugins/agents/output-formatting.js';
import { usePaste } from '../hooks/usePaste.js';
import type { Toast as ToastData } from '../hooks/useToast.js';
import {
  deleteRangeSafely,
  findMarkerAtCursor,
  wordBoundaryBackward,
  wordBoundaryForward,
} from '../utils/marker-edit.js';
import { FormattedText } from './FormattedText.js';
import { ToastContainer } from './Toast.js';

/**
 * Spinner frames for animation
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Animated spinner component for loading states
 */
function AnimatedSpinner(): ReactNode {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, []);

  return <text fg={colors.status.info}>{SPINNER_FRAMES[frameIndex]}</text>;
}

/**
 * Props for the ChatView component
 */
export interface ChatViewProps {
  /** Title to display in the header */
  title: string;

  /** Subtitle shown next to title */
  subtitle?: string;

  /** Conversation messages to display */
  messages: ChatMessage[];

  /** Current user input value */
  inputValue: string;

  /** Whether the assistant is currently generating a response */
  isLoading: boolean;

  /** Status text to show during loading */
  loadingStatus?: string;

  /** Streaming output chunk (displayed during generation) - legacy string format */
  streamingChunk?: string;

  /** Streaming output segments for TUI-native color rendering */
  streamingSegments?: FormattedSegment[];

  /** Placeholder text for the input field */
  inputPlaceholder?: string;

  /** Error message to display */
  error?: string;

  /** Whether input is enabled */
  inputEnabled?: boolean;

  /** Cursor position in the input (0 = start, inputValue.length = end) */
  cursorPosition?: number;

  /** Hint text for the footer */
  hint?: string;

  /** Name of the agent (for loading messages) */
  agentName?: string;

  /** Callback when user submits (presses Ctrl+Enter) with the current input value */
  onSubmit?: (value: string) => void;

  /**
   * Callback when an image marker (e.g., [Image 1]) is deleted from the input.
   * This is called when the user presses backspace or delete while the cursor
   * is inside or adjacent to a marker. The entire marker is deleted atomically.
   * Parent component should use this to detach the corresponding image.
   * @param imageNumber - The number of the image whose marker was deleted (1-indexed)
   */
  onImageMarkerDeleted?: (imageNumber: number) => void;

  /**
   * Callback when text is pasted into the input.
   * If this callback is provided, it will be called with the pasted text and event.
   * The callback can call event.preventDefault() to prevent the default paste behavior.
   *
   * Use this to implement image detection:
   * 1. Check clipboard for actual image data
   * 2. Check if pasted text is a file path
   * 3. Check for base64/OSC 52 data
   * 4. If image detected, attach it and call event.preventDefault()
   * 5. If not image, let the default paste behavior occur
   *
   * @param text - The pasted text
   * @param event - The paste event (call preventDefault() to stop default paste)
   */
  onPaste?: (text: string, event: PasteEvent) => void | Promise<void>;

  /**
   * Toast notifications to display in the chat view.
   * Provide this from the useToast hook to show transient feedback messages.
   */
  toasts?: ToastData[];

  /**
   * Ref to receive a text insertion function.
   * When set, the ChatView will populate ref.current with a function that
   * inserts text at the current cursor position in the input.
   *
   * This is useful for inserting image markers when an image is attached.
   *
   * @example
   * ```tsx
   * const insertTextRef = useRef<((text: string) => void) | null>(null);
   *
   * const handlePaste = async () => {
   *   const result = await attachFromClipboard();
   *   if (result.success && insertTextRef.current) {
   *     insertTextRef.current(result.inlineMarker);
   *   }
   * };
   *
   * return <ChatView insertTextRef={insertTextRef} onPaste={handlePaste} />;
   * ```
   */
  insertTextRef?: React.MutableRefObject<((text: string) => void) | null>;
}

/**
 * Format a timestamp for display
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * MessageBubble component for displaying a single chat message
 */
function MessageBubble({ message }: { message: ChatMessage }): ReactNode {
  const isUser = message.role === 'user';
  const roleLabel = isUser ? 'You' : 'Assistant';
  const roleColor = isUser ? colors.accent.primary : colors.accent.secondary;

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        marginBottom: 1,
      }}
    >
      {/* Role and timestamp header */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <text fg={roleColor}>{roleLabel}</text>
        <text fg={colors.fg.dim}>{formatTime(message.timestamp)}</text>
      </box>

      {/* Message content */}
      <box style={{ paddingLeft: 2, paddingTop: 0 }}>
        <text fg={colors.fg.primary}>{message.content}</text>
      </box>
    </box>
  );
}

/**
 * ChatView component - displays a chat conversation with input
 */
export function ChatView({
  title,
  subtitle,
  messages,
  inputValue,
  isLoading,
  loadingStatus = 'Thinking...',
  streamingChunk,
  streamingSegments,
  inputPlaceholder = 'Type a message...',
  error,
  inputEnabled = true,
  cursorPosition: _cursorPosition, // Not used with native input
  hint = '[Ctrl+Enter] Send  [Esc] Cancel',
  agentName,
  onSubmit,
  onImageMarkerDeleted,
  onPaste,
  toasts = [],
  insertTextRef,
}: ChatViewProps): ReactNode {
  // Generate dynamic loading text
  const loadingText = agentName ? `Waiting for ${agentName}...` : loadingStatus;

  // Textarea ref for submit handling and value access
  const textareaRef = useRef<TextareaRenderable>(null);

  // Provide insert text function to parent via ref
  // This allows the parent to insert text (like image markers) at cursor position
  useEffect(() => {
    if (insertTextRef) {
      insertTextRef.current = (text: string) => {
        if (textareaRef.current) {
          // Insert text at current cursor position
          textareaRef.current.editBuffer.insertText(text);
        }
      };
    }
    return () => {
      if (insertTextRef) {
        insertTextRef.current = null;
      }
    };
  }, [insertTextRef]);

  // Sync textarea content when inputValue changes from outside (e.g., after clearing)
  useEffect(() => {
    if (textareaRef.current && inputValue !== textareaRef.current.plainText) {
      textareaRef.current.editBuffer.setText(inputValue);
    }
  }, [inputValue]);

  // Handle submit - get value from textarea ref and pass it directly, then clear
  const handleSubmit = useCallback(() => {
    const currentValue = textareaRef.current?.plainText ?? '';
    // Clear the textarea immediately before calling onSubmit
    // This ensures the input is cleared even if there's a delay
    if (textareaRef.current) {
      textareaRef.current.editBuffer.setText('');
    }
    onSubmit?.(currentValue);
  }, [onSubmit]);

  // Track last cursor position to determine movement direction
  const lastCursorOffsetRef = useRef<number>(0);

  // Subscribe to cursor changes and skip over markers automatically
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const editBuffer = textarea.editBuffer;

    const handleCursorChange = () => {
      const text = textarea.plainText;
      const cursor = editBuffer.getCursorPosition();
      const cursorOffset = cursor.offset;
      const lastOffset = lastCursorOffsetRef.current;

      // Determine movement direction
      const movingRight = cursorOffset > lastOffset;
      const movingLeft = cursorOffset < lastOffset;

      // Check if cursor is inside any marker
      const markerPattern = /\[Image \d+\]/g;
      let match;

      while ((match = markerPattern.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;

        // If cursor is strictly inside the marker (not at boundaries)
        if (cursorOffset > start && cursorOffset < end) {
          // Move cursor out based on direction
          if (movingRight) {
            editBuffer.setCursorByOffset(end);
            lastCursorOffsetRef.current = end;
          } else if (movingLeft) {
            editBuffer.setCursorByOffset(start);
            lastCursorOffsetRef.current = start;
          } else {
            // Unknown direction (e.g., click) - move to end
            editBuffer.setCursorByOffset(end);
            lastCursorOffsetRef.current = end;
          }
          return;
        }
      }

      // Update last position
      lastCursorOffsetRef.current = cursorOffset;
    };

    // Subscribe to cursor changes
    editBuffer.on('cursor-changed', handleCursorChange);

    return () => {
      editBuffer.off('cursor-changed', handleCursorChange);
    };
  }, []);

  /**
   * Find an [Image N] marker that contains or is adjacent to the given cursor position.
   * Returns the marker info or null if cursor is not near a marker.
   */

  // Handle keyboard for text editing shortcuts (macOS-style)
  const handleKeyboard = useCallback(
    (key: KeyEvent) => {
      if (!textareaRef.current || !inputEnabled || isLoading) return;

      const textarea = textareaRef.current;
      const editBuffer = textarea.editBuffer;

      const text = textarea.plainText;
      const cursorOffset = editBuffer.getCursorPosition().offset;

      // Ctrl+W = delete word backward (your logs show this is what you get)
      if (key.ctrl && key.name === 'w') {
        key.preventDefault?.();
        const start = wordBoundaryBackward(text, cursorOffset);
        deleteRangeSafely({
          textarea,
          start,
          end: cursorOffset,
          onImageMarkerDeleted,
        });
        return;
      }

      // Ctrl+U = kill to start of line (common terminal/readline behavior)
      if (key.ctrl && key.name === 'u') {
        key.preventDefault?.();
        // Explanation:
        // lastIndexOf("\n") returns -1 if none; +1 makes it 0; cursorOffset - 0 = cursorOffset
        // We want start offset of current line, so:
        const start = text.lastIndexOf('\n', cursorOffset - 1) + 1;
        deleteRangeSafely({
          textarea,
          start,
          end: cursorOffset,
          onImageMarkerDeleted,
        });
        return;
      }

      // Ctrl+K = kill to end of line
      if (key.ctrl && key.name === 'k') {
        key.preventDefault?.();
        const nextNl = text.indexOf('\n', cursorOffset);
        const end = nextNl === -1 ? text.length : nextNl;
        deleteRangeSafely({
          textarea,
          start: cursorOffset,
          end,
          onImageMarkerDeleted,
        });
        return;
      }

      // Option+Delete / Option+Backspace handling (when terminals actually deliver these)
      const isWordBackspace =
        (key.option && key.name === 'backspace') ||
        (key.ctrl && key.name === 'backspace'); // some envs do this

      const isWordDelete =
        (key.option && key.name === 'delete') ||
        (key.ctrl && key.name === 'delete'); // some envs do this

      if (isWordBackspace) {
        key.preventDefault?.();
        const start = wordBoundaryBackward(text, cursorOffset);
        deleteRangeSafely({
          textarea,
          start,
          end: cursorOffset,
          onImageMarkerDeleted,
        });
        return;
      }

      if (isWordDelete) {
        key.preventDefault?.();
        const end = wordBoundaryForward(text, cursorOffset);
        deleteRangeSafely({
          textarea,
          start: cursorOffset,
          end,
          onImageMarkerDeleted,
        });
        return;
      }

      if (key.name === 'backspace') {
        if (onImageMarkerDeleted) {
          const marker = findMarkerAtCursor(text, cursorOffset);
          if (marker && cursorOffset > marker.start) {
            key.preventDefault?.();
            const newText =
              text.slice(0, marker.start) + text.slice(marker.end);
            editBuffer.setText(newText);
            editBuffer.setCursorByOffset(marker.start);
            onImageMarkerDeleted(marker.imageNumber);
            return;
          }
        }
        return;
      }

      if (key.name === 'delete') {
        if (onImageMarkerDeleted) {
          const marker = findMarkerAtCursor(text, cursorOffset);
          if (marker && cursorOffset < marker.end) {
            key.preventDefault?.();
            const newText =
              text.slice(0, marker.start) + text.slice(marker.end);
            editBuffer.setText(newText);
            editBuffer.setCursorByOffset(marker.start);
            onImageMarkerDeleted(marker.imageNumber);
            return;
          }
        }
        return;
      }

      // Enter / newline shortcuts
      if (key.name === 'return' && !key.meta && !key.ctrl && !key.shift) {
        key.preventDefault?.();
        handleSubmit();
        return;
      }

      if (
        (key.shift && key.name === 'return') ||
        (key.ctrl && key.name === 'j')
      ) {
        key.preventDefault?.();
        textarea.newLine();
        return;
      }

      // Movement / selection shortcuts
      if (key.option && !key.shift && !key.meta && !key.ctrl) {
        if (key.name === 'left') {
          key.preventDefault?.();
          textarea.moveWordBackward();
          return;
        }
        if (key.name === 'right') {
          key.preventDefault?.();
          textarea.moveWordForward();
          return;
        }
        if (key.name === 'up') {
          key.preventDefault?.();
          textarea.gotoBufferHome();
          return;
        }
        if (key.name === 'down') {
          key.preventDefault?.();
          textarea.gotoBufferEnd();
          return;
        }
      }

      if (key.shift && key.option && !key.meta && !key.ctrl) {
        if (key.name === 'left') {
          key.preventDefault?.();
          textarea.moveWordBackward({ select: true });
          return;
        }
        if (key.name === 'right') {
          key.preventDefault?.();
          textarea.moveWordForward({ select: true });
          return;
        }
        if (key.name === 'up') {
          key.preventDefault?.();
          textarea.gotoBufferHome({ select: true });
          return;
        }
        if (key.name === 'down') {
          key.preventDefault?.();
          textarea.gotoBufferEnd({ select: true });
          return;
        }
      }

      if (key.shift && !key.meta && !key.option && !key.ctrl) {
        if (key.name === 'left') {
          key.preventDefault?.();
          textarea.moveCursorLeft({ select: true });
          return;
        }
        if (key.name === 'right') {
          key.preventDefault?.();
          textarea.moveCursorRight({ select: true });
          return;
        }
        if (key.name === 'up') {
          key.preventDefault?.();
          textarea.moveCursorUp({ select: true });
          return;
        }
        if (key.name === 'down') {
          key.preventDefault?.();
          textarea.moveCursorDown({ select: true });
          return;
        }
      }

      if (key.shift && key.meta && !key.option && !key.ctrl) {
        if (key.name === 'left') {
          key.preventDefault?.();
          textarea.gotoLineHome({ select: true });
          return;
        }
        if (key.name === 'right') {
          key.preventDefault?.();
          textarea.gotoLineEnd({ select: true });
          return;
        }
        if (key.name === 'up') {
          key.preventDefault?.();
          textarea.gotoBufferHome({ select: true });
          return;
        }
        if (key.name === 'down') {
          key.preventDefault?.();
          textarea.gotoBufferEnd({ select: true });
          return;
        }
      }
    },
    [
      inputEnabled,
      isLoading,
      handleSubmit,
      onImageMarkerDeleted,
      findMarkerAtCursor,
    ],
  );

  useKeyboard(handleKeyboard);

  // Handle paste events with optional image detection
  // The onPaste callback can call event.preventDefault() to stop default paste behavior
  const handlePaste = useCallback(
    (text: string, event: PasteEvent) => {
      // Only handle paste if input is enabled and not loading
      if (!inputEnabled || isLoading) {
        return;
      }

      // If a custom paste handler is provided, call it
      // The handler can call event.preventDefault() to stop default paste behavior
      if (onPaste) {
        void Promise.resolve(onPaste(text, event)).catch((error) => {
          console.error('Paste handler failed:', error);
        });
      }
      // If no handler or handler didn't prevent default, OpenTUI's textarea
      // will handle the paste normally
    },
    [inputEnabled, isLoading, onPaste],
  );

  // Subscribe to paste events with debouncing enabled
  usePaste(handlePaste, {
    enabled: inputEnabled && !isLoading,
    debounceMs: 100,
  });

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Toast notifications */}
      {toasts.length > 0 && <ToastContainer toasts={toasts} />}

      {/* Header */}
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: colors.bg.secondary,
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <box style={{ flexDirection: 'row', gap: 2 }}>
          <text fg={colors.accent.primary}>{title}</text>
          {subtitle && <text fg={colors.fg.muted}>{subtitle}</text>}
        </box>
        <text fg={colors.fg.muted}>
          {messages.length} message{messages.length !== 1 ? 's' : ''}
        </text>
      </box>

      {/* Message area */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: 'column',
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
        }}
      >
        <scrollbox
          style={{ flexGrow: 1 }}
          stickyScroll={true}
          stickyStart="bottom"
        >
          {/* Welcome message if no messages */}
          {messages.length === 0 && !isLoading && (
            <box style={{ marginBottom: 1 }}>
              <text fg={colors.fg.secondary}>
                Start the conversation by typing a message below.
              </text>
            </box>
          )}

          {/* Message history */}
          {messages.map((msg, index) => (
            <MessageBubble key={index} message={msg} />
          ))}

          {/* Streaming output during generation - prefer segments for TUI-native colors */}
          {isLoading && (streamingSegments?.length || streamingChunk) && (
            <box style={{ flexDirection: 'column', marginBottom: 1 }}>
              <box style={{ flexDirection: 'row', gap: 1 }}>
                <text fg={colors.accent.secondary}>Assistant</text>
                <AnimatedSpinner />
              </box>
              <box
                style={{
                  paddingLeft: 2,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                }}
              >
                {streamingSegments?.length ? (
                  <FormattedText segments={streamingSegments} />
                ) : (
                  <text fg={colors.fg.primary}>{streamingChunk}</text>
                )}
              </box>
            </box>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingChunk && !streamingSegments?.length && (
            <box style={{ flexDirection: 'row', gap: 1, marginBottom: 1 }}>
              <text fg={colors.accent.secondary}>Assistant</text>
              <AnimatedSpinner />
              <text fg={colors.fg.muted}>{loadingText}</text>
            </box>
          )}

          {/* Error message */}
          {error && (
            <box
              style={{
                marginTop: 1,
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.status.error,
              }}
            >
              <text fg={colors.status.error}>Error: {error}</text>
            </box>
          )}
        </scrollbox>
      </box>

      {/* Input area */}
      <box
        style={{
          width: '100%',
          height: 8,
          flexDirection: 'column',
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor:
            inputEnabled && !isLoading
              ? colors.border.active
              : colors.border.normal,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {/* Textarea for multi-line input with word wrap */}
        <box
          style={{
            flexGrow: 1,
            flexDirection: 'row',
            alignItems: 'flex-start',
          }}
        >
          <text fg={colors.accent.primary} style={{ paddingTop: 0 }}>
            {'>'}{' '}
          </text>
          <textarea
            ref={textareaRef}
            initialValue={inputValue}
            style={{
              flexGrow: 1,
              height: 6,
              backgroundColor: 'transparent',
              textColor: colors.fg.primary,
              focusedBackgroundColor: 'transparent',
              focusedTextColor: colors.fg.primary,
              cursorColor: colors.accent.primary,
            }}
            placeholder={inputPlaceholder}
            focused={inputEnabled && !isLoading}
            onSubmit={handleSubmit}
          />
        </box>

        {/* Hint bar - positioned on bottom border */}
        <box
          style={{
            position: 'absolute',
            bottom: 0,
            left: 2,
            right: 2,
            height: 1,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 1,
            backgroundColor: colors.bg.secondary,
          }}
        >
          {isLoading ? (
            <>
              <AnimatedSpinner />
              <text fg={colors.status.info}>{loadingText}</text>
            </>
          ) : (
            <text fg={colors.fg.muted}>{hint}</text>
          )}
        </box>
      </box>
    </box>
  );
}
