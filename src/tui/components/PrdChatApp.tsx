/**
 * ABOUTME: PRD Chat application component for the Ralph TUI.
 * Provides an interactive chat interface for generating PRDs using an AI agent.
 * After PRD generation, shows a split view with PRD preview and tracker options.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import { platform } from 'node:os';
import { writeToClipboard } from '../../utils/index.js';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ChatView } from './ChatView.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { ChatEngine, createPrdChatEngine, createTaskChatEngine, slugify } from '../../chat/engine.js';
import type { ChatMessage, ChatEvent } from '../../chat/types.js';
import type { AgentPlugin } from '../../plugins/agents/types.js';
import { stripAnsiCodes, type FormattedSegment } from '../../plugins/agents/output-formatting.js';
import { parsePrdMarkdown } from '../../prd/parser.js';
import { colors } from '../theme.js';

/**
 * Props for the PrdChatApp component
 */
/**
 * Result of PRD creation including tracker selection
 */
export interface PrdCreationResult {
  /** Path to the generated PRD markdown file */
  prdPath: string;
  /** Name of the feature */
  featureName: string;
  /** Tracker format selected (if any) */
  selectedTracker?: 'json' | 'beads' | null;
}

export interface PrdChatAppProps {
  /** Agent plugin to use for generating responses */
  agent: AgentPlugin;

  /** Working directory for output */
  cwd?: string;

  /** Output directory for PRD files (default: ./tasks) */
  outputDir?: string;

  /** Timeout for agent calls in milliseconds */
  timeout?: number;

  prdSkill?: string;

  prdSkillSource?: string;

  /** Labels to apply to created beads issues (from config trackerOptions) */
  trackerLabels?: string[];

  /** Callback when PRD is successfully generated */
  onComplete: (result: PrdCreationResult) => void;

  /** Callback when user cancels */
  onCancel: () => void;

  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

/**
 * Initial welcome message from the assistant
 */
const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: `I'll help you create a Product Requirements Document (PRD).

What feature would you like to build? Describe it in a few sentences, and I'll ask clarifying questions to understand your needs.`,
  timestamp: new Date(),
};

/**
 * Tracker option for task generation
 */
interface TrackerOption {
  key: string;
  name: string;
  skillPrompt: string;
  available: boolean;
}

/**
 * Get available tracker options based on project setup
 */
function getTrackerOptions(cwd: string): TrackerOption[] {
  const beadsDir = join(cwd, '.beads');
  const hasBeads = existsSync(beadsDir);

  const jsonSchemaExample = `{
  "name": "Feature Name",
  "branchName": "feature/my-feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a user, I want...",
      "acceptanceCriteria": ["Criterion 1"],
      "priority": 1,
      "passes": false,
      "dependsOn": []
    }
  ]
}`;

  const wrongSchemaExample = `{
  "prd": { ... },           // WRONG - no wrapper object!
  "tasks": [ ... ],         // WRONG - use "userStories" not "tasks"
  "metadata": { ... },      // WRONG - top-level metadata not supported
  "overview": { ... },      // WRONG - not part of schema
  "migration_strategy": {}, // WRONG - not part of schema
  "phases": [ ... ]         // WRONG - use flat userStories array
}`;

  return [
    {
      key: '1',
      name: 'JSON (prd.json)',
      skillPrompt: `Convert this PRD to prd.json format using the ralph-tui-create-json skill.

## CRITICAL SCHEMA REQUIREMENTS

The output JSON file MUST be a FLAT object at the root level with this EXACT structure:

${jsonSchemaExample}

## FORBIDDEN PATTERNS - DO NOT USE THESE

The following patterns will cause validation errors and MUST NOT be used:

${wrongSchemaExample}

## FIELD REQUIREMENTS

Required root-level fields:
- "name": string (project/feature name)
- "userStories": array of story objects

Required fields for EACH userStory:
- "id": string (e.g., "US-001", "US-002")
- "title": string (short descriptive title)
- "passes": boolean (MUST be false for new tasks)
- "dependsOn": array of story IDs (can be empty array [])

Optional fields for userStory:
- "description": string
- "acceptanceCriteria": array of strings
- "priority": number (1 = highest)
- "labels": array of strings
- "notes": string

## VALIDATION RULES

1. NO wrapper objects - "name" and "userStories" must be at ROOT level
2. NO "prd" field - this is a common AI hallucination, DO NOT USE IT
3. NO "tasks" field - the array is called "userStories"
4. NO "status" field - use "passes": boolean instead
5. NO "subtasks" - not supported by the tracker
6. NO "estimated_hours" or time estimates - not supported
7. NO nested structures like "phases" or "migration_strategy"

## OUTPUT

Save the file to: tasks/prd.json

Transform any complex PRD structure (phases, milestones, etc.) into a FLAT list of userStories.`,
      available: true,
    },
    {
      key: '2',
      name: 'Beads issues',
      skillPrompt: 'Convert this PRD to beads using the ralph-tui-create-beads skill.',
      available: hasBeads,
    },
  ];
}

