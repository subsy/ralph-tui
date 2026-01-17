/**
 * ABOUTME: Type definitions for the chat engine.
 * Defines the structure for multi-turn conversations with AI agents,
 * used primarily for PRD generation but designed to be reusable.
 */

import type { AgentPlugin, AgentExecuteOptions } from '../plugins/agents/types.js';
import type { FormattedSegment } from '../plugins/agents/output-formatting.js';

/**
 * Role in a chat conversation.
 */
export type ChatRole = 'user' | 'assistant' | 'system';

/**
 * A single message in a chat conversation.
 */
export interface ChatMessage {
  /** Role of the message sender */
  role: ChatRole;

  /** Content of the message */
  content: string;

  /** Timestamp when the message was created */
  timestamp: Date;

  /** Optional metadata for the message */
  metadata?: Record<string, unknown>;
}

/**
 * Status of the chat engine.
 */
export type ChatStatus =
  | 'idle' // Ready for user input
  | 'processing' // Waiting for agent response
  | 'error' // An error occurred
  | 'completed'; // Conversation has reached a terminal state

/**
 * Configuration for the chat engine.
 */
export interface ChatEngineConfig {
  /** The agent plugin to use for generating responses */
  agent: AgentPlugin;

  /** System prompt to prepend to the conversation context */
  systemPrompt: string;

  /** Maximum conversation history to include in context (messages) */
  maxHistoryMessages?: number;

  /** Timeout for agent execution in milliseconds */
  timeout?: number;

  /** Working directory for agent execution */
  cwd?: string;

  /** Additional agent execution options */
  agentOptions?: Partial<AgentExecuteOptions>;
}

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
  /** Callback for streaming output chunks (legacy string format) */
  onChunk?: (chunk: string) => void;

  /** Callback for streaming output as TUI-native segments */
  onSegments?: (segments: FormattedSegment[]) => void;

  /** Callback for progress status updates */
  onStatus?: (status: string) => void;
}

/**
 * Result of sending a message.
 */
export interface SendMessageResult {
  /** Whether the send was successful */
  success: boolean;

  /** The assistant's response message */
  response?: ChatMessage;

  /** Error message if the send failed */
  error?: string;

  /** Duration of the agent call in milliseconds */
  durationMs?: number;
}

/**
 * Result of PRD detection in a response.
 */
export interface PrdDetectionResult {
  /** Whether a complete PRD was found */
  found: boolean;

  /** The extracted PRD content (without markers) */
  content?: string;

  /** The feature name extracted from the PRD */
  featureName?: string;
}

/**
 * Options for the PRD chat session.
 */
export interface PrdChatOptions {
  /** Working directory for output */
  cwd?: string;

  /** Output directory for PRD files (default: ./tasks) */
  outputDir?: string;

  /** The agent plugin to use */
  agent: AgentPlugin;

  /** Timeout for agent calls in milliseconds */
  timeout?: number;
}

/**
 * Result of a PRD chat session.
 */
export interface PrdChatResult {
  /** Whether the PRD was successfully generated */
  success: boolean;

  /** Path to the generated PRD markdown file */
  prdPath?: string;

  /** The raw PRD content */
  prdContent?: string;

  /** Feature name extracted from the PRD */
  featureName?: string;

  /** Error message if generation failed */
  error?: string;

  /** Whether the user cancelled the session */
  cancelled?: boolean;

  /** Full conversation history */
  conversation?: ChatMessage[];
}

/**
 * Event types emitted by the chat engine.
 */
export type ChatEventType =
  | 'message:sent' // User message was sent
  | 'message:received' // Assistant message was received
  | 'status:changed' // Status changed
  | 'error:occurred' // An error occurred
  | 'prd:detected'; // A complete PRD was detected in response

/**
 * Base interface for chat events.
 */
export interface ChatEventBase {
  /** Type of the event */
  type: ChatEventType;

  /** Timestamp when the event occurred */
  timestamp: Date;
}

/**
 * Event emitted when a message is sent.
 */
export interface ChatMessageSentEvent extends ChatEventBase {
  type: 'message:sent';

  /** The message that was sent */
  message: ChatMessage;
}

/**
 * Event emitted when a message is received.
 */
export interface ChatMessageReceivedEvent extends ChatEventBase {
  type: 'message:received';

  /** The message that was received */
  message: ChatMessage;

  /** Duration of the agent call in milliseconds */
  durationMs: number;
}

/**
 * Event emitted when status changes.
 */
export interface ChatStatusChangedEvent extends ChatEventBase {
  type: 'status:changed';

  /** Previous status */
  previousStatus: ChatStatus;

  /** New status */
  newStatus: ChatStatus;
}

/**
 * Event emitted when an error occurs.
 */
export interface ChatErrorEvent extends ChatEventBase {
  type: 'error:occurred';

  /** Error message */
  error: string;
}

/**
 * Event emitted when a PRD is detected.
 */
export interface ChatPrdDetectedEvent extends ChatEventBase {
  type: 'prd:detected';

  /** The detected PRD content */
  prdContent: string;

  /** Feature name from the PRD */
  featureName: string;
}

/**
 * Union type of all chat events.
 */
export type ChatEvent =
  | ChatMessageSentEvent
  | ChatMessageReceivedEvent
  | ChatStatusChangedEvent
  | ChatErrorEvent
  | ChatPrdDetectedEvent;

/**
 * Listener function for chat events.
 */
export type ChatEventListener = (event: ChatEvent) => void;
