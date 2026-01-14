/**
 * ABOUTME: PRD Chat application component for the Ralph TUI.
 * Provides an interactive chat interface for generating PRDs using an AI agent.
 * After PRD generation, shows a split view with PRD preview and tracker options.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { KeyEvent, PasteEvent } from '@opentui/core';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ChatView } from './ChatView.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { ChatEngine, createPrdChatEngine, slugify } from '../../chat/engine.js';
import type { ChatMessage, ChatEvent } from '../../chat/types.js';
import type { AgentPlugin } from '../../plugins/agents/types.js';
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

  return [
    {
      key: '1',
      name: 'JSON (prd.json)',
      skillPrompt: `Convert this PRD to prd.json format using the ralph-tui-create-json skill.

CRITICAL: The output MUST use this EXACT schema:

${jsonSchemaExample}

Required fields for each userStory:
- "id": string (e.g., "US-001")
- "title": string
- "passes": boolean (MUST be false for new tasks)
- "dependsOn": array of story IDs

DO NOT use:
- "tasks" array (use "userStories" instead)
- "prd" wrapper object
- "status" field (use "passes": boolean instead)
- "subtasks" (not supported)
- "estimated_hours" (not supported)

The output file MUST be saved to: tasks/prd.json`,
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
  timeout = 180000,
  onComplete,
  onCancel,
  onError,
}: PrdChatAppProps): ReactNode {
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
  const [error, setError] = useState<string | undefined>();

  // Quit confirmation dialog state
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // Track which tracker format was selected for tasks
  const [selectedTrackerFormat, setSelectedTrackerFormat] = useState<'json' | 'beads' | null>(null);

  // Refs
  const engineRef = useRef<ChatEngine | null>(null);
  const isMountedRef = useRef(true);

  // Get tracker options
  const trackerOptions = getTrackerOptions(cwd);

  // Initialize chat engine
  useEffect(() => {
    isMountedRef.current = true;
    const engine = createPrdChatEngine(agent, { cwd, timeout });

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

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [agent, cwd, timeout, onError]);

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

      // Write the file
      await writeFile(filepath, content, 'utf-8');

      // Update state for review phase
      if (isMountedRef.current) {
        setPrdContent(content);
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
      if (!engineRef.current || !prdPath || isLoading) return;

      // Record which tracker format was selected
      const format = option.key === '1' ? 'json' : 'beads';
      setSelectedTrackerFormat(format as 'json' | 'beads');

      setIsLoading(true);
      setStreamingChunk('');
      setLoadingStatus(`Creating ${option.name} tasks...`);

      // Add user selection message
      const userMsg: ChatMessage = {
        role: 'user',
        content: `Create ${option.name} tasks`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      const prompt = `${option.skillPrompt}

The PRD file is at: ${prdPath}

Read the PRD and create the appropriate tasks.`;

      try {
        const result = await engineRef.current.sendMessage(prompt, {
          onChunk: (chunk) => {
            if (isMountedRef.current) {
              setStreamingChunk((prev) => prev + chunk);
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
    [prdPath, isLoading]
  );

  /**
   * Send a chat message to the agent
   */
  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || !engineRef.current || isLoading) {
      return;
    }

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);
    setStreamingChunk('');
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
        onChunk: (chunk) => {
          if (isMountedRef.current) {
            setStreamingChunk((prev) => prev + chunk);
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
  }, [inputValue, isLoading]);

  /**
   * Handle keyboard input (only for non-input keys like Escape and review phase shortcuts)
   * Text editing is handled by the native OpenTUI input component
   */
  const handleKeyboard = useCallback(
    (key: KeyEvent) => {
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
    [showQuitConfirm, isLoading, phase, trackerOptions, handleTrackerSelect, prdPath, featureName, selectedTrackerFormat, onComplete, onCancel]
  );

  useKeyboard(handleKeyboard);

  // Handle paste events separately from keyboard input
  // OpenTUI emits paste as a separate event type on the renderer's keyInput handler
  const renderer = useRenderer();
  useEffect(() => {
    const handlePaste = (event: PasteEvent) => {
      // Don't process paste while loading or in quit confirmation
      if (isLoading || showQuitConfirm) {
        return;
      }
      // Append pasted text to input value
      if (event.text) {
        setInputValue((prev) => prev + event.text);
      }
    };

    renderer.keyInput.on('paste', handlePaste);
    return () => {
      renderer.keyInput.off('paste', handlePaste);
    };
  }, [renderer, isLoading, showQuitConfirm]);

  // Determine hint text based on phase
  const hint =
    phase === 'review'
      ? '[1] JSON  [2] Beads  [3] Done  [Enter] Chat  [Esc] Finish'
      : '[Enter] Send  [Esc] Cancel';

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
            inputPlaceholder="Ask questions or select a format..."
            error={error}
            inputEnabled={!isLoading}
            hint={hint}
            agentName={agent.meta.name}
            onInputChange={setInputValue}
            onSubmit={sendMessage}
          />
        </box>

        {/* Right pane: PRD Preview */}
        <box style={{ width: '40%', height: '100%' }}>
          <PrdPreview content={prdContent} path={prdPath} />
        </box>
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
        inputPlaceholder="Describe your feature..."
        error={error}
        inputEnabled={!isLoading && !showQuitConfirm}
        hint={hint}
        agentName={agent.meta.name}
        onInputChange={setInputValue}
        onSubmit={sendMessage}
      />
      <ConfirmationDialog
        visible={showQuitConfirm}
        title="Cancel PRD Creation?"
        message="Your progress will be lost."
        hint="[y] Yes, cancel  [n/Esc] No, continue"
      />
    </box>
  );
}
