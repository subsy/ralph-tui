/**
 * ABOUTME: JSON tracker plugin for prd.json task files.
 * The default tracker plugin that reads tasks from a local JSON file.
 * Implements full CRUD operations for file-based task tracking with the prd.json format.
 */

import { readFile, writeFile, access, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { BaseTrackerPlugin } from '../../base.js';
import type {
  TrackerPluginMeta,
  TrackerPluginFactory,
  TrackerTask,
  TrackerTaskStatus,
  TaskPriority,
  TaskFilter,
  TaskCompletionResult,
  SetupQuestion,
} from '../../types.js';

/**
 * Structure of a user story in prd.json format.
 * This matches the format specified in the PRD.
 */
interface PrdUserStory {
  /** Unique story identifier (e.g., "US-001") */
  id: string;

  /** Short title of the user story */
  title: string;

  /** Full description of the user story */
  description?: string;

  /** List of acceptance criteria */
  acceptanceCriteria?: string[];

  /** Priority level (lower = higher priority, 1-based) */
  priority?: number;

  /** Whether the story has passed/completed */
  passes: boolean;

  /** Labels or tags */
  labels?: string[];

  /** Dependencies - story IDs this story depends on */
  dependsOn?: string[];

  /** Optional notes (general purpose, shown in TUI and prompts) */
  notes?: string;

  /** Optional notes for when the story was completed (alias for notes) */
  completionNotes?: string;
}

/**
 * Root structure of a prd.json file.
 */
interface PrdJson {
  /** Name of the project or feature (also accepts 'project' as alias) */
  name: string;

  /** Project/feature description */
  description?: string;

  /** Git branch name for this work */
  branchName?: string;

  /** List of user stories */
  userStories: PrdUserStory[];

  /** Optional metadata */
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
    version?: string;
    /** Path to the source PRD markdown file (relative to prd.json or absolute) */
    sourcePrd?: string;
  };
}

/**
 * Schema validation error with helpful message for fixing AI-generated files.
 */
export class PrdJsonSchemaError extends Error {
  constructor(
    message: string,
    public readonly details: string[],
    public readonly suggestion: string
  ) {
    super(message);
    this.name = 'PrdJsonSchemaError';
    Object.setPrototypeOf(this, PrdJsonSchemaError.prototype);
  }
}

/**
 * Log a PrdJsonSchemaError to console with formatted details.
 */
function logPrdSchemaError(err: PrdJsonSchemaError): void {
  console.error(`\n${err.message}\n`);
  console.error('Issues found:');
  for (const detail of err.details) {
    console.error(`  - ${detail}`);
  }
  console.error(`\nHow to fix:\n${err.suggestion}\n`);
}

/**
 * Validate that a parsed JSON object conforms to the PrdJson schema.
 * Returns the validated PrdJson or throws PrdJsonSchemaError with helpful messages.
 */
