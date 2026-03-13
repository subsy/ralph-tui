# Reference

## Differences from beads (Go version)

| Command | beads (`bd`) | beads-rust (`br`) |
|---------|--------------|-------------------|
| Create | `bd create` | `br create` |
| Dependencies | `bd dep add` | `br dep add` |
| Sync | `bd sync` | `br sync --flush-only` |
| Close | `bd close` | `br close` |
| Storage | `.beads/beads.jsonl` | `.beads/*.db` + JSONL export |
