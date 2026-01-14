/**
 * ABOUTME: Reusable chat interface component for the Ralph TUI.
 * Displays a conversation with an AI agent, supporting streaming output,
 * user input, and message history. Used primarily for PRD generation.
 */

import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { colors } from '../theme.js';
import type { ChatMessage } from '../../chat/types.js';

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

  /** Streaming output chunk (displayed during generation) */
  streamingChunk?: string;

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

  /** Callback when input value changes */
  onInputChange?: (value: string) => void;

  /** Callback when user submits (presses Enter) */
  onSubmit?: () => void;
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
  inputPlaceholder = 'Type a message...',
  error,
  inputEnabled = true,
  cursorPosition: _cursorPosition, // Not used with native input
  hint = '[Enter] Send  [Esc] Cancel',
  agentName,
  onInputChange,
  onSubmit,
}: ChatViewProps): ReactNode {
  // Generate dynamic loading text
  const loadingText = agentName
    ? `Waiting for ${agentName}...`
    : loadingStatus;
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

          {/* Streaming output during generation */}
          {isLoading && streamingChunk && (
            <box style={{ flexDirection: 'column', marginBottom: 1 }}>
              <box style={{ flexDirection: 'row', gap: 1 }}>
                <text fg={colors.accent.secondary}>Assistant</text>
                <AnimatedSpinner />
              </box>
              <box style={{ paddingLeft: 2 }}>
                <text fg={colors.fg.primary}>
                  {streamingChunk}
                </text>
              </box>
            </box>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingChunk && (
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
          height: 5,
          flexDirection: 'column',
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: inputEnabled && !isLoading ? colors.border.active : colors.border.normal,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {/* Input field - using native OpenTUI input with cursor support */}
        <box
          style={{
            height: 2,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <text fg={colors.accent.primary}>{'>'} </text>
          <input
            style={{
              flexGrow: 1,
              height: 1,
              backgroundColor: 'transparent',
              textColor: colors.fg.primary,
              focusedBackgroundColor: 'transparent',
              focusedTextColor: colors.fg.primary,
              cursorColor: colors.accent.primary,
              placeholderColor: colors.fg.muted,
            }}
            value={inputValue}
            placeholder={inputPlaceholder}
            focused={inputEnabled && !isLoading}
            onInput={onInputChange}
            onSubmit={onSubmit ? () => onSubmit() : undefined}
          />
        </box>

        {/* Hint bar */}
        <box
          style={{
            height: 1,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 1,
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
