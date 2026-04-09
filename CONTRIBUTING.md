# Contributing to Ralph TUI

Thank you for your interest in contributing to Ralph TUI! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- **Bun** >= 1.0.0 (runtime and package manager)
- **Git** for version control

### Development Setup

```bash
# Clone the repository
git clone https://github.com/subsy/ralph-tui.git
cd ralph-tui

# Install dependencies
bun install

# Run the TUI in development mode
bun run ./src/cli.tsx

# Or use the dev script
bun run dev
```

### Running Quality Checks

```bash
# Type checking
bun run typecheck

# Linting
bun run lint

# Fix lint issues automatically
bun run lint:fix

# Build the project
bun run build
```

## Code Style

### General Principles

1. **Simplicity over cleverness** - Write clear, maintainable code
2. **Minimal changes** - Make the smallest reasonable change to achieve the goal
3. **No unrelated changes** - Don't refactor or "improve" code outside your scope
4. **Preserve comments** - Only remove comments if they're provably false

### TypeScript Conventions

- **Strict mode** is enabled - all code must be fully typed
- Use `ReactNode` return type for component functions (not `JSX.Element`)
- Use ES modules (`import`/`export`) - the package is `"type": "module"`

### File Headers

Every source file must start with an ABOUTME comment explaining the file's purpose:

```typescript
/**
 * ABOUTME: Brief description of what this file does.
 * Additional context if needed.
 */
```

### Directory Structure

```
src/
├── cli.tsx           # CLI entry point
├── commands/         # CLI command implementations
├── config/           # Configuration system
├── engine/           # Execution engine
├── interruption/     # Signal handling
├── logs/             # Iteration logging
├── plugins/
│   ├── agents/       # Agent plugins (claude, opencode, gemini, codex, kiro)
│   └── trackers/     # Tracker plugins (beads, json)
├── session/          # Session management
├── setup/            # Interactive setup wizard
├── templates/        # Prompt templates
└── tui/
    └── components/   # OpenTUI React components
```

### Plugin Architecture

- **Tracker plugins** go in `src/plugins/trackers/builtin/`
- **Agent plugins** go in `src/plugins/agents/builtin/`
- Use the factory pattern with singleton registries
- Extend `BaseTrackerPlugin` or `BaseAgentPlugin` for common functionality

### TUI Components

- Components go in `src/tui/components/`
- Use OpenTUI's React bindings (`@opentui/react`)
- Export components from `src/tui/components/index.ts`

## Making Changes

### Workflow

1. **Create a branch** from `main`
2. **Make your changes** following the code style guidelines
3. **Run quality checks**: `bun run typecheck && bun run lint`
4. **Test your changes** manually with `bun run ./src/cli.tsx`
5. **Commit** with a descriptive message
6. **Open a pull request**

### Commit Messages

Use conventional commit format:

```
type: brief description

Longer explanation if needed.
```

Types:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

Examples:
```
feat: add support for custom prompt templates
fix: handle empty task lists gracefully
docs: update README with configuration examples
```

### Pull Request Guidelines

1. **One feature per PR** - Keep changes focused
2. **Update documentation** if adding features - any new or changed functionality must include documentation updates
3. **Ensure CI passes** - typecheck, lint, and tests must succeed
4. **Meet test coverage requirements** - PRs must have >50% test coverage on new and changed lines (enforced by Codecov)
5. **Describe your changes** in the PR description

## Contribution Requirements Checklist

All contributions must meet these requirements before merging:

### Code Quality
- [ ] **Test coverage >50%** - New/changed code must have at least 50% unit test coverage (enforced by Codecov)
- [ ] **Typecheck passes** - Run `bun run typecheck` with no errors
- [ ] **Lint passes** - Run `bun run lint` with no errors
- [ ] **Build succeeds** - Run `bun run build` with no errors

### Documentation
- [ ] **Docs for user-facing changes** - Any new or changed user-facing behavior must include documentation updates
- [ ] **ABOUTME header** - All new source files must have an ABOUTME comment header

---

## Adding New Features

### Adding a New Tracker Plugin

Complete this checklist when adding a new tracker plugin:

