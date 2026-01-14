# Factory Droid Agent Plugin

The Factory Droid plugin connects the `droid` CLI to Ralph TUI so tasks can be executed through Factory Droid with optional subagent tracing.

## Prerequisites

- Install the `droid` CLI and ensure it is available on your `PATH`.
- Set `FACTORY_API_KEY` in your environment so the CLI can authenticate.

## Configuration

The plugin accepts the following options in `.ralph-tui/config.toml` (either under `agentOptions` or inside an `agents` entry `options` object):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | string | unset | Overrides the model passed to the droid CLI. |
| `reasoningEffort` | `low` \| `medium` \| `high` | unset | Controls how much reasoning effort the model should use. |
| `skipPermissions` | boolean | `false` | Passes `--skip-permissions-unsafe` to run without interactive approvals. |
| `enableTracing` | boolean | `true` | Enables JSONL streaming output for subagent tracing. |

## Example configuration

Shorthand configuration for the default agent:

```toml
# .ralph-tui/config.toml
agent = "droid"
agentOptions = { model = "claude-sonnet-4-20250514", reasoningEffort = "medium", skipPermissions = true, enableTracing = true }
subagentTracingDetail = "full"
```

Explicit agent registration with per-agent options:

```toml
# .ralph-tui/config.toml
[[agents]]
name = "droid"
plugin = "droid"
default = true
options = { model = "claude-sonnet-4-20250514", reasoningEffort = "high", enableTracing = true }
```

## JSONL output format

When `enableTracing` is enabled and subagent tracing is active, the plugin uses `--output-format stream-json` and parses each JSONL line into a structured event. Each JSONL record can include:

- `type`: Event type (assistant message, tool event, error, etc.).
- `message`: Assistant message text.
- `result`: Final response text.
- `toolCalls`: Tool invocations with `name`, optional `id`, and `arguments`.
- `toolResults`: Tool results with `toolUseId`, `content`, `status`, and `isError`.
- `error`: Error information with `message`, optional `code`, and `status`.
- `cost`: Usage metrics with `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`, and `totalUSD`.
- `raw`: The original JSON payload from the droid CLI.

The parser accumulates cost events to summarize total token usage and USD spend for the run.