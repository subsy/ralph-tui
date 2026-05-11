/**
 * ABOUTME: Multi-turn conversation engine for AI agent interactions.
 * Manages conversation state, builds context for each agent call,
 * and handles PRD detection for the PRD chat feature.
 */

import type {
  ChatMessage,
  ChatStatus,
  ChatEngineConfig,
  SendMessageOptions,
  SendMessageResult,
  PrdDetectionResult,
  ChatEvent,
  ChatEventListener,
  TimeoutConfig,
  TimeoutState,
} from './types.js';
import type { AgentPlugin, AgentExecuteOptions, AgentExecutionHandle } from '../plugins/agents/types.js';
import { DEFAULT_TIMEOUT_CONFIG } from './types.js';

/**
 * Default system prompt for PRD generation.
 */
export const DEFAULT_PRD_SKILL = 'ralph-tui-prd';

export function buildPrdSystemPrompt(skillName: string): string {
  return `You are helping create a Product Requirements Document (PRD) using the ${skillName} skill.

Follow these guidelines:
1. Ask clarifying questions with lettered options (A, B, C, D) for quick responses
2. Ask questions one set at a time, adapting based on previous answers
3. When you have enough context, generate the complete PRD
4. IMPORTANT: Wrap the final PRD in [PRD]...[/PRD] markers
5. IMPORTANT: Do NOT start implementing. Your job is ONLY to create the PRD document.

The user can respond with shorthand like "1A, 2C" for quick iteration.
`;
}

export const PRD_SYSTEM_PROMPT = buildPrdSystemPrompt(DEFAULT_PRD_SKILL);

const TASK_SYSTEM_PROMPT = 'You are a helpful assistant. Follow the user instructions carefully.';

const PRD_COMPATIBILITY_GUIDANCE = `
# PRD Output Requirements
- Wrap the final PRD in [PRD]...[/PRD] markers.
- Start the PRD with a "# PRD: <Feature Name>" heading.
- Include a "## Quality Gates" section listing required commands.
- Include a "## User Stories" section with entries like:
  - "### US-001: Title"
  - Plain text description on the next line: "As a user, I want ... so that ..."
  - "**Acceptance Criteria:**" followed by checklist bullets ("- [ ] ...").
- IMPORTANT: User story descriptions must be plain text (no **Description:** prefix).
- Use markdown formatting suitable for conversion tools.
`;

function stripSkillFrontMatter(skillSource: string): string {
  const frontMatterRegex = /^---\s*[\s\S]*?\n---\s*\n?/;
  return skillSource.replace(frontMatterRegex, '').trim();
}

export function buildPrdSystemPromptFromSkillSource(skillSource: string): string {
  const cleanedSource = stripSkillFrontMatter(skillSource);
  if (!cleanedSource) {
    return PRD_COMPATIBILITY_GUIDANCE.trim();
  }
  return `${cleanedSource}\n\n${PRD_COMPATIBILITY_GUIDANCE}`.trim();
}

/**
 * ChatEngine manages multi-turn conversations with an AI agent.
 * Each message triggers an agent call with the full conversation history.
 */
export class ChatEngine {
  private messages: ChatMessage[] = [];
  private status: ChatStatus = 'idle';
  private listeners: Set<ChatEventListener> = new Set();
  private readonly config: Required<ChatEngineConfig> & { timeoutConfig: TimeoutConfig };
  private timeoutState: TimeoutState;
  private currentExecution: AgentExecutionHandle | null = null;
  private pendingUserMessage: string | null = null;
  private pendingOptions: SendMessageOptions | null = null;

  constructor(config: ChatEngineConfig) {
    // Merge timeout config with defaults
    const timeoutConfig: TimeoutConfig = {
      ...DEFAULT_TIMEOUT_CONFIG,
      ...config.timeoutConfig,
    };

    this.config = {
      agent: config.agent,
      systemPrompt: config.systemPrompt,
      maxHistoryMessages: config.maxHistoryMessages ?? 50,
      timeout: config.timeout ?? 0, // 0 = no timeout by default
      cwd: config.cwd ?? process.cwd(),
      agentOptions: config.agentOptions ?? {},
      timeoutConfig,
    };

    // Initialize timeout state
    this.timeoutState = {
      retryCount: 0,
      currentTimeout: this.config.timeout > 0
        ? this.config.timeout
        : timeoutConfig.initialTimeout,
      retryPending: false,
    };
  }