#### Source Code
- [ ] Create plugin directory: `src/plugins/trackers/builtin/<tracker-name>/`
- [ ] Create main plugin file: `src/plugins/trackers/builtin/<tracker-name>/index.ts`
- [ ] Include ABOUTME header comment in all source files
- [ ] Extend `BaseTrackerPlugin` or implement `TrackerPlugin` interface
- [ ] Implement required interface methods:
  - [ ] `meta` - Plugin metadata (id, name, description, version, author)
  - [ ] `initialize(config)` - Configuration initialization
  - [ ] `detect()` - Check if tracker CLI/tool is available
  - [ ] `getTasks()` - Fetch tasks from the tracker
  - [ ] `getTask(id)` - Fetch a single task by ID
  - [ ] `updateTask(id, updates)` - Update task status/fields
  - [ ] `getSetupQuestions()` - Setup wizard questions
  - [ ] `validateSetup(answers)` - Validate setup answers
- [ ] Export factory function: `const createMyTracker: TrackerPluginFactory = () => new MyTrackerPlugin();`

#### Registration
- [ ] Import factory in `src/plugins/trackers/builtin/index.ts`
- [ ] Add to `builtinTrackers` object
- [ ] Add to `registerBuiltinTrackers()` function
- [ ] Export the factory function

#### Tests
- [ ] Create test file: `src/plugins/trackers/builtin/<tracker-name>.test.ts` or `tests/plugins/trackers/<tracker-name>.test.ts`
- [ ] Test plugin metadata
- [ ] Test `initialize()` with various configs
- [ ] Test `detect()` success and failure cases
- [ ] Test `getTasks()` parsing
- [ ] Test `getTask()` by ID
- [ ] Test `updateTask()` operations
- [ ] Test `getSetupQuestions()` returns valid questions
- [ ] Test `validateSetup()` with valid/invalid inputs
- [ ] Test error handling for CLI failures
- [ ] Achieve >50% coverage on new code

#### Documentation
- [ ] Create docs page: `website/content/docs/plugins/trackers/<tracker-name>.mdx`
- [ ] Include sections: Overview, Prerequisites, Basic Usage, Configuration, Options Reference, How It Works, Troubleshooting
- [ ] Add to navigation: `website/lib/navigation.ts` (in Trackers section)

---

### Adding a New Agent Plugin

Complete this checklist when adding a new agent plugin:

#### Source Code
- [ ] Create plugin file: `src/plugins/agents/builtin/<agent-name>.ts`
- [ ] Include ABOUTME header comment
- [ ] Extend `BaseAgentPlugin` or implement `AgentPlugin` interface
- [ ] Define `meta` with required fields:
  - [ ] `id` - Unique plugin identifier (e.g., `'cursor'`)
  - [ ] `name` - Display name (e.g., `'Cursor Agent'`)
  - [ ] `description` - Brief description
  - [ ] `version` - Plugin version
  - [ ] `author` - Author/organization name
  - [ ] `defaultCommand` - CLI command name (e.g., `'agent'`)
  - [ ] `supportsStreaming` - Whether agent supports streaming output
  - [ ] `supportsInterrupt` - Whether agent can be interrupted
  - [ ] `supportsFileContext` - Whether agent accepts file context
  - [ ] `supportsSubagentTracing` - Whether agent emits structured JSONL
  - [ ] `structuredOutputFormat` - Output format (e.g., `'jsonl'`)
  - [ ] `skillsPaths` - Personal and repo skill paths (optional)
- [ ] Implement required methods:
  - [ ] `initialize(config)` - Configuration initialization
  - [ ] `detect()` - Check if agent CLI is available and get version
  - [ ] `execute(prompt, files?, options?)` - Execute agent with prompt
  - [ ] `getSandboxRequirements()` - Auth/binary paths needed
  - [ ] `getSetupQuestions()` - Setup wizard questions
  - [ ] `validateSetup(answers)` - Validate setup answers
  - [ ] `validateModel(model)` - Validate model name (if applicable)
