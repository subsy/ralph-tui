/**
 * ABOUTME: Reusable chat interface component for the Ralph TUI.
 * Displays a conversation with an AI agent, supporting streaming output,
 * user input, and message history. Used primarily for PRD generation.
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { TextareaRenderable, KeyEvent } from '@opentui/core';
import { colors } from '../theme.js';
import type { ChatMessage } from '../../chat/types.js';
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
 * Animated progress bar with fake percentage (asymptotically approaches 99%)
 * Simulates progress for unknown-duration tasks like AI responses
 */
function AnimatedProgressBar({ width = 20 }: { width?: number }): ReactNode {
  const [percentage, setPercentage] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      // Asymptotic function: quickly reaches 50%, slowly approaches 99%
      // Formula: 99 * (1 - e^(-elapsed/10))
      const newPercentage = Math.min(99, Math.floor(99 * (1 - Math.exp(-elapsed / 10))));
      setPercentage(newPercentage);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;
  const filled = '▓'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);

  return (
    <text fg={colors.status.info}>
      {filled}{empty} {percentage}%
    </text>
  );
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
}: ChatViewProps): ReactNode {
  // Generate dynamic loading text
  const loadingText = agentName
    ? `Waiting for ${agentName}...`
    : loadingStatus;

  // Textarea ref for submit handling and value access
  const textareaRef = useRef<TextareaRenderable>(null);

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

      // === Option + Delete (delete word) ===
      if (key.option && key.name === 'backspace') {
        key.preventDefault?.();
        textarea.deleteWordBackward();
        return;
      }
      // Option + Fn + Delete (Forward Delete on some keyboards)
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

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
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
              <AnimatedProgressBar width={20} />
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