/**
 * Build the labels instruction appended to the beads skill prompt.
 * Deduplicates labels case-insensitively and always includes 'ralph'.
 * Returns an empty string when no labels are configured.
 * @internal Exported for testing
 */
export function buildBeadsLabelsInstruction(trackerLabels?: string[]): string {
  if (!trackerLabels || trackerLabels.length === 0) return '';

  const seen = new Set<string>(['ralph']);
  const allLabels = ['ralph'];
  for (const l of trackerLabels) {
    const key = l.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      allLabels.push(l);
    }
  }
  const labelsStr = allLabels.join(',');
  return `

IMPORTANT: Apply these labels to EVERY issue created (epic and all child tasks):
  --labels "${labelsStr}"

Add the --labels flag to every bd create / br create command.`;
}

/**
 * PRD Preview component for the right panel
 */
function PrdPreview({ content, path }: { content: string; path: string }): ReactNode {
  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.secondary,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      {/* Header */}
      <box
        style={{
          height: 3,
          paddingLeft: 1,
          paddingRight: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.bg.tertiary,
        }}
      >
        <text fg={colors.accent.primary}>PRD Preview</text>
        <text fg={colors.fg.muted}>{path.split('/').pop()}</text>
      </box>

      {/* Content - scrollable, shows full PRD */}
      <scrollbox style={{ flexGrow: 1, padding: 1 }} stickyScroll={false}>
        <text fg={colors.fg.primary}>{content}</text>
      </scrollbox>
    </box>
  );
}

/**
 * PrdChatApp component - Main application for PRD chat generation
 */