  /**
   * Subscribe to chat events.
   * @param listener The listener function to call on events
   * @returns Unsubscribe function
   */
  on(listener: ChatEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: ChatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Set the chat status and emit an event.
   */
  private setStatus(newStatus: ChatStatus): void {
    const previousStatus = this.status;
    this.status = newStatus;
    this.emit({
      type: 'status:changed',
      timestamp: new Date(),
      previousStatus,
      newStatus,
    });
  }

  /**
   * Get the current conversation history.
   */
  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Get the current status.
   */
  getStatus(): ChatStatus {
    return this.status;
  }

  /**
   * Get the current timeout state.
   */
  getTimeoutState(): Readonly<TimeoutState> {
    return { ...this.timeoutState };
  }

  /**
   * Continue with a retry after a timeout.
   */
  retry(): void {
    if (this.status !== 'timeout') {
      return;
    }
    void this.doRetry();
  }

  /**
   * Cancel after a timeout - don't retry.
   */
  cancelTimeout(): void {
    if (this.status !== 'timeout') {
      return;
    }

    // Reset state
    this.timeoutState.retryPending = false;
    this.timeoutState.retryCount = 0;
    this.timeoutState.currentTimeout = this.config.timeout > 0
      ? this.config.timeout
      : this.config.timeoutConfig.initialTimeout;
    this.pendingUserMessage = null;
    this.pendingOptions = null;

    this.setStatus('idle');
  }

  /**
   * Continue waiting indefinitely after a timeout.
   * Re-sends the request with no timeout.
   */
  continueIndefinitely(): void {
    if (this.status !== 'timeout' || !this.pendingUserMessage || !this.pendingOptions) {
      return;
    }

    void this.doContinueIndefinitely();
  }

  /**
   * Interrupt the current execution.
   */
  interrupt(): void {
    if (this.currentExecution?.isRunning()) {
      this.currentExecution.interrupt();
    }
  }

  /**
   * Execute the continue-indefinitely logic.
   */
  private async doContinueIndefinitely(): Promise<void> {
    if (!this.pendingUserMessage || !this.pendingOptions) {
      this.setStatus('idle');
      return;
    }

    // Reset retry state for the indefinite wait
    this.timeoutState.retryPending = false;
    this.timeoutState.currentTimeout = 0; // 0 = no timeout

    // Emit retry started event
    this.emit({
      type: 'retry:started',
      timestamp: new Date(),
      timeoutState: { ...this.timeoutState },
    });

    this.setStatus('retrying');

    // Retry the message with no timeout
    const userMsg = this.pendingUserMessage;
    const options = this.pendingOptions;
    this.pendingUserMessage = null;
    this.pendingOptions = null;

    await this._sendMessageInternal(userMsg, options, true, true);
  }

  /**
   * Execute the retry logic.
   */
  private async doRetry(): Promise<void> {
    if (!this.pendingUserMessage || !this.pendingOptions) {
      this.setStatus('idle');
      return;
    }

    // Increment retry count and update timeout
    this.timeoutState.retryCount++;
    this.timeoutState.currentTimeout = Math.min(
      this.timeoutState.currentTimeout * this.config.timeoutConfig.timeoutMultiplier,
      this.config.timeoutConfig.maxTimeout
    );
    this.timeoutState.retryPending = false;

    // Emit retry started event
    this.emit({
      type: 'retry:started',
      timestamp: new Date(),
      timeoutState: { ...this.timeoutState },
    });

    this.setStatus('retrying');

    // Retry the message
    const userMsg = this.pendingUserMessage;
    const options = this.pendingOptions;
    this.pendingUserMessage = null;
    this.pendingOptions = null;

    await this._sendMessageInternal(userMsg, options, true);
  }

  /**
   * Build the prompt for the agent including conversation history.
   * Uses markdown formatting (not XML tags) for compatibility with CLI agents
   * that may interpret angle-bracket tags as protocol markers.
   */
  private buildPrompt(userMessage: string): string {
    const parts: string[] = [];

    // Add system instructions using markdown header
    parts.push('## Instructions\n');
    parts.push(this.config.systemPrompt);
    parts.push('');

    // Add conversation history (limited by maxHistoryMessages)
    const historyToInclude = this.messages.slice(-this.config.maxHistoryMessages);

    if (historyToInclude.length > 0) {
      parts.push('## Conversation History\n');
      for (const msg of historyToInclude) {
        if (msg.role === 'user') {
          parts.push(`User: ${msg.content}`);
        } else if (msg.role === 'assistant') {
          parts.push(`Assistant: ${msg.content}`);
        }
      }
      parts.push('');
    }

    // Add the current user message
    parts.push('## Current Request\n');
    parts.push(userMessage);

    return parts.join('\n');
  }

  /**
   * Send a message and get the assistant's response.
   */
  async sendMessage(
    content: string,
    options: SendMessageOptions = {}
  ): Promise<SendMessageResult> {
    // If we're in timeout state, don't allow sending
    if (this.status === 'timeout' || this.status === 'retrying') {
      return {
        success: false,
        error: 'Cannot send message while in timeout state',
      };
    }

    if (this.status === 'processing') {
      return {
        success: false,
        error: 'Already processing a message. Please wait.',
      };
    }

    // Reset retry state for new messages
    this.timeoutState.retryCount = 0;
    this.timeoutState.currentTimeout = this.config.timeout > 0
      ? this.config.timeout
      : this.config.timeoutConfig.initialTimeout;

    return await this._sendMessageInternal(content, options, false);
  }

  /**
   * Internal implementation of sendMessage that handles retries.
   */
  private async _sendMessageInternal(
    content: string,
    options: SendMessageOptions,
    isRetry: boolean,
    noTimeout: boolean = false,
  ): Promise<SendMessageResult> {
    // Create and store the user message if this isn't a retry
    if (!isRetry) {
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: new Date(),
      };
      this.messages.push(userMessage);
      this.emit({
        type: 'message:sent',
        timestamp: new Date(),
        message: userMessage,
      });
    }

    this.setStatus('processing');
    options.onStatus?.('Sending to agent...');

    const startTime = Date.now();
    this.timeoutState.requestStartTime = startTime;

    try {
      // Build the full prompt with history
      const prompt = this.buildPrompt(content);

      // Collect streaming output
      let fullOutput = '';

      // Determine timeout to use for this attempt
      const attemptTimeout = noTimeout ? 0 : this.timeoutState.currentTimeout;

      // Execute the agent
      const agentOptions: AgentExecuteOptions = {
        ...this.config.agentOptions,
        cwd: this.config.cwd,
        timeout: attemptTimeout,
        onStdout: (data: string) => {
          fullOutput += data;
          options.onChunk?.(data);
        },
        onStdoutSegments: options.onSegments,
        onStderr: (data: string) => {
          // Include stderr in output (some agents use it for status)
          options.onChunk?.(data);
        },
      };

      const handle = this.config.agent.execute(prompt, [], agentOptions);
      this.currentExecution = handle;

      const result = await handle.promise;
      this.currentExecution = null;

      const durationMs = Date.now() - startTime;

      if (result.status === 'timeout') {
        // Handle timeout
        return await this.handleTimeout(content, options, durationMs);
      }

      if (result.status !== 'completed') {
        this.setStatus('error');
        // Build a useful error message: prefer explicit error, then stderr, then generic status
        const trimmedStderr = result.stderr?.trim();
        const errorMessage = result.error || trimmedStderr || `Execution ${result.status}`;
        this.emit({
          type: 'error:occurred',
          timestamp: new Date(),
          error: errorMessage,
        });
        return {
          success: false,
          error: errorMessage,
          durationMs,
        };
      }

      // Use collected streaming output or fallback to result stdout
      const responseContent = fullOutput || result.stdout;

      // Reset retry state on success
      this.timeoutState.retryCount = 0;
      this.timeoutState.currentTimeout = this.config.timeout > 0
        ? this.config.timeout
        : this.config.timeoutConfig.initialTimeout;

      // Create and store the assistant message
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: responseContent.trim(),
        timestamp: new Date(),
      };

      this.messages.push(assistantMessage);
      this.setStatus('idle');

      this.emit({
        type: 'message:received',
        timestamp: new Date(),
        message: assistantMessage,
        durationMs,
      });

      // Check for PRD completion
      const prdResult = this.detectPrd(responseContent);
      if (prdResult.found && prdResult.content && prdResult.featureName) {
        this.setStatus('completed');
        this.emit({
          type: 'prd:detected',
          timestamp: new Date(),
          prdContent: prdResult.content,
          featureName: prdResult.featureName,
        });
      }

      return {
        success: true,
        response: assistantMessage,
        durationMs,
      };
    } catch (error) {
      this.currentExecution = null;
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.setStatus('error');
      this.emit({
        type: 'error:occurred',
        timestamp: new Date(),
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Handle a timeout - interrupt and ask user what to do.
   */
  private async handleTimeout(
    content: string,
    options: SendMessageOptions,
    durationMs: number,
  ): Promise<SendMessageResult> {
    // First, interrupt the running process (like Ctrl+C)
    if (this.currentExecution?.isRunning()) {
      this.currentExecution.interrupt();
    }

    // Update state
    this.timeoutState.retryPending = true;

    // Emit timeout event
    this.emit({
      type: 'timeout:occurred',
      timestamp: new Date(),
      timeoutState: { ...this.timeoutState },
    });

    this.setStatus('timeout');

    // Store for potential retry
    this.pendingUserMessage = content;
    this.pendingOptions = options;

    // Return a special result indicating we're waiting for user decision
    return {
      success: false,
      error: `Request timed out after ${durationMs}ms - interrupted`,
      durationMs,
    };
  }

  /**
   * Detect if a response contains a complete PRD.
   */
  detectPrd(response: string): PrdDetectionResult {
    // Strategy 1: Look for [PRD]...[/PRD] markers (preferred)
    const markerMatch = response.match(/\[PRD\]([\s\S]+?)\[\/PRD\]/);
    if (markerMatch && markerMatch[1]) {
      const content = markerMatch[1].trim();
      const featureName = this.extractFeatureName(content);
      return {
        found: true,
        content,
        featureName,
      };
    }

    // Strategy 2: Look for markdown PRD heading as last major section
    // This handles cases where the agent forgets markers
    const prdMatch = response.match(/# PRD:\s*(.+?)[\n\r]([\s\S]+)$/);
    if (prdMatch && prdMatch[1] && prdMatch[2]) {
      const content = `# PRD: ${prdMatch[1]}\n${prdMatch[2]}`.trim();
      const featureName = prdMatch[1].trim();
      return {
        found: true,
        content,
        featureName,
      };
    }

    return { found: false };
  }

  /**
   * Extract the feature name from PRD content.
   */
  private extractFeatureName(content: string): string {
    // Look for "# PRD: Feature Name" pattern
    const match = content.match(/# PRD:\s*(.+?)[\n\r]/);
    if (match && match[1]) {
      return match[1].trim();
    }

    // Fallback: try to find any H1 heading
    const h1Match = content.match(/# (.+?)[\n\r]/);
    if (h1Match && h1Match[1]) {
      return h1Match[1].trim();
    }

    return 'Untitled Feature';
  }

  /**
   * Reset the conversation to start fresh.
   */
  reset(): void {
    this.messages = [];
    this.timeoutState = {
      retryCount: 0,
      currentTimeout: this.config.timeout > 0
        ? this.config.timeout
        : this.config.timeoutConfig.initialTimeout,
      retryPending: false,
    };
    this.pendingUserMessage = null;
    this.pendingOptions = null;
    this.currentExecution = null;
    this.setStatus('idle');
  }

  /**
   * Get the agent plugin being used.
   */
  getAgent(): AgentPlugin {
    return this.config.agent;
  }
}

/**
 * Build agent-execute flags for the chat engine.
 * Mirrors run.tsx engine which injects --model at execute time.
 */
function buildAgentFlags(options: { model?: string }): string[] | undefined {
  if (!options.model) return undefined;
  return ['--model', options.model];
}

/**
 * Create a chat engine configured for PRD generation.
 */
export function createPrdChatEngine(
  agent: AgentPlugin,
  options: {
    cwd?: string;
    timeout?: number;
    prdSkill?: string;
    prdSkillSource?: string;
    model?: string;
    timeoutConfig?: Partial<TimeoutConfig>;
  } = {}
): ChatEngine {
  const systemPrompt = options.prdSkillSource
    ? buildPrdSystemPromptFromSkillSource(options.prdSkillSource)
    : options.prdSkill
      ? buildPrdSystemPrompt(options.prdSkill)
      : PRD_SYSTEM_PROMPT;

  const flags = buildAgentFlags(options);

  return new ChatEngine({
    agent,
    systemPrompt,
    cwd: options.cwd,
    timeout: options.timeout ?? 60000, // Default 1 minute timeout
    timeoutConfig: options.timeoutConfig,
    ...(flags ? { agentOptions: { flags } } : {}),
  });
}

export function createTaskChatEngine(
  agent: AgentPlugin,
  options: {
    cwd?: string;
    timeout?: number;
    model?: string;
    timeoutConfig?: Partial<TimeoutConfig>;
  } = {}
): ChatEngine {
  const flags = buildAgentFlags(options);

  return new ChatEngine({
    agent,
    systemPrompt: TASK_SYSTEM_PROMPT,
    cwd: options.cwd,
    timeout: options.timeout ?? 60000, // Default 1 minute timeout
    timeoutConfig: options.timeoutConfig,
    ...(flags ? { agentOptions: { flags } } : {}),
  });
}

/**
 * Slugify a string for use in file names.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}