- [ ] Implement protected methods:
  - [ ] `buildArgs(prompt, files?, options?)` - Build CLI arguments
  - [ ] `getStdinInput(prompt, files?, options?)` - Provide stdin input (if needed)
  - [ ] `getPreflightSuggestion()` - Troubleshooting suggestions
- [ ] If agent outputs JSONL, implement parsing functions:
  - [ ] `parse<Agent>JsonLine(jsonLine)` - Parse single JSONL line to `AgentDisplayEvent[]`
  - [ ] `parse<Agent>OutputToEvents(data)` - Parse full output to events
- [ ] Use shared utilities from `src/plugins/agents/utils.ts` (e.g., `extractErrorMessage`)
- [ ] Export factory function: `const create<Agent>Agent: AgentPluginFactory = () => new <Agent>AgentPlugin();`

#### Registration
- [ ] Import factory in `src/plugins/agents/builtin/index.ts`
- [ ] Add to `registerBuiltinAgents()` function
- [ ] Export the factory function
- [ ] Export the plugin class
- [ ] Add to `AGENT_ID_MAP` in `src/setup/skill-installer.ts`

#### Tests
- [ ] Create test file: `src/plugins/agents/builtin/<agent-name>.test.ts`
- [ ] Test plugin metadata (id, name, defaultCommand, supports* flags)
- [ ] Test `initialize()` with various configs (model, timeout, agent-specific options)
- [ ] Test `getSetupQuestions()` returns all expected questions
- [ ] Test `validateSetup()` with valid/invalid inputs
- [ ] Test `validateModel()` with various model names
- [ ] Test `getSandboxRequirements()` returns expected paths
- [ ] Test `buildArgs()` produces correct CLI arguments
- [ ] Test `getStdinInput()` returns prompt correctly
- [ ] If JSONL parsing:
  - [ ] Test parsing valid JSONL events (text, tool_use, tool_result, error)
  - [ ] Test handling of empty/invalid input
  - [ ] Test handling of mixed valid/invalid lines
  - [ ] Test edge cases (missing fields, malformed JSON)
- [ ] Achieve >50% coverage on new code

#### Documentation
- [ ] Create docs page: `website/content/docs/plugins/agents/<agent-name>.mdx`
- [ ] Include sections:
  - [ ] Overview with feature highlights
  - [ ] Prerequisites (installation instructions)
  - [ ] Basic Usage (with `<Steps>` component)
  - [ ] Configuration (shorthand and full config examples)
  - [ ] Options Reference (table with all options)
  - [ ] Agent-specific features (modes, sandbox, etc.)
  - [ ] Subagent Tracing (if supported)
  - [ ] How It Works (CLI arguments built)
  - [ ] Troubleshooting (common issues and fixes)
  - [ ] Next Steps (links to related docs)
- [ ] Add to navigation: `website/lib/navigation.ts` (in Agents section)
- [ ] Use `label: 'New'` in navigation for new agents

---

### Adding a New CLI Command

1. Create a command file in `src/commands/`
2. Export from `src/commands/index.ts`
3. Add handling in `src/cli.tsx`
4. Update the help text in `showHelp()`
5. Create tests in `tests/commands/` or `src/commands/*.test.ts`
6. Update documentation if user-facing

## Testing