export function PrdChatApp({
  agent,
  cwd = process.cwd(),
  outputDir = 'tasks',
  timeout = 0,
  prdSkill,
  prdSkillSource,
  trackerLabels,
  onComplete,
  onCancel,
  onError,
}: PrdChatAppProps): ReactNode {
  const renderer = useRenderer();
  // Copy feedback message state (auto-dismissed after 2s)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Phase: 'chat' for PRD generation, 'review' for tracker selection
  const [phase, setPhase] = useState<'chat' | 'review'>('chat');

  // PRD data (set when PRD is detected)
  const [prdContent, setPrdContent] = useState<string | null>(null);
  const [prdPath, setPrdPath] = useState<string | null>(null);
  const [featureName, setFeatureName] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [streamingChunk, setStreamingChunk] = useState('');
  const [streamingSegments, setStreamingSegments] = useState<FormattedSegment[]>([]);
  const [error, setError] = useState<string | undefined>();

  // Quit confirmation dialog state
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // Track which tracker format was selected for tasks
  const [selectedTrackerFormat, setSelectedTrackerFormat] = useState<'json' | 'beads' | null>(null);

  // Refs
  const engineRef = useRef<ChatEngine | null>(null);
  const taskEngineRef = useRef<ChatEngine | null>(null);
  const isMountedRef = useRef(true);

  // Get tracker options
  const trackerOptions = getTrackerOptions(cwd);

  // Initialize chat engine
  useEffect(() => {
    isMountedRef.current = true;
    const engine = createPrdChatEngine(agent, {
      cwd,
      timeout,
      prdSkill,
      prdSkillSource,
    });
    const taskEngine = createTaskChatEngine(agent, { cwd, timeout });

    // Subscribe to events
    const unsubscribe = engine.on((event: ChatEvent) => {
      switch (event.type) {
        case 'status:changed':
          break;

        case 'prd:detected':
          // PRD was detected - save and switch to review phase
          void handlePrdDetected(event.prdContent, event.featureName);
          break;

        case 'error:occurred':
          if (isMountedRef.current) {
            setError(event.error);
          }
          onError?.(event.error);
          break;
      }
    });

    engineRef.current = engine;
    taskEngineRef.current = taskEngine;

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [agent, cwd, timeout, prdSkill, prdSkillSource, onError]);

  /**
   * Handle PRD detection - save file and switch to review phase
   */
  const handlePrdDetected = async (content: string, name: string) => {
    try {
      const fullOutputDir = join(cwd, outputDir);

      // Ensure output directory exists
      try {
        await access(fullOutputDir);
      } catch {
        await mkdir(fullOutputDir, { recursive: true });
      }

      // Generate filename
      const slug = slugify(name);
      const filename = `prd-${slug}.md`;
      const filepath = join(fullOutputDir, filename);

      // Strip ANSI codes before saving (agents like Kiro output colored text)
      const cleanContent = stripAnsiCodes(content);

      // Write the file
      await writeFile(filepath, cleanContent, 'utf-8');

      // Update state for review phase
      if (isMountedRef.current) {
        setPrdContent(cleanContent);
        setPrdPath(filepath);
        setFeatureName(name);
        setPhase('review');

        // Add tracker options message
        const availableOptions = trackerOptions.filter((t) => t.available);
        const optionsText = availableOptions
          .map((t) => `  [${t.key}] ${t.name}`)
          .join('\n');

        const reviewMessage: ChatMessage = {
          role: 'assistant',
          content: `PRD saved to: ${filepath}

Would you like me to create tasks from this PRD?

${optionsText}
  [3] Done - I'll create tasks later

Press a number key to select, or continue chatting.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, reviewMessage]);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (isMountedRef.current) {
        setError(`Failed to save PRD: ${errorMsg}`);
      }
      onError?.(errorMsg);
    }
  };

  /**
   * Handle tracker selection - send skill prompt to agent
   */
  const handleTrackerSelect = useCallback(
    async (option: TrackerOption) => {
      if (!taskEngineRef.current || !prdPath || !prdContent || isLoading) return;

      const parsedPrd = parsePrdMarkdown(prdContent);
      if (parsedPrd.userStories.length === 0) {
        const errorMessage =
          'PRD has no user stories. Add sections with one of these formats:\n' +
          '  • "### US-001: Title" (standard 3-digit)\n' +
          '  • "### US-2.1.1: Title" (version-style)\n' +
          '  • "### EPIC-123: Title" (custom prefix)\n' +
          '  • "### Feature 1.1: Title" (feature format)\n' +
          'Each section must include acceptance criteria checklists.';
        setError(errorMessage);
        onError?.(errorMessage);
        return;
      }

      // Record which tracker format was selected
      const format = option.key === '1' ? 'json' : 'beads';
      setSelectedTrackerFormat(format as 'json' | 'beads');

      setIsLoading(true);
      setStreamingChunk('');
      setStreamingSegments([]);
      setLoadingStatus(`Creating ${option.name} tasks...`);

      // Add user selection message
      const userMsg: ChatMessage = {
        role: 'user',
        content: `Create ${option.name} tasks`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Build labels instruction for beads format
      const labelsInstruction =
        format === 'beads' ? buildBeadsLabelsInstruction(trackerLabels) : '';

      const prompt = `${option.skillPrompt}

The PRD file is at: ${prdPath}

Read the PRD and create the appropriate tasks.${labelsInstruction}`;

      try {
        const result = await taskEngineRef.current.sendMessage(prompt, {
          onSegments: (segments) => {
            if (isMountedRef.current) {
              setStreamingSegments((prev) => [...prev, ...segments]);
            }
          },
          onStatus: (status) => {
            if (isMountedRef.current) {
              setLoadingStatus(status);
            }
          },
        });

        if (isMountedRef.current) {
          if (result.success && result.response) {
            setMessages((prev) => [...prev, result.response!]);
            setStreamingChunk('');
            setStreamingSegments([]);

            // Add completion message and finish
            const doneMsg: ChatMessage = {
              role: 'assistant',
              content: 'Tasks created! Press [3] to finish or select another format.',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, doneMsg]);
          } else if (!result.success) {
            setError(result.error || 'Failed to create tasks');
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (isMountedRef.current) {
          setError(errorMsg);
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setLoadingStatus('');
        }
      }
    },
    [prdPath, prdContent, isLoading, onError, trackerLabels]
  );

  /**
   * Send a chat message to the agent
   */
  const sendMessage = useCallback(
    async (value?: string) => {
      const userMessage = value?.trim() ?? inputValue.trim();
      if (!userMessage || !engineRef.current || isLoading) {
        return;
      }

      setInputValue('');
      setIsLoading(true);
      setStreamingChunk('');
      setStreamingSegments([]);
      setLoadingStatus('Sending to agent...');
      setError(undefined);

    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result = await engineRef.current.sendMessage(userMessage, {
        onSegments: (segments) => {
          if (isMountedRef.current) {
            setStreamingSegments((prev) => [...prev, ...segments]);
          }
        },
        onStatus: (status) => {
          if (isMountedRef.current) {
            setLoadingStatus(status);
          }
        },
      });

      if (isMountedRef.current) {
        if (result.success && result.response) {
          setMessages((prev) => [...prev, result.response!]);
          setStreamingChunk('');
          setStreamingSegments([]);
        } else if (!result.success) {
          setError(result.error || 'Failed to get response');
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (isMountedRef.current) {
        setError(errorMsg);
      }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setLoadingStatus('');
        }
      }
    },
    [inputValue, isLoading]
  );

  /**
   * Handle keyboard input (only for non-input keys like Escape and review phase shortcuts)
   * Text editing is handled by the native OpenTUI input component
   */
  const handleKeyboard = useCallback(
    (key: KeyEvent) => {
      // Handle clipboard copy:
      // - macOS: Cmd+C (meta key)
      // - Linux: Ctrl+Shift+C or Alt+C
      // - Windows: Ctrl+C
      // Note: We check this early so copy works even when dialogs are open
      const isMac = platform() === 'darwin';
      const isWindows = platform() === 'win32';
      const selection = renderer.getSelection();
      const isCopyShortcut = isMac
        ? key.meta && key.name === 'c'
        : isWindows
          ? key.ctrl && key.name === 'c'
          : (key.ctrl && key.shift && key.name === 'c') || (key.option && key.name === 'c');

      if (isCopyShortcut && selection) {
        const selectedText = selection.getSelectedText();
        if (selectedText && selectedText.length > 0) {
          writeToClipboard(selectedText).then((result) => {
            if (result.success) {
              setCopyFeedback(`Copied ${result.charCount} chars`);
            }
          });
        }
        return;
      }

      // Handle quit confirmation dialog
      if (showQuitConfirm) {
        if (key.name === 'y' || key.sequence === 'y' || key.sequence === 'Y') {
          setShowQuitConfirm(false);
          onCancel();
        } else if (key.name === 'n' || key.name === 'escape' || key.sequence === 'n' || key.sequence === 'N') {
          setShowQuitConfirm(false);
        }
        return;
      }

      // Don't process keys while loading
      if (isLoading) {
        return;
      }

      // In review phase, handle number keys for tracker selection
      if (phase === 'review' && key.sequence) {
        const keyNum = key.sequence;
        if (keyNum === '1' || keyNum === '2') {
          const option = trackerOptions.find((t) => t.key === keyNum && t.available);
          if (option) {
            void handleTrackerSelect(option);
            return;
          }
        }
        if (keyNum === '3') {
          // Done - complete and exit
          if (prdPath && featureName) {
            onComplete({ prdPath, featureName, selectedTracker: selectedTrackerFormat });
          }
          return;
        }
      }

      // Handle escape key
      if (key.name === 'escape') {
        if (phase === 'review' && prdPath && featureName) {
          // In review phase, escape completes (PRD already saved)
          onComplete({ prdPath, featureName, selectedTracker: selectedTrackerFormat });
        } else {
          // In chat phase, show confirmation dialog
          setShowQuitConfirm(true);
        }
      }
    },
    [showQuitConfirm, isLoading, phase, trackerOptions, handleTrackerSelect, prdPath, featureName, selectedTrackerFormat, onComplete, onCancel, renderer]
  );

  useKeyboard(handleKeyboard);

  // Auto-dismiss copy feedback after 2 seconds
  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => {
      setCopyFeedback(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  // Determine hint text based on phase
  const hint =
    phase === 'review'
      ? '[1] JSON  [2] Beads  [3] Done  [Enter] Chat  [Esc] Finish'
      : '[Enter] Send  [Shift+Enter/Ctrl+J] Newline  [Esc] Cancel';

  // In review phase, show split pane
  if (phase === 'review' && prdContent && prdPath) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'row',
        }}
      >
        {/* Left pane: Chat */}
        <box style={{ width: '60%', height: '100%' }}>
          <ChatView
            title="PRD Creator"
            subtitle="Task Generation"
            messages={messages}
            inputValue={inputValue}
            isLoading={isLoading}
            loadingStatus={loadingStatus}
            streamingChunk={streamingChunk}
            streamingSegments={streamingSegments}
            inputPlaceholder="Ask questions or select a format..."
            error={error}
            inputEnabled={!isLoading}
            hint={hint}
            agentName={agent.meta.name}
            onSubmit={sendMessage}
          />
        </box>

        {/* Right pane: PRD Preview */}
        <box style={{ width: '40%', height: '100%' }}>
          <PrdPreview content={prdContent} path={prdPath} />
        </box>

        {/* Copy feedback toast - positioned at bottom right */}
        {copyFeedback && (
          <box
            style={{
              position: 'absolute',
              bottom: 2,
              right: 2,
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: colors.bg.tertiary,
              border: true,
              borderColor: colors.status.success,
            }}
          >
            <text fg={colors.status.success}>✓ {copyFeedback}</text>
          </box>
        )}
      </box>
    );
  }

  // Chat phase: single pane with quit confirmation dialog
  return (
    <box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ChatView
        title="PRD Creator"
        subtitle={`Using ${agent.meta.name}`}
        messages={messages}
        inputValue={inputValue}
        isLoading={isLoading}
        loadingStatus={loadingStatus}
        streamingChunk={streamingChunk}
        streamingSegments={streamingSegments}
        inputPlaceholder="Describe your feature..."
        error={error}
        inputEnabled={!isLoading && !showQuitConfirm}
        hint={hint}
        agentName={agent.meta.name}
        onSubmit={sendMessage}
      />
      <ConfirmationDialog
        visible={showQuitConfirm}
        title="Cancel PRD Creation?"
        message="Your progress will be lost."
        hint="[y] Yes, cancel  [n/Esc] No, continue"
      />

      {/* Copy feedback toast - positioned at bottom right */}
      {copyFeedback && (
        <box
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: colors.bg.tertiary,
            border: true,
            borderColor: colors.status.success,
          }}
        >
          <text fg={colors.status.success}>✓ {copyFeedback}</text>
        </box>
      )}
    </box>
  );
}
