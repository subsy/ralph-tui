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
} from './types.js';
import type { AgentPlugin, AgentExecuteOptions } from '../plugins/agents/types.js';

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
  - Plain text description on the next line: "As a user, I want to ... so that ..."
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
  private readonly config: Required<ChatEngineConfig>;

  constructor(config: ChatEngineConfig) {
    this.config = {
      agent: config.agent,
      systemPrompt: config.systemPrompt,
      maxHistoryMessages: config.maxHistoryMessages ?? 50,
      timeout: config.timeout ?? 0, // 0 = no timeout by default
      cwd: config.cwd ?? process.cwd(),
      agentOptions: config.agentOptions ?? {},
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
    if (this.status === 'processing') {
      return {
        success: false,
        error: 'Already processing a message. Please wait.',
      };
    }

    // Create and store the user message
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

    this.setStatus('processing');
    options.onStatus?.('Sending to agent...');

    const startTime = Date.now();

    try {
      // Build the full prompt with history
      const prompt = this.buildPrompt(content);

      // Collect streaming output
      let fullOutput = '';

      // Execute the agent
      const agentOptions: AgentExecuteOptions = {
        ...this.config.agentOptions,
        cwd: this.config.cwd,
        timeout: this.config.timeout,
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
      const result = await handle.promise;

      const durationMs = Date.now() - startTime;

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
 * Create a chat engine configured for PRD generation.
 */
export function createPrdChatEngine(
  agent: AgentPlugin,
  options: {
    cwd?: string;
    timeout?: number;
    prdSkill?: string;
    prdSkillSource?: string;
  } = {}
): ChatEngine {
  const systemPrompt = options.prdSkillSource
    ? buildPrdSystemPromptFromSkillSource(options.prdSkillSource)
    : options.prdSkill
      ? buildPrdSystemPrompt(options.prdSkill)
      : PRD_SYSTEM_PROMPT;

  return new ChatEngine({
    agent,
    systemPrompt,
    cwd: options.cwd,
    timeout: options.timeout ?? 0,
  });
}

export function createTaskChatEngine(
  agent: AgentPlugin,
  options: {
    cwd?: string;
    timeout?: number;
  } = {}
): ChatEngine {
  return new ChatEngine({
    agent,
    systemPrompt: TASK_SYSTEM_PROMPT,
    cwd: options.cwd,
    timeout: options.timeout ?? 0,
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
