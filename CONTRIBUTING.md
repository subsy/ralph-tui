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
│   ├── agents/       # Agent plugins (claude, opencode)
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
2. **Update documentation** if adding features
3. **Ensure CI passes** - typecheck and lint must succeed
4. **Describe your changes** in the PR description

## Adding New Features

### Adding a New Tracker Plugin

1. Create a new file in `src/plugins/trackers/builtin/`
2. Extend `BaseTrackerPlugin` or implement `TrackerPlugin` interface
3. Register in `src/plugins/trackers/builtin/index.ts`
4. Add a template in `src/templates/builtin.ts` if needed

### Adding a New Agent Plugin

1. Create a new file in `src/plugins/agents/builtin/`
2. Extend `BaseAgentPlugin` or implement `AgentPlugin` interface
3. Register in `src/plugins/agents/builtin/index.ts`

### Adding a New CLI Command

1. Create a command file in `src/commands/`
2. Export from `src/commands/index.ts`
3. Add handling in `src/cli.tsx`
4. Update the help text in `showHelp()`

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
import {
  createTrackerTask,
  createTrackerTasks,
} from '../factories/tracker-task.js';
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
import {
  createMockAgentPlugin,
  createSuccessfulExecution,
} from '../mocks/agent-responses.js';
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

- Aim for **80%+ line coverage** on new code
- Critical paths (engine, plugins) should have higher coverage
- Run `bun test --coverage` to check coverage locally
- Coverage reports are generated in CI and uploaded to Codecov

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