function validatePrdJsonSchema(data: unknown, filePath: string): PrdJson {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    throw new PrdJsonSchemaError(
      `Invalid prd.json: expected an object, got ${typeof data}`,
      ['File content is not a valid JSON object'],
      'Ensure the file contains a valid JSON object with "name" and "userStories" fields.'
    );
  }

  const obj = data as Record<string, unknown>;

  // Check for common AI hallucination patterns and provide specific guidance
  if ('prd' in obj || 'tasks' in obj) {
    const wrongFields: string[] = [];
    if ('prd' in obj) wrongFields.push('"prd"');
    if ('tasks' in obj) wrongFields.push('"tasks"');

    throw new PrdJsonSchemaError(
      `Invalid prd.json schema: found ${wrongFields.join(' and ')} instead of expected structure`,
      [
        `Found fields: ${wrongFields.join(', ')}`,
        'Expected fields: "name" (or "project"), "userStories", "branchName" (optional)',
        'This appears to be an AI-generated file that did not follow the correct schema.',
      ],
      `The correct prd.json format is:
{
  "name": "Feature Name",
  "branchName": "feature/my-feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a user, I want...",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "priority": 1,
      "passes": false,
      "dependsOn": []
    }
  ]
}

To fix: Regenerate the tasks using "ralph-tui convert --to json <prd-file.md>"
or manually restructure the file to match the schema above.`
    );
  }

  // Check for name field (accept 'project' as alias)
  const name = 'name' in obj ? obj.name : obj.project;
  if (!name || typeof name !== 'string') {
    errors.push('Missing required field: "name" (string) - the project/feature name');
  }

  // Check for userStories array
  if (!('userStories' in obj)) {
    errors.push('Missing required field: "userStories" (array) - the list of tasks');
  } else if (!Array.isArray(obj.userStories)) {
    errors.push('"userStories" must be an array');
  } else {
    // Validate each user story
    const stories = obj.userStories as unknown[];
    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      if (!story || typeof story !== 'object') {
        errors.push(`userStories[${i}]: must be an object`);
        continue;
      }

      const s = story as Record<string, unknown>;

      if (!s.id || typeof s.id !== 'string') {
        errors.push(`userStories[${i}]: missing required "id" field (string)`);
      }

      if (!s.title || typeof s.title !== 'string') {
        errors.push(`userStories[${i}]: missing required "title" field (string)`);
      }

      if (typeof s.passes !== 'boolean') {
        // Check for common wrong field names
        if ('status' in s) {
          errors.push(
            `userStories[${i}]: found "status" field but expected "passes" (boolean). ` +
              'Use "passes": false for incomplete, "passes": true for complete.'
          );
        } else {
          errors.push(`userStories[${i}]: missing required "passes" field (boolean)`);
        }
      }

      // Warn about unsupported fields that indicate hallucinated schema
      const unsupportedFields = ['subtasks', 'estimated_hours', 'files', 'status'];
      const foundUnsupported = unsupportedFields.filter((f) => f in s);
      if (foundUnsupported.length > 0) {
        errors.push(
          `userStories[${i}]: contains unsupported fields: ${foundUnsupported.join(', ')}. ` +
            'Remove these fields. The prd.json schema does not support subtasks or time estimates.'
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new PrdJsonSchemaError(
      `Invalid prd.json schema in ${filePath}`,
      errors,
      'Run "ralph-tui convert --to json <prd-file.md>" to regenerate with correct schema, ' +
        'or manually fix the issues listed above.'
    );
  }

  // Normalize: accept 'project' as alias for 'name'
  return {
    name: name as string,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    branchName: typeof obj.branchName === 'string' ? obj.branchName : undefined,
    userStories: (obj.userStories as PrdUserStory[]).map((s) => ({
      ...s,
      // Ensure passes is a boolean (convert from status if needed as fallback)
      passes: typeof s.passes === 'boolean' ? s.passes : false,
    })),
    metadata: obj.metadata as PrdJson['metadata'],
  };
}

/**
 * Convert a prd.json priority (1-based) to TaskPriority (0-4).
 * Priority 1 = P1 = highest (maps to 1)
 * Unmapped priorities clamped to 0-4 range.
 */
function mapPriority(prdPriority?: number): TaskPriority {
  if (prdPriority === undefined) {
    return 2; // Default to medium priority
  }
  // PRD priorities are 1-based, TaskPriority is 0-4
  // Map: 1 -> 1, 2 -> 2, 3 -> 3, 4 -> 4, 5+ -> 4
  const clamped = Math.max(0, Math.min(4, prdPriority - 1));
  return clamped as TaskPriority;
}

/**
 * Convert passes boolean to TrackerTaskStatus.
 */
function mapStatus(passes: boolean): TrackerTaskStatus {
  return passes ? 'completed' : 'open';
}

/**
 * Convert TrackerTaskStatus back to passes boolean.
 */
function statusToPasses(status: TrackerTaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * Convert a PrdUserStory to TrackerTask.
 */
function storyToTask(story: PrdUserStory, parentName?: string): TrackerTask {
  // Use notes or completionNotes (notes takes precedence as it's the Ralph standard)
  const notes = story.notes || story.completionNotes;

  return {
    id: story.id,
    title: story.title,
    status: mapStatus(story.passes),
    priority: mapPriority(story.priority),
    description: story.description,
    labels: story.labels,
    type: 'story',
    parentId: parentName,
    dependsOn: story.dependsOn,
    metadata: {
      acceptanceCriteria: story.acceptanceCriteria,
      notes: notes,
      completionNotes: notes, // Keep for backward compat
    },
  };
}

/** Template cache to avoid re-reading on every call */
let templateCache: string | null = null;

/** Fallback template used if external file not found */
const FALLBACK_TEMPLATE = `## Your Task: {{taskId}} - {{taskTitle}}

{{#if taskDescription}}
### Description
{{taskDescription}}
{{/if}}

{{#if acceptanceCriteria}}
### Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

## Workflow
1. Implement this story following acceptance criteria
2. Run quality checks
3. Commit with: \`feat: {{taskId}} - {{taskTitle}}\`
4. Signal completion with: <promise>COMPLETE</promise>
`;

/**
 * JSON tracker plugin implementation.
 * Reads and writes tasks from a local prd.json file.
 */
export class JsonTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'json',
    name: 'JSON File Tracker',
    description: 'Track tasks in a local prd.json file',
    version: '1.0.0',
    supportsBidirectionalSync: false,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  private filePath: string = '';
  private branchName: string = '';
  private prdCache: PrdJson | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL_MS = 1000; // 1 second cache TTL
  private epicId: string = ''; // Stores prd:<name> or empty

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.path === 'string') {
      this.filePath = resolve(config.path);
    }

    if (typeof config.branchName === 'string') {
      this.branchName = config.branchName;
    }

    // Check if file exists and is readable
    if (this.filePath) {
      try {
        await access(this.filePath, constants.R_OK | constants.W_OK);
        this.ready = true;
      } catch {
        this.ready = false;
      }
    }
  }

  override async isReady(): Promise<boolean> {
    if (!this.filePath) {
      return false;
    }

    try {
      await access(this.filePath, constants.R_OK | constants.W_OK);
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  getSetupQuestions(): SetupQuestion[] {
    // Note: path to prd.json is NOT asked here - it should be specified via CLI flag (--prd)
    // when starting the TUI, not saved in config. The prd.json file may change between runs.
    return [];
  }

  override async validateSetup(
    _answers: Record<string, unknown>
  ): Promise<string | null> {
    // Note: path is validated at runtime when specified via CLI (--prd), not during setup
    // The JSON tracker just needs to exist; actual file validation happens when starting a run
    return null;
  }

  /**
   * Read and parse the prd.json file with caching.
   * Validates the schema and throws PrdJsonSchemaError if invalid.
   */
  private async readPrd(): Promise<PrdJson> {
    const now = Date.now();

    if (this.prdCache && now - this.cacheTime < this.CACHE_TTL_MS) {
      return this.prdCache;
    }

    const content = await readFile(this.filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    this.prdCache = validatePrdJsonSchema(parsed, this.filePath);
    this.cacheTime = now;

    return this.prdCache;
  }

  /**
   * Write the prd.json file and update the cache.
   */
  private async writePrd(prd: PrdJson): Promise<void> {
    // Update the metadata timestamp
    if (!prd.metadata) {
      prd.metadata = {};
    }
    prd.metadata.updatedAt = new Date().toISOString();

    // Write with pretty formatting for human readability
    const content = JSON.stringify(prd, null, 2);
    await writeFile(this.filePath, content, 'utf-8');

    // Update cache
    this.prdCache = prd;
    this.cacheTime = Date.now();
  }

  async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    if (!this.filePath) {
      return [];
    }

    try {
      const prd = await this.readPrd();
      const tasks = prd.userStories.map((story) =>
        storyToTask(story, prd.name)
      );

      return this.filterTasks(tasks, filter);
    } catch (err) {
      if (err instanceof PrdJsonSchemaError) {
        logPrdSchemaError(err);
      } else {
        console.error('Failed to read prd.json:', err);
      }
      return [];
    }
  }

  override async getTask(id: string): Promise<TrackerTask | undefined> {
    const tasks = await this.getTasks();
    return tasks.find((t) => t.id === id);
  }

  /**
   * Get the next task to work on.
   * Selects the highest priority task where passes: false.
   */
  override async getNextTask(
    filter?: TaskFilter
  ): Promise<TrackerTask | undefined> {
    // Get open tasks that are ready (no unresolved dependencies)
    const tasks = await this.getTasks({
      ...filter,
      status: 'open',
      ready: true,
    });

    if (tasks.length === 0) {
      return undefined;
    }

    // Sort by priority (lower number = higher priority)
    tasks.sort((a, b) => a.priority - b.priority);

    return tasks[0];
  }

  async completeTask(
    id: string,
    reason?: string
  ): Promise<TaskCompletionResult> {
    try {
      const prd = await this.readPrd();
      const storyIndex = prd.userStories.findIndex((s) => s.id === id);

      if (storyIndex === -1) {
        return {
          success: false,
          message: `Task ${id} not found`,
          error: 'Task not found in prd.json',
        };
      }

      // Update the story
      const story = prd.userStories[storyIndex];
      if (!story) {
        return {
          success: false,
          message: `Task ${id} not found`,
          error: 'Task not found in prd.json',
        };
      }

      story.passes = true;
      if (reason) {
        story.completionNotes = reason;
      }

      // Write back to file
      await this.writePrd(prd);

      return {
        success: true,
        message: `Task ${id} marked as complete`,
        task: storyToTask(story, prd.name),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Failed to complete task ${id}`,
        error: message,
      };
    }
  }

  async updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined> {
    try {
      const prd = await this.readPrd();
      const storyIndex = prd.userStories.findIndex((s) => s.id === id);

      if (storyIndex === -1) {
        return undefined;
      }

      const story = prd.userStories[storyIndex];
      if (!story) {
        return undefined;
      }

      // Update the passes field based on status
      story.passes = statusToPasses(status);

      // Write back to file
      await this.writePrd(prd);

      return storyToTask(story, prd.name);
    } catch (err) {
      console.error(`Failed to update task ${id} status:`, err);
      return undefined;
    }
  }

  /**
   * Check if all user stories have passes: true.
   */
  override async isComplete(filter?: TaskFilter): Promise<boolean> {
    const tasks = await this.getTasks(filter);
    return tasks.every(
      (t) => t.status === 'completed' || t.status === 'cancelled'
    );
  }

  /**
   * Get the branch name configured for this tracker.
   */
  getBranchName(): string {
    return this.branchName || this.prdCache?.branchName || '';
  }

  /**
   * Set the epic ID (file path) for this tracker.
   * For JSON tracker, this changes the active prd.json file.
   * Expected format: "prd:<name>" or a file path.
   * @param epicId The epic ID to set
   */
  setEpicId(epicId: string): void {
    this.epicId = epicId;
    // If the epicId is a file path (from metadata), update the file path
    // The epicId format from getEpics is "prd:<name>" but we also store
    // the actual file path in metadata.filePath
  }

  /**
   * Get the currently configured epic ID.
   * @returns The current epic ID, or empty string if none set
   */
  getEpicId(): string {
    return this.epicId;
  }

  /**
   * Set a new file path and reinitialize.
   * Used when switching to a different prd.json file.
   * @param path The new file path
   */
  async setFilePath(path: string): Promise<boolean> {
    const resolvedPath = resolve(path);
    try {
      await access(resolvedPath, constants.R_OK | constants.W_OK);
      this.filePath = resolvedPath;
      // Clear cache to force re-read
      this.prdCache = null;
      this.cacheTime = 0;
      this.ready = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current file path.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Get available "epics" from the JSON tracker.
   * For prd.json, each file is essentially one epic (the project itself).
   * Returns a single task representing the project/feature being tracked.
   */
  override async getEpics(): Promise<TrackerTask[]> {
    if (!this.filePath) {
      return [];
    }

    try {
      const prd = await this.readPrd();

      const epic: TrackerTask = {
        id: `prd:${prd.name}`,
        title: prd.name,
        status: 'open',
        priority: 1,
        description: prd.description,
        type: 'epic',
        metadata: {
          filePath: this.filePath,
          branchName: prd.branchName,
          storyCount: prd.userStories.length,
          completedCount: prd.userStories.filter((s) => s.passes).length,
        },
      };

      return [epic];
    } catch (err) {
      if (err instanceof PrdJsonSchemaError) {
        logPrdSchemaError(err);
      } else {
        console.error('Failed to read prd.json for getEpics:', err);
      }
      return [];
    }
  }

  /**
   * Get the prompt template for the JSON tracker.
   * Reads from external template.hbs file with caching.
   * Falls back to embedded template if file not found.
   */
  override getTemplate(): string {
    if (templateCache !== null) {
      return templateCache;
    }

    const templatePath = join(__dirname, 'template.hbs');
    try {
      templateCache = readFileSync(templatePath, 'utf-8');
      return templateCache;
    } catch (err) {
      // Log warning and fall back to embedded template
      console.warn(
        `Warning: Could not read template from ${templatePath}, using fallback template.`,
        err instanceof Error ? err.message : err
      );
      templateCache = FALLBACK_TEMPLATE;
      return templateCache;
    }
  }

  /**
   * Get the source PRD markdown content.
   * Reads from metadata.sourcePrd path if specified.
   * @returns The PRD markdown content, or empty string if not available
   */
  async getSourcePrdContent(): Promise<string> {
    if (!this.filePath) {
      return '';
    }

    try {
      const prd = await this.readPrd();
      const sourcePrdPath = prd.metadata?.sourcePrd;

      if (!sourcePrdPath) {
        return '';
      }

      // Resolve path relative to prd.json location
      const prdDir = resolve(this.filePath, '..');
      const fullPath = sourcePrdPath.startsWith('/')
        ? sourcePrdPath
        : resolve(prdDir, sourcePrdPath);

      const content = await readFile(fullPath, 'utf-8');
      return content;
    } catch {
      // Source PRD not found or not readable - this is fine, it's optional
      return '';
    }
  }

  /**
   * Get PRD context for template rendering.
   * Returns name, description, source markdown content, and completion stats.
   */
  async getPrdContext(): Promise<{
    name: string;
    description?: string;
    content: string;
    completedCount: number;
    totalCount: number;
  } | null> {
    if (!this.filePath) {
      return null;
    }

    try {
      const prd = await this.readPrd();
      const content = await this.getSourcePrdContent();

      return {
        name: prd.name,
        description: prd.description,
        content,
        completedCount: prd.userStories.filter((s) => s.passes).length,
        totalCount: prd.userStories.length,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Factory function for the JSON tracker plugin.
 */
const createJsonTracker: TrackerPluginFactory = () => new JsonTrackerPlugin();

export default createJsonTracker;
export { validatePrdJsonSchema };
