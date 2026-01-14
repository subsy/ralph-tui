/**
 * ABOUTME: PRD Chat application component for the Ralph TUI.
 * Provides an interactive chat interface for generating PRDs using an AI agent.
 * After PRD generation, shows a split view with PRD preview and tracker options.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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
  unavailableReason?: string;
}

/**
 * Check if bd CLI is available
 */
async function isBdAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('bd', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 2 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 2000);
  });
}

/**
 * Get available tracker options based on project setup
 */
async function getTrackerOptions(cwd: string): Promise<TrackerOption[]> {
  const beadsDir = join(cwd, '.beads');
  const hasBeadsDir = existsSync(beadsDir);
  const hasBd = await isBdAvailable();
  const beadsAvailable = hasBeadsDir && hasBd;

  return [
    {
      key: '1',
      name: 'JSON (prd.json)',
      skillPrompt: 'Convert this PRD to prd.json format using the ralph-tui-create-json skill.',
      available: true,
    },
    {
      key: '2',
      name: 'Beads issues',
      skillPrompt: 'Convert this PRD to beads using the ralph-tui-create-beads skill.',
      available: beadsAvailable,
      unavailableReason: !hasBeadsDir
        ? 'Beads directory (.beads/) not found. Run "bd init" to set up Beads.'
        : !hasBd
          ? 'bd CLI not found. Install Beads to use this option.'
          : undefined,
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

  // Tracker options (loaded asynchronously)
  const [trackerOptions, setTrackerOptions] = useState<TrackerOption[]>([]);

  // Refs
  const engineRef = useRef<ChatEngine | null>(null);
  const isMountedRef = useRef(true);

  // Load tracker options on mount
  useEffect(() => {
    void getTrackerOptions(cwd).then((options) => {
      if (isMountedRef.current) {
        setTrackerOptions(options);
      }
    });
  }, [cwd]);

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

        // Build tracker options text with unavailable reasons
        const optionsText = trackerOptions
          .map((t) => {
            if (t.available) {
              return `  [${t.key}] ${t.name}`;
            } else {
              return `  [${t.key}] ${t.name} (unavailable: ${t.unavailableReason})`;
            }
          })
          .join('\n');

        // Check if Beads is available for custom message
        const beadsOption = trackerOptions.find((t) => t.key === '2');
        const hasBeads = beadsOption?.available ?? false;

        let extraHelp = '';
        if (hasBeads) {
          extraHelp = `

Tip: After selecting Beads, the epic ID will be shown. Run Ralph with:
  ralph-tui run --epic <epic-id>`;
        }

        const reviewMessage: ChatMessage = {
          role: 'assistant',
          content: `PRD saved to: ${filepath}

Would you like me to create tasks from this PRD?

${optionsText}
  [3] Done - I'll create tasks later${extraHelp}

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
   * Handle keyboard input
   */
  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string }) => {
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

      switch (key.name) {
        case 'escape':
          if (phase === 'review' && prdPath && featureName) {
            // In review phase, escape completes (PRD already saved)
            onComplete({ prdPath, featureName, selectedTracker: selectedTrackerFormat });
          } else {
            // In chat phase, show confirmation dialog
            setShowQuitConfirm(true);
          }
          break;

        case 'return':
        case 'enter':
          void sendMessage();
          break;

        case 'backspace':
          setInputValue((prev) => prev.slice(0, -1));
          break;

        default:
          // Handle regular character input and pasted content
          if (key.sequence) {
            const printableChars = key.sequence
              .split('')
              .filter((char) => char.charCodeAt(0) >= 32)
              .join('');

            if (printableChars.length > 0) {
              setInputValue((prev) => prev + printableChars);
            }
          }
          break;
      }
    },
    [showQuitConfirm, isLoading, phase, trackerOptions, handleTrackerSelect, prdPath, featureName, selectedTrackerFormat, onComplete, onCancel, sendMessage]
  );

  useKeyboard(handleKeyboard);

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
