/**
 * ABOUTME: PRD Chat application component for the Ralph TUI.
 * Provides an interactive chat interface for generating PRDs using an AI agent.
 * After PRD generation, shows a split view with PRD preview and tracker options.
 * Supports image attachments that are appended to prompts.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { KeyEvent, PasteEvent } from '@opentui/core';
import { platform } from 'node:os';
import { readFromClipboard, writeToClipboard } from '../../utils/index.js';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ChatView } from './ChatView.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import {
  ChatEngine,
  createPrdChatEngine,
  createTaskChatEngine,
  slugify,
} from '../../chat/engine.js';
import type { ChatMessage, ChatEvent } from '../../chat/types.js';
import type { AgentPlugin } from '../../plugins/agents/types.js';
import { stripAnsiCodes, type FormattedSegment } from '../../plugins/agents/output-formatting.js';
import { parsePrdMarkdown } from '../../prd/parser.js';
import { colors } from '../theme.js';
import {
  useImageAttachmentWithFeedback,
  useToast,
  usePasteHint,
} from '../hooks/index.js';
import type { ImageConfig } from '../../config/types.js';
import { DEFAULT_IMAGE_CONFIG } from '../../config/types.js';
import {
  isSlashCommand,
  executeSlashCommand,
} from '../utils/slash-commands.js';
import {
  detectBase64Image,
  looksLikeImagePath,
} from '../utils/image-detection.js';

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
  onComplete: (result: PrdCreationResult) => Promise<void>;

  /** Callback when user cancels */
  onCancel: () => Promise<void>;

  /** Callback when an error occurs */
  onError?: (error: string) => void;

  /** Image attachment configuration */
  imageConfig?: ImageConfig;
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
      skillPrompt:
        'Convert this PRD to beads using the ralph-tui-create-beads skill.',
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
 * Classification result for pasted text.
 */
export interface PasteClassification {
  /** Whether the paste should be intercepted and handled manually. */
  intercept: boolean;
  /** Whether fallback text insertion should be suppressed to avoid gibberish. */
  suppressFallbackInsert: boolean;
}

/**
 * Classify pasted text for image-handling flow.
 * Intercepts image-like payloads while allowing plain text to use native paste behavior.
 */
export function classifyPastePayload(text: string): PasteClassification {
  const trimmed = text.trim();
  if (!trimmed) {
    return { intercept: false, suppressFallbackInsert: false };
  }

  if (looksLikeImagePath(trimmed)) {
    return { intercept: true, suppressFallbackInsert: false };
  }

  if (detectBase64Image(trimmed).isBase64Image) {
    return { intercept: true, suppressFallbackInsert: false };
  }

  // Treat high-control-character payloads as binary-ish and avoid inserting raw noise.
  let controlChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl = (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    if (isControl) {
      controlChars++;
    }
  }
  if (controlChars >= 4 && controlChars / Math.max(text.length, 1) > 0.05) {
    return { intercept: true, suppressFallbackInsert: true };
  }

  return { intercept: false, suppressFallbackInsert: false };
}

/**
 * PRD Preview component for the right panel
 */
