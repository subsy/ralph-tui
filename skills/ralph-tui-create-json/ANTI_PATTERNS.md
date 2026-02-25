# Schema Anti-Patterns

The following patterns are INVALID and will cause validation errors:

## ❌ WRONG: Wrapper object

```json
{
  "prd": {
    "name": "...",
    "userStories": [...]
  }
}
```

This wraps everything in a "prd" object. **DO NOT DO THIS.** The "name" and "userStories" fields must be at the ROOT level.

## ❌ WRONG: Using "tasks" instead of "userStories"

```json
{
  "name": "...",
  "tasks": [...]
}
```

The array is called **"userStories"**, not "tasks".

## ❌ WRONG: Complex nested structures

```json
{
  "metadata": {...},
  "overview": {...},
  "migration_strategy": {
    "phases": [...]
  }
}
```

Even if the PRD describes phases/milestones/sprints, you MUST flatten these into a single "userStories" array.

## ❌ WRONG: Using "status" instead of "passes"

```json
{
  "userStories": [{
    "id": "US-001",
    "status": "open"  // WRONG!
  }]
}
```

Use `"passes": false` for incomplete stories, `"passes": true` for completed.

## ✅ CORRECT: Flat structure at root

```json
{
  "name": "Android Kotlin Migration",
  "branchName": "ralph/kotlin-migration",
  "userStories": [
    {"id": "US-001", "title": "Create Scraper interface", "passes": false, "dependsOn": []},
    {"id": "US-002", "title": "Implement WeebCentralScraper", "passes": false, "dependsOn": ["US-001"]}
  ]
}
```
