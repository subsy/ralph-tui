# Linear Tracker Plugin

Use Linear as a task tracker for Ralph TUI. Tasks are managed as child issues under a parent (epic) issue in Linear.

## Setup

### 1. Get a Linear API Key

Create a personal API key at: Settings > API > Personal API Keys

### 2. Configure Authentication

Set the `LINEAR_API_KEY` environment variable:

```bash
export LINEAR_API_KEY="lin_api_..."
```

Or add it to your project config (`.ralph-tui/config.toml`):

```toml
[[trackers]]
name = "linear"
plugin = "linear"

  [trackers.options]
  apiKey = "lin_api_..."
```

Auth precedence: explicit config `apiKey` overrides `LINEAR_API_KEY` env var.

## Converting a PRD to Linear Issues

Use `convert --to linear` to import a PRD into Linear as a parent issue with child issues:

```bash
# Basic: create parent + children in the ENG team
ralph-tui convert --to linear --team ENG ./prd.md

# Use an existing parent issue
ralph-tui convert --to linear --team ENG --parent ENG-123 ./prd.md

# With project and labels
ralph-tui convert --to linear --team ENG --project "Q1 Sprint" --labels "backend,mvp" ./prd.md
```

### Options

| Flag | Required | Description |
|------|----------|-------------|
| `--team <key>` | Yes | Linear team key (e.g., `ENG`) |
| `--parent <issue>` | No | Existing parent issue key or UUID. Auto-creates if omitted. |
| `--project <name>` | No | Linear project name or UUID |
| `--labels <list>` | No | Comma-separated labels to apply |

Each PRD user story becomes a child issue with:
- Title: `<story-id>: <story-title>`
- Structured markdown body with Ralph metadata, description, and acceptance criteria
- Native Linear blocking relations from PRD `dependsOn` fields

## Running Tasks from Linear

Run Ralph against child issues of a parent (epic) issue:

```bash
ralph-tui run --tracker linear --epic ENG-123
```

The `--epic` flag is required for the Linear tracker in MVP. It accepts either an issue key (`ENG-123`) or a UUID.

### How It Works

1. Ralph fetches all child issues under the specified parent
2. Tasks are ordered by `Ralph Priority` metadata embedded in issue bodies (ascending, lower = higher priority)
3. In-progress tasks are preferred over open tasks
4. Dependency-blocked tasks are excluded from selection
5. On task completion, Ralph moves the issue to the "completed" workflow state and posts a comment

### API Usage

Ralph fetches child issues together with their state, labels, assignee, and blocking relations in a single GraphQL query (one request per 50 children). Issues with more than 20 labels or 25 inverse relations require additional paginated requests so label filters and dependencies remain complete. This reduces API usage compared with resolving each issue's fields separately; Linear's request and complexity limits still apply.

Concurrent child reads share one in-flight fetch. Successful results are cached for 5 seconds after the fetch completes; failed requests are not cached. The cache is cleared whenever Ralph updates or completes an issue or changes the epic. Reads invalidated while in flight retry against the fresh cache instead of returning pre-write data. Edits made directly in Linear appear on the next fetch after the cache expires.

### Status Mapping

| Linear State Type | Ralph Status |
|-------------------|-------------|
| `triage`, `backlog`, `unstarted` | `open` |
| `started` | `in_progress` |
| `completed` | `completed` |
| `canceled` | `cancelled` |

### Priority Model

PRD story priorities are preserved as unbounded integers in the issue body metadata (`Ralph Priority`). These are mapped to Linear's coarse 0-4 scale for compatibility:

```text
coarse_priority = min(4, max(0, ralph_priority - 1))
```

Task selection uses the full `Ralph Priority` value for fine-grained ordering.

## Configuration Reference

```toml
# .ralph-tui/config.toml

# Set linear as default tracker
tracker = "linear"

# Or configure with options
[[trackers]]
name = "linear"
plugin = "linear"

  [trackers.options]
  apiKey = "lin_api_..."  # Optional if LINEAR_API_KEY is set
```

Run with:

```bash
ralph-tui run --tracker linear --epic ENG-123
```