Ralph TUI uses [Bun's built-in test runner](https://bun.sh/docs/cli/test) for unit and integration tests.

### Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode (re-runs on file changes)
bun test --watch

# Run tests with coverage report
bun test --coverage

# Run specific test file
bun test tests/plugins/claude-agent.test.ts

# Run tests matching a pattern
bun test --grep "ExecutionEngine"
```

### Test File Naming Conventions

- Test files are placed in the `tests/` directory
- Test files must end with `.test.ts`
- Mirror the `src/` structure: `src/plugins/agents/` → `tests/plugins/`
- Name test files after the module they test: `claude.ts` → `claude-agent.test.ts`

### Test Directory Structure

```
tests/
├── commands/           # CLI command tests
├── engine/             # Execution engine tests
├── factories/          # Reusable test data factories
│   ├── agent-config.ts
│   ├── prd-data.ts
│   ├── session-state.ts
│   ├── tracker-config.ts
│   └── tracker-task.ts
├── fixtures/           # Static test data (JSON, configs)
├── mocks/              # Mock implementations
│   ├── agent-responses.ts
│   ├── child-process.ts
│   └── file-system.ts
├── plugins/            # Plugin tests (agents, trackers)
├── tui/                # TUI component tests
├── utils/              # Utility function tests
└── index.ts            # Test utilities exports
```

### Writing New Tests

Every test file must start with an ABOUTME comment:

```typescript
/**
 * ABOUTME: Tests for the ExecutionEngine.
 * Tests state machine transitions, iteration logic, and error handling.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
```

#### Basic Test Structure

```typescript
describe('ModuleName', () => {
  let instance: MyClass;

  beforeEach(() => {
    instance = new MyClass();
  });

  afterEach(async () => {
    await instance.dispose();
  });

  describe('methodName', () => {
    test('should do expected behavior', () => {
      const result = instance.methodName();
      expect(result).toBe(expectedValue);
    });

    test('should handle edge case', () => {
      expect(() => instance.methodName(null)).toThrow();
    });
  });
});
```

### Using Factories

Factories provide consistent test data with sensible defaults. Import from `tests/factories/`:

```typescript
import { createTrackerTask, createTrackerTasks } from '../factories/tracker-task.js';
import { createSessionState } from '../factories/session-state.js';

test('should process task', () => {
  // Create with defaults
  const task = createTrackerTask();

  // Create with overrides
  const customTask = createTrackerTask({
    id: 'custom-id',
    status: 'in_progress',
    priority: 1,
  });

  // Create multiple tasks
  const tasks = createTrackerTasks(5, { status: 'open' });
});
```

### Using Mocks

Mocks simulate external dependencies. Import from `tests/mocks/`:

```typescript
import { createMockAgentPlugin, createSuccessfulExecution } from '../mocks/agent-responses.js';
import { createMockChildProcess } from '../mocks/child-process.js';
import { createMockFileSystem } from '../mocks/file-system.js';

test('should execute agent', async () => {
  const mockAgent = createMockAgentPlugin();
  const mockExecution = createSuccessfulExecution('Task completed');
  
  // Use bun:test mock for module mocking
  mock.module('../../src/plugins/agents/registry.js', () => ({
    getAgentRegistry: () => ({
      getInstance: () => Promise.resolve(mockAgent),
    }),
  }));
});
```

#### Spying on Methods

```typescript
import { spyOn } from 'bun:test';

test('should call dependency', () => {
  const spy = spyOn(dependency, 'method');
  
  instance.doSomething();
  
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith('expected-arg');
});
```

### Coverage Requirements

- **PRs must have >50% test coverage on new/changed lines** (enforced by Codecov patch check)
- Aim for **80%+ line coverage** on new code when possible
- Critical paths (engine, plugins) should have higher coverage
- Run `bun test --coverage` to check coverage locally
- Coverage reports are generated in CI and uploaded to Codecov

> **Note:** If your PR adds new functionality, you must include tests that cover at least 50% of the new/changed lines. PRs that fail the Codecov patch check will not be merged.

### Manual Testing

For integration testing with actual AI agents:

```bash
# Test the TUI
bun run ./src/cli.tsx

# Test specific commands
bun run ./src/cli.tsx run --help
bun run ./src/cli.tsx plugins agents
bun run ./src/cli.tsx config show
```

When testing changes manually:
- Test with different trackers (beads, json)
- Test with different agents (claude, opencode)
- Test TUI keyboard navigation
- Test headless mode
- Test error conditions

## Reporting Issues

When reporting issues, please include:

1. **Ralph TUI version** (`ralph-tui --version` or check package.json)
2. **Bun version** (`bun --version`)
3. **Operating system**
4. **Steps to reproduce**
5. **Expected behavior**
6. **Actual behavior**
7. **Relevant logs** (from `.ralph-tui/iterations/`)

## Questions?

If you have questions about contributing, feel free to:
- Open a GitHub issue with the `question` label
- Check existing issues for similar questions

Thank you for contributing to Ralph TUI!
