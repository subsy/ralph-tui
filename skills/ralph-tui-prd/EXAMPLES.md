# Examples

## Full Conversation Flow Example

**User:** Create a PRD for adding dark mode to the TUI

**Assistant:** I'll help you create a PRD for dark mode. Let me ask a few questions:

1. What is the primary goal?
   A. Reduce eye strain for long sessions
   B. Match system theme preference
   C. Provide visual customization
   D. Other

2. Should the setting persist?
   A. Yes, save to config file
   B. No, session only
   C. Follow system preference

**User:** 1A, 2A

**Assistant:** Great! A couple more questions:

3. Which components need dark mode support?
   A. All TUI components
   B. Only the main execution view
   C. Main view + settings
   D. Other

4. What quality commands must pass for each story?
   A. pnpm typecheck && pnpm lint
   B. npm run typecheck && npm run lint
   C. bun run typecheck
   D. Other: [specify]

5. For UI stories, include browser verification?
   A. Yes, use dev-browser skill
   B. No, automated tests sufficient

**User:** 3A, 4A, 5A

**Assistant:** Perfect, I have enough to generate the PRD.

[PRD]
# PRD: Dark Mode for Ralph TUI

## Overview
Add dark mode support to ralph-tui to reduce eye strain during long orchestration sessions. The feature will apply to all TUI components and persist the user's preference in the config file.

## Goals
- Provide a comfortable viewing experience in low-light environments
- Persist theme preference across sessions
- Apply consistent styling to all TUI components

## Quality Gates

These commands must pass for every user story:
- `pnpm typecheck` - Type checking
- `pnpm lint` - Linting

For UI stories, also include:
- Verify in browser using dev-browser skill

## User Stories

### US-001: Add theme configuration
**Description:** As a user, I want to set my preferred theme (light/dark) so that it persists across sessions.

**Acceptance Criteria:**
- [ ] Add `theme` field to `.ralph-tui.yaml` schema
- [ ] Support values: "light", "dark", "system"
- [ ] Default to "light" for backwards compatibility

### US-002: Create dark theme color palette
**Description:** As a user, I want a soft-contrast dark theme that's easy on the eyes.

**Acceptance Criteria:**
- [ ] Define dark palette with gray tones (not pure black)
- [ ] Ensure sufficient contrast ratios (WCAG AA)
- [ ] Colors work well for all UI states (selected, hover, disabled)

### US-003: Apply theme to TUI components
**Description:** As a user, I want all TUI components to respect my theme preference.

**Acceptance Criteria:**
- [ ] Header component uses theme colors
- [ ] Task list uses theme colors
- [ ] Detail panels use theme colors
- [ ] Progress bar uses theme colors
- [ ] Dialogs use theme colors

### US-004: Add theme toggle in settings
**Description:** As a user, I want to toggle themes from within the TUI settings.

**Acceptance Criteria:**
- [ ] Theme option visible in settings view
- [ ] Changes apply immediately without restart
- [ ] Changes persist to config file

## Functional Requirements
- FR-1: Theme setting must be readable from `.ralph-tui.yaml`
- FR-2: Theme must apply on TUI startup
- FR-3: Theme changes in settings must apply immediately
- FR-4: All text must maintain readability in both themes

## Non-Goals
- System theme auto-detection (future enhancement)
- Custom color schemes beyond light/dark
- Per-component theme overrides

## Technical Considerations
- Use existing OpenTUI theming capabilities if available
- Consider creating a ThemeContext for React components
- Minimize re-renders when theme changes

## Success Metrics
- All components render correctly in dark mode
- No accessibility contrast issues
- Theme persists across sessions

## Open Questions
- Should we detect system theme preference automatically in v2?
[/PRD]
