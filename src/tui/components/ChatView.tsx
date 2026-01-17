/**
 * ABOUTME: Reusable chat interface component for the Ralph TUI.
 * Displays a conversation with an AI agent, supporting streaming output,
 * user input, and message history. Used primarily for PRD generation.
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { TextareaRenderable, KeyEvent, PasteEvent } from '@opentui/core';
import { colors } from '../theme.js';
import type { ChatMessage } from '../../chat/types.js';

import { ToastContainer } from './Toast.js';
import { usePaste } from '../hooks/usePaste.js';
import type { Toast as ToastData } from '../hooks/useToast.js';
import { FormattedText } from './FormattedText.js';
import type { FormattedSegment } from '../../plugins/agents/output-formatting.js';

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
        <text fg={colors.fg.primary}>
          {message.content}
        </text>
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
  const loadingText = agentName
    ? `Waiting for ${agentName}...`
    : loadingStatus;

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

  // Track valid markers to detect partial deletions
  // If ANY character of a marker is deleted, we clean up the whole marker and detach the image
  const previousMarkersRef = useRef<Set<string>>(new Set());
  
  // Check for deleted/corrupted markers whenever text changes
  useEffect(() => {
    if (!textareaRef.current) return;
    
    const text = textareaRef.current.plainText;
    const currentMarkers = new Set(text.match(/\[Image \d+\]/g) || []);
    const previousMarkers = previousMarkersRef.current;
    
    // Find markers that were removed or corrupted
    for (const marker of previousMarkers) {
      if (!currentMarkers.has(marker)) {
        const match = marker.match(/\[Image (\d+)\]/);
        if (match) {
          onImageMarkerDeleted?.(parseInt(match[1], 10));
        }
      }
    }
    
    // Check for partial/corrupted markers and clean them up
    // Patterns like "[Image", "Image 1]", "[Image 1", etc. should be removed
    const partialMarkerPattern = /\[Image(?:\s\d*)?(?:\])?|\bImage\s*\d+\]?/g;
    const validMarkerPattern = /\[Image \d+\]/g;
    
    // Find all partial markers that aren't valid complete markers
    let hasCorruptedMarkers = false;
    const validMatches: string[] = text.match(validMarkerPattern) || [];
    const allMatches: string[] = text.match(partialMarkerPattern) || [];
    
    for (const match of allMatches) {
      if (!validMatches.includes(match)) {
        hasCorruptedMarkers = true;
        break;
      }
    }
    
    // If we found corrupted markers, clean them up
    if (hasCorruptedMarkers && textareaRef.current) {
      const cleanedText = text.replace(partialMarkerPattern, (match) => {
        // Keep valid markers, remove partial ones
        if (/^\[Image \d+\]$/.test(match)) {
          return match;
        }
        return '';
      });
      
      if (cleanedText !== text) {
        textareaRef.current.editBuffer.setText(cleanedText);
      }
    }
    
    previousMarkersRef.current = currentMarkers;
  });

  // Handle keyboard for text editing shortcuts (macOS-style)
  const handleKeyboard = useCallback(
    (key: KeyEvent) => {
      // Only handle if textarea is focused and input is enabled
      if (!textareaRef.current || !inputEnabled || isLoading) {
        return;
      }

      const textarea = textareaRef.current;

      // Enter = submit (without modifiers)
      if (key.name === 'return' && !key.meta && !key.ctrl && !key.shift) {
        key.preventDefault?.();
        handleSubmit();
        return;
      }

      // Shift+Enter or Ctrl+J = insert newline
      if ((key.shift && key.name === 'return') || (key.ctrl && key.name === 'j')) {
        key.preventDefault?.();
        textarea.newLine();
        return;
      }

      // === Option + Arrow Keys (word navigation) ===
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

      // Option + Fn + Delete (Forward Delete on some keyboards)
      // Note: Option + Backspace is handled above with marker detection
      if (key.option && key.name === 'delete') {
        key.preventDefault?.();
        textarea.deleteWordForward();
        return;
      }

      // === Shift + Option + Arrow Keys (select by word/paragraph) ===
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

      // === Shift + Arrow Keys (select by character/line) ===
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

      // === Shift + Cmd + Arrow Keys (select to line start/end) ===
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
    [inputEnabled, isLoading, handleSubmit]
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
        onPaste(text, event);
      }
      // If no handler or handler didn't prevent default, OpenTUI's textarea
      // will handle the paste normally
    },
    [inputEnabled, isLoading, onPaste]
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
        position: 'relative',
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
        <scrollbox style={{ flexGrow: 1 }} stickyScroll={true} stickyStart="bottom">
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
              <box style={{ paddingLeft: 2, flexDirection: 'row', flexWrap: 'wrap' }}>
                {streamingSegments?.length ? (
                  <FormattedText segments={streamingSegments} />
                ) : (
                  <text fg={colors.fg.primary}>
                    {streamingChunk}
                  </text>
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
          borderColor: inputEnabled && !isLoading ? colors.border.active : colors.border.normal,
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
          <text fg={colors.accent.primary} style={{ paddingTop: 0 }}>{'>'} </text>
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