function PrdPreview({
  content,
  path,
}: {
  content: string;
  path: string;
}): ReactNode {
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
  imageConfig,
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
  const [streamingSegments, setStreamingSegments] = useState<
    FormattedSegment[]
  >([]);
  const [error, setError] = useState<string | undefined>();

  // Quit confirmation dialog state
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // Track which tracker format was selected for tasks
  const [selectedTrackerFormat, setSelectedTrackerFormat] = useState<
    'json' | 'beads' | null
  >(null);

  // Refs
  const engineRef = useRef<ChatEngine | null>(null);
  const taskEngineRef = useRef<ChatEngine | null>(null);
  const isMountedRef = useRef(true);
  // Ref for inserting text into the chat input (used for image markers)
  const insertTextRef = useRef<((text: string) => void) | null>(null);
  // Tracks last native paste event timestamp for keyboard-shortcut fallback detection.
  const lastPasteEventAtRef = useRef(0);

  // Get tracker options
  const trackerOptions = getTrackerOptions(cwd);

  // Image attachment and toast hooks
  const toast = useToast();
  const imagesEnabled = imageConfig?.enabled ?? DEFAULT_IMAGE_CONFIG.enabled;
  const maxImagesPerMessage =
    imageConfig?.max_images_per_message ??
    DEFAULT_IMAGE_CONFIG.max_images_per_message;
  const showPasteHints =
    imageConfig?.show_paste_hints ?? DEFAULT_IMAGE_CONFIG.show_paste_hints;
  const {
    attachedImages,
    attachImage,
    attachFromClipboard,
    removeImageByNumber,
    clearImages,
    getPromptSuffix,
  } = useImageAttachmentWithFeedback(toast, {
    maxImagesPerMessage: imagesEnabled ? maxImagesPerMessage : 0,
  });

  // Paste hint hook for first-time users
  const { onTextPaste } = usePasteHint(toast, {
    enabled: showPasteHints && imagesEnabled,
  });

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
      if (!taskEngineRef.current || !prdPath || !prdContent || isLoading)
        return;

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
              content:
                'Tasks created! Press [3] to finish or select another format.',
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
      const rawMessage = value?.trim() ?? inputValue.trim();
      if (!rawMessage || isLoading) {
        return;
      }

      // Use the message as-is (no zero-width markers to clean)
      const userMessage = rawMessage;

      // Check for slash commands first
      if (isSlashCommand(userMessage)) {
        const result = await executeSlashCommand(userMessage, {
          // Pass true to delete files - slash commands are user-initiated cancellations
          clearPendingImages: () => clearImages(true),
          pendingImageCount: attachedImages.length,
        });

        if (result.handled) {
          setInputValue('');
          // Show feedback via toast
          if (result.success) {
            toast.showSuccess(result.message ?? 'Command executed');
          } else {
            toast.showError(result.message ?? 'Command failed');
          }
          return;
        }
      }

      // Regular message - requires engine
      if (!engineRef.current) {
        return;
      }

      setInputValue('');
      setIsLoading(true);
      setStreamingChunk('');
      setStreamingSegments([]);
      setLoadingStatus('Sending to agent...');
      setError(undefined);

      // Get image suffix before clearing (will be empty string if no images)
      const imageSuffix = getPromptSuffix();

      // Clear attached images after capturing suffix
      // Pass false (default) to keep files - the agent needs to read them
      if (attachedImages.length > 0) {
        clearImages(false);
      }

      // The user message shown in the chat
      // The [Image N] markers in the message provide visual indication of attachments
      const userMsg: ChatMessage = {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // The prompt sent to the agent includes the image paths
      const promptToSend = userMessage + imageSuffix;

      try {
        const result = await engineRef.current.sendMessage(promptToSend, {
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
    [
      inputValue,
      isLoading,
      getPromptSuffix,
      attachedImages,
      clearImages,
      toast,
    ],
  );

  /**
   * Clipboard fallback for terminals that don't emit OpenTUI paste events.
   * Triggered by paste keyboard shortcuts when no paste event follows shortly after.
   */
  const performClipboardPasteFallback = useCallback(async () => {
    if (isLoading) {
      return;
    }

    if (imagesEnabled) {
      const imageResult = await attachFromClipboard();
      if (imageResult.success && imageResult.inlineMarker) {
        if (insertTextRef.current) {
          insertTextRef.current(imageResult.inlineMarker + ' ');
        }
        return;
      }
    }

    const textResult = await readFromClipboard();
    if (!textResult.success || !textResult.text || !insertTextRef.current) {
      return;
    }

    insertTextRef.current(textResult.text);
    onTextPaste();
  }, [isLoading, imagesEnabled, attachFromClipboard, onTextPaste]);

  const reportCallbackError = useCallback(
    (context: string, err: unknown) => {
      const errorMessage =
        `${context}: ` + (err instanceof Error ? err.message : String(err));
      setError(errorMessage);
      onError?.(errorMessage);
    },
    [onError],
  );

  const runOnComplete = useCallback(
    async (result: PrdCreationResult) => {
      try {
        await onComplete(result);
      } catch (err) {
        reportCallbackError('Failed to complete PRD workflow', err);
      }
    },
    [onComplete, reportCallbackError],
  );

  const runOnCancel = useCallback(async () => {
    try {
      await onCancel();
    } catch (err) {
      reportCallbackError('Failed to cancel PRD workflow', err);
    }
  }, [onCancel, reportCallbackError]);

  /**
   * Handle keyboard input (only for non-input keys like Escape and review phase shortcuts)
   * Text editing is handled by the native OpenTUI input component
   */
  const handleKeyboard = useCallback(
    (key: KeyEvent) => {
      const keyName = key.name.toLowerCase();

      // Handle clipboard copy:
      // - macOS: Cmd+C (meta key)
      // - Linux: Ctrl+Shift+C or Alt+C
      // - Windows: Ctrl+C
      // Note: We check this early so copy works even when dialogs are open
      const isMac = platform() === 'darwin';
      const isWindows = platform() === 'win32';
      const selection = renderer.getSelection();
      const isCopyShortcut = isMac
        ? key.meta && keyName === 'c'
        : isWindows
          ? key.ctrl && keyName === 'c'
          : (key.ctrl && key.shift && keyName === 'c') ||
            (key.option && keyName === 'c');

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
          void runOnCancel();
        } else if (
          key.name === 'n' ||
          key.name === 'escape' ||
          key.sequence === 'n' ||
          key.sequence === 'N'
        ) {
          setShowQuitConfirm(false);
        }
        return;
      }

      // Don't process keys while loading
      if (isLoading) {
        return;
      }

      // Handle paste fallback shortcuts for terminals that do not emit paste events.
      // If a native paste event arrives right after this shortcut, fallback is skipped.
      const isPasteShortcut = isMac
        ? key.meta && keyName === 'v'
        : isWindows
          ? (key.ctrl && keyName === 'v') ||
            (key.shift && keyName === 'insert')
          : (key.ctrl && keyName === 'v') ||
            (key.ctrl && key.shift && keyName === 'v') ||
            (key.shift && keyName === 'insert');
      if (isPasteShortcut) {
        key.preventDefault?.();
        const requestTime = Date.now();
        setTimeout(() => {
          if (lastPasteEventAtRef.current >= requestTime) {
            return;
          }
          void performClipboardPasteFallback();
        }, 80);
        return;
      }

      // In review phase, handle number keys for tracker selection
      if (phase === 'review' && key.sequence) {
        const keyNum = key.sequence;
        if (keyNum === '1' || keyNum === '2') {
          const option = trackerOptions.find(
            (t) => t.key === keyNum && t.available,
          );
          if (option) {
            void handleTrackerSelect(option);
            return;
          }
        }
        if (keyNum === '3') {
          // Done - complete and exit
          if (prdPath && featureName) {
            void runOnComplete({
              prdPath,
              featureName,
              selectedTracker: selectedTrackerFormat,
            });
          }
          return;
        }
      }

      // Handle escape key
      if (key.name === 'escape') {
        if (phase === 'review' && prdPath && featureName) {
          // In review phase, escape completes (PRD already saved)
          void runOnComplete({
            prdPath,
            featureName,
            selectedTracker: selectedTrackerFormat,
          });
        } else {
          // In chat phase, show confirmation dialog
          setShowQuitConfirm(true);
        }
      }
    },
    [
      showQuitConfirm,
      isLoading,
      phase,
      trackerOptions,
      performClipboardPasteFallback,
      runOnComplete,
      runOnCancel,
      handleTrackerSelect,
      prdPath,
      featureName,
      selectedTrackerFormat,
      renderer,
    ],
  );

  useKeyboard(handleKeyboard);

  /**
   * Handle paste events - try to detect and attach images
   *
   * The paste handler uses a two-phase approach:
   * 1. First, try to read actual image data from the system clipboard (via pngpaste)
   *    This handles screenshot tools like Shottr that put images in the clipboard
   * 2. If no clipboard image, try to parse the pasted text as an image path
   *    This handles pasting file paths to images
   *
   * Plain text uses native textarea paste behavior.
   * We only prevent default for image-like or binary payloads that need
   * manual handling to avoid inserting opaque escape/control sequences.
   */
  const handlePaste = useCallback(
    async (text: string, event: PasteEvent) => {
      // Don't process paste if images are disabled - let default paste happen
      if (!imagesEnabled) {
        return;
      }

      lastPasteEventAtRef.current = Date.now();

      const pasteType = classifyPastePayload(text);
      const hasText = text.trim().length > 0;
      let feedbackShown = false;

      // Only intercept image-like payloads. For normal text, keep native paste behavior.
      if (pasteType.intercept) {
        event.preventDefault();
      }

      // Check clipboard image when payload is image-like OR text is unavailable.
      // Some terminals emit empty paste text for clipboard operations.
      if (pasteType.intercept || !hasText) {
        const clipboardResult = await attachFromClipboard();
        feedbackShown = clipboardResult.feedbackShown;

        if (clipboardResult.success && clipboardResult.inlineMarker) {
          // Insert the plain [Image N] marker at cursor
          if (insertTextRef.current) {
            insertTextRef.current(clipboardResult.inlineMarker + ' ');
          }
          return;
        }
      }

      // For non-intercepted text, allow native paste and avoid image-path detection work.
      if (!pasteType.intercept) {
        if (!feedbackShown && hasText) {
          onTextPaste();
        }
        return;
      }

      // Phase 2: If no clipboard image, try to parse pasted text as image path
      // This handles cases where user pastes a file path to an image
      if (hasText) {
        const textResult = await attachImage(text);
        if (textResult.success && textResult.inlineMarker) {
          // Insert the plain [Image N] marker at cursor
          if (insertTextRef.current) {
            insertTextRef.current(textResult.inlineMarker + ' ');
          }
          return;
        }
      }

      if (pasteType.intercept) {
        // Not an image - optionally fall back to manual text insertion.
        if (!pasteType.suppressFallbackInsert && text && insertTextRef.current) {
          insertTextRef.current(text);
        }

        // For binary-ish payloads, avoid inserting opaque control-sequence noise.
        if (pasteType.suppressFallbackInsert && !feedbackShown) {
          toast.showError('Unable to parse pasted image data');
        }

        if (!feedbackShown && hasText) {
          onTextPaste();
        }
        return;
      }
    },
    [imagesEnabled, attachFromClipboard, attachImage, onTextPaste, toast],
  );

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
            onPaste={handlePaste}
            onImageMarkerDeleted={removeImageByNumber}
            toasts={toast.toasts}
            insertTextRef={insertTextRef}
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
        onPaste={handlePaste}
        onImageMarkerDeleted={removeImageByNumber}
        toasts={toast.toasts}
        insertTextRef={insertTextRef}
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
