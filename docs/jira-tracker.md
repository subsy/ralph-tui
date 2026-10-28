# Jira Tracker Plugin

Use Jira as a task tracker for Ralph TUI. Tasks are managed as stories under an epic in Jira Cloud.

## Setup

### 1. Get a Jira API Token

Create an API token at: [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

### 2. Configure Authentication

Set environment variables:

```bash
export JIRA_BASE_URL="https://company.atlassian.net"
export JIRA_EMAIL="you@company.com"
export JIRA_API_TOKEN="your-api-token"
```

Or add credentials to your project config (`.ralph-tui/config.toml`):

```toml
[[trackers]]
name = "jira"
plugin = "jira"

  [trackers.options]
  baseUrl = "https://company.atlassian.net"
  email = "you@company.com"
  apiToken = "your-api-token"
  projectKey = "MYN"
```

Auth precedence: explicit config fields override environment variables.

### 3. Run Setup Wizard

```bash
ralph-tui setup
```

Select `jira` as the tracker. The wizard will ask for your Jira URL, email, API token, and project key, then validate the connection.

## Running Tasks from Jira

Run Ralph against stories under an epic:

```bash
ralph-tui run --tracker jira --epic MYN-5000
```

The `--epic` flag accepts a Jira issue key (e.g., `MYN-5000`).

### How It Works

1. Ralph fetches all child stories under the specified epic
2. Stories are ordered by priority (highest first)
3. In-progress stories are preferred over open ones
4. Dependency-blocked stories are excluded from selection
5. On completion, Ralph transitions the story to Done and posts a rich comment

### Epic Discovery

If `projectKey` is configured, the TUI's epic picker (`l` key) will list all epics in that project. You can also browse epics without specifying one upfront:

```bash
# Configure projectKey in config, then:
ralph-tui run --tracker jira
# → Use 'l' key in TUI to browse and select an epic
```

## Status Mapping

Jira statuses are mapped using the status **category** (consistent across all Jira instances):

| Jira Status Category | Ralph Status |
|----------------------|-------------|
| To Do (`new`) | `open` |
| In Progress (`indeterminate`) | `in_progress` |
| Done (`done`) | `completed` |

### Custom Status Mapping

Override the default mapping for custom workflow statuses:

```toml
[trackers.options.statusMapping]
"To Do" = "open"
"In Progress" = "in_progress"
"Code Review" = "in_progress"
"Done" = "completed"
"Won't Do" = "cancelled"
```

When a custom mapping is configured, exact status name matches take precedence over category-based mapping for both task reads and workflow transitions.

## Priority Mapping

| Jira Priority | Ralph Priority |
|---------------|---------------|
| Highest / Blocker / Critical / P1 | P0 (Critical) |
| High / P2 | P1 (High) |
| Medium / P3 | P2 (Medium) |
| Low / P4 | P3 (Low) |
| Lowest / Trivial / P5 | P4 (Backlog) |

Both standard Jira priorities (Highest–Lowest) and numeric priorities (P1–P5) are supported.

## Acceptance Criteria

Ralph extracts acceptance criteria from stories to include in agent prompts. Three extraction strategies are supported:

### From Description (Default)

Parses the story description for an "Acceptance Criteria" section:

```text
## Acceptance Criteria
- Criterion 1
- Criterion 2
```

### From Custom Field

Use a Jira custom field that stores AC:

```toml
[trackers.options]
acceptanceCriteriaSource = "custom_field"
acceptanceCriteriaField = "customfield_10037"
```

### From Subtasks

Treat subtasks as acceptance criteria items:

```toml
[trackers.options]
acceptanceCriteriaSource = "subtasks"
```

## Dependencies

Jira issue links of type "Blocks" / "is blocked by" are used for dependency resolution. Tasks that are blocked by incomplete stories are excluded from selection.

## Completion Comments

When Ralph completes a story, it posts a rich comment to the Jira issue:

- ✅ Success panel header
- Acceptance criteria checklist (all items marked complete)
- Duration of the iteration
- Summary/reason if provided by the agent

## Epic Hierarchy

The plugin auto-detects two Jira hierarchy models:

1. **Next-gen (Parent)**: `parent = EPIC-KEY` (tried first)
2. **Classic (Epic Link)**: `"Epic Link" = EPIC-KEY` (fallback)

Force a specific model:

```toml
[trackers.options]
hierarchyModel = "parent"    # or "epic-link" or "auto" (default)
```

## Configuration Reference

```toml
# .ralph-tui/config.toml

# Set jira as default tracker
tracker = "jira"

# Full configuration
[[trackers]]
name = "jira"
plugin = "jira"

  [trackers.options]
  # Required
  baseUrl = "https://company.atlassian.net"
  email = "you@company.com"
  apiToken = "your-api-token"

  # Optional
  projectKey = "MYN"                        # For epic discovery
  hierarchyModel = "auto"                   # "auto" | "parent" | "epic-link"
  acceptanceCriteriaSource = "description"  # "description" | "custom_field" | "subtasks"
  acceptanceCriteriaField = "customfield_10037"  # When using custom_field

  # Custom status mapping (optional)
  [trackers.options.statusMapping]
  "Code Review" = "in_progress"
  "Won't Do" = "cancelled"
```

Run with:

```bash
ralph-tui run --tracker jira --epic MYN-5000
```
