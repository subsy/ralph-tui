/**
 * ABOUTME: Tests for the PRD markdown parser.
 * Covers user story description extraction with various LLM-generated formats.
 */

import { describe, test, expect } from 'bun:test';
import { parsePrdMarkdown } from './parser.js';

/**
 * Helper to build a minimal PRD markdown document with a single user story.
 * The storyBody is inserted directly after the US header line.
 */
function buildPrdWithStory(storyBody: string): string {
  return `# PRD: Test Feature

## Overview

This is a test feature.

## User Stories

### US-001: Test Story

${storyBody}
`;
}

describe('parsePrdMarkdown', () => {
  describe('extractStoryDescription - plain text format', () => {
    test('extracts plain text description', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in so that I can access my account.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account.'
      );
    });

    test('extracts multi-line plain text description', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in
so that I can access my account securely.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account securely.'
      );
    });
  });

  describe('extractStoryDescription - **Description:** prefix format', () => {
    test('strips **Description:** prefix and extracts text', () => {
      const md = buildPrdWithStory(
        `**Description:** As a user, I want to log in so that I can access my account.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account.'
      );
    });

    test('handles **Description:** with multi-line content after it', () => {
      const md = buildPrdWithStory(
        `**Description:** As a user, I want to log in
so that I can access my account.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account.'
      );
    });
  });

  describe('extractStoryDescription - bold keyword format', () => {
    test('strips bold markers from **As a** / **I want** / **So that** format', () => {
      const md = buildPrdWithStory(
        `**As a** registered user
**I want** to log in with email and password
**So that** I can access my account

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a registered user I want to log in with email and password So that I can access my account'
      );
    });

    test('handles inline bold keywords on single line', () => {
      const md = buildPrdWithStory(
        `**As a** user, **I want** to export data **so that** I can share it.

**Acceptance Criteria:**
- [ ] Export button works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to export data so that I can share it.'
      );
    });
  });

  describe('extractStoryDescription - stop conditions', () => {
    test('stops at **Acceptance Criteria:**', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

**Acceptance Criteria:**
- [ ] Login form works
- [ ] Error message shown`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at **Priority:**', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

**Priority:** P1

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at **Depends on:**', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

**Depends on:** US-002

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at next heading', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

### US-002: Another Story

As a user, I want to log out.`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at horizontal rule', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

---

Some other content`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at empty line (end of paragraph)', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

Some unrelated paragraph here.`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });
  });

  describe('extractStoryDescription - does NOT stop at description-like bold', () => {
    test('does not stop at **As a** bold keyword', () => {
      const md = buildPrdWithStory(
        `**As a** user, I want to log in.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('does not stop at **Description:** label', () => {
      const md = buildPrdWithStory(
        `**Description:** Some important feature description.

**Acceptance Criteria:**
- [ ] Works correctly`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'Some important feature description.'
      );
    });
  });

  describe('extractStoryDescription - edge cases', () => {
    test('returns title as fallback when no description found', () => {
      const md = buildPrdWithStory(
        `**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      // Falls back to title when description is empty
      expect(result.userStories[0]!.description).toBe('Test Story');
    });

    test('handles description with no acceptance criteria following', () => {
      const md = buildPrdWithStory(
        'As a user, I want to do something simple.'
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to do something simple.'
      );
    });
  });

  describe('multiple user stories with mixed formats', () => {
    test('parses multiple stories with different description formats', () => {
      const md = `# PRD: Multi-Format Feature

## Overview

Testing mixed formats.

## User Stories

### US-001: Plain Text Story

As a user, I want plain text descriptions.

**Acceptance Criteria:**
- [ ] Works

### US-002: Bold Label Story

**Description:** As a developer, I want labeled descriptions.

**Acceptance Criteria:**
- [ ] Works

### US-003: Bold Keyword Story

**As a** admin
**I want** to manage users
**So that** the system stays secure

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.description).toBe(
        'As a user, I want plain text descriptions.'
      );
      expect(result.userStories[1]!.description).toBe(
        'As a developer, I want labeled descriptions.'
      );
      expect(result.userStories[2]!.description).toBe(
        'As a admin I want to manage users So that the system stays secure'
      );
    });
  });

  describe('H4 header support', () => {
    test('parses user stories with H4 headers (####)', () => {
      const md = `# PRD: Test Feature

## Overview

Testing H4 headers.

## User Stories

#### US-001: H4 Story

As a user, I want to use H4 headers for stories.

**Acceptance Criteria:**
- [ ] H4 headers work

### US-002: H3 Story

As a user, I want to use H3 headers too.

**Acceptance Criteria:**
- [ ] H3 headers work
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(2);

      expect(result.userStories[0]!.id).toBe('US-001');
      expect(result.userStories[0]!.title).toBe('H4 Story');
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to use H4 headers for stories.'
      );

      expect(result.userStories[1]!.id).toBe('US-002');
      expect(result.userStories[1]!.title).toBe('H3 Story');
      expect(result.userStories[1]!.description).toBe(
        'As a user, I want to use H3 headers too.'
      );
    });

    test('parses mixed H2, H3, and H4 headers', () => {
      const md = `# PRD: Mixed Headers

## Overview

Testing all header levels.

## User Stories

## US-001: H2 Story

As a user, I want H2 support.

**Acceptance Criteria:**
- [ ] Works

### US-002: H3 Story

As a user, I want H3 support.

**Acceptance Criteria:**
- [ ] Works

#### US-003: H4 Story

As a user, I want H4 support.

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.id).toBe('US-001');
      expect(result.userStories[0]!.title).toBe('H2 Story');

      expect(result.userStories[1]!.id).toBe('US-002');
      expect(result.userStories[1]!.title).toBe('H3 Story');

      expect(result.userStories[2]!.id).toBe('US-003');
      expect(result.userStories[2]!.title).toBe('H4 Story');
    });
  });

  describe('Feature X.Y format support', () => {
    test('parses Feature format (Feature 1.1)', () => {
      const md = `# PRD: Feature Format Test

## Overview

Testing Feature X.Y format.

## User Stories

### Feature 1.1: F-String Format Specifiers

As a developer, I want f-string support.

**Acceptance Criteria:**
- [ ] Format specifiers work

### Feature 1.2: StringIO Support

As a developer, I want StringIO support.

**Acceptance Criteria:**
- [ ] Context manager works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(2);

      // Feature IDs should be normalized to FEAT-X-Y
      expect(result.userStories[0]!.id).toBe('FEAT-1-1');
      expect(result.userStories[0]!.title).toBe('F-String Format Specifiers');

      expect(result.userStories[1]!.id).toBe('FEAT-1-2');
      expect(result.userStories[1]!.title).toBe('StringIO Support');
    });

    test('parses mixed US-XXX and Feature formats', () => {
      const md = `# PRD: Mixed Format Test

## Overview

Testing mixed formats.

## User Stories

### US-001: Standard User Story

As a user, I want standard format.

**Acceptance Criteria:**
- [ ] Works

### Feature 2.1: Feature Format

As a user, I want feature format.

**Acceptance Criteria:**
- [ ] Works

### US-002: Another Standard Story

As a user, I want another standard format.

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.id).toBe('US-001');
      expect(result.userStories[1]!.id).toBe('FEAT-2-1');
      expect(result.userStories[2]!.id).toBe('US-002');
    });

    test('parses Feature with H4 headers', () => {
      const md = `# PRD: Feature H4 Test

## Overview

Testing Feature with H4.

## User Stories

#### Feature 3.5: H4 Feature

As a developer, I want H4 feature support.

**Acceptance Criteria:**
- [ ] H4 works with features
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(1);

      expect(result.userStories[0]!.id).toBe('FEAT-3-5');
      expect(result.userStories[0]!.title).toBe('H4 Feature');
    });
  });

  describe('All 9 combinations (3 headers × 3 formats)', () => {
    test('parses all 9 possible combinations', () => {
      const md = `# PRD: Comprehensive Format Test

## Overview

Testing all 9 combinations: 3 header levels (H2, H3, H4) × 3 ID formats (US-XXX, PREFIX-XXX, Feature X.Y)

## User Stories

## US-001: H2 with US format
**Acceptance Criteria:**
- [ ] Works

### US-002: H3 with US format
**Acceptance Criteria:**
- [ ] Works

#### US-003: H4 with US format
**Acceptance Criteria:**
- [ ] Works

## EPIC-100: H2 with PREFIX format
**Acceptance Criteria:**
- [ ] Works

### FEAT-200: H3 with PREFIX format
**Acceptance Criteria:**
- [ ] Works

#### BUG-300: H4 with PREFIX format
**Acceptance Criteria:**
- [ ] Works

## Feature 1.1: H2 with Feature format
**Acceptance Criteria:**
- [ ] Works

### Feature 2.2: H3 with Feature format
**Acceptance Criteria:**
- [ ] Works

#### Feature 3.3: H4 with Feature format
**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(9);

      // H2 level
      expect(result.userStories[0]!.id).toBe('US-001');
      expect(result.userStories[0]!.title).toBe('H2 with US format');

      expect(result.userStories[3]!.id).toBe('EPIC-100');
      expect(result.userStories[3]!.title).toBe('H2 with PREFIX format');

      expect(result.userStories[6]!.id).toBe('FEAT-1-1');
      expect(result.userStories[6]!.title).toBe('H2 with Feature format');

      // H3 level
      expect(result.userStories[1]!.id).toBe('US-002');
      expect(result.userStories[1]!.title).toBe('H3 with US format');

      expect(result.userStories[4]!.id).toBe('FEAT-200');
      expect(result.userStories[4]!.title).toBe('H3 with PREFIX format');

      expect(result.userStories[7]!.id).toBe('FEAT-2-2');
      expect(result.userStories[7]!.title).toBe('H3 with Feature format');

      // H4 level
      expect(result.userStories[2]!.id).toBe('US-003');
      expect(result.userStories[2]!.title).toBe('H4 with US format');

      expect(result.userStories[5]!.id).toBe('BUG-300');
      expect(result.userStories[5]!.title).toBe('H4 with PREFIX format');

      expect(result.userStories[8]!.id).toBe('FEAT-3-3');
      expect(result.userStories[8]!.title).toBe('H4 with Feature format');
    });

    test('validates each format independently', () => {
      // US-XXX format (exactly 3 digits)
      const usFormat = `# PRD\n## User Stories\n### US-001: Valid\n**Acceptance Criteria:**\n- [ ] Test`;
      expect(parsePrdMarkdown(usFormat).userStories).toHaveLength(1);

      // PREFIX-XXX format (any uppercase prefix + digits)
      const prefixFormat = `# PRD\n## User Stories\n### STORY-42: Valid\n**Acceptance Criteria:**\n- [ ] Test`;
      expect(parsePrdMarkdown(prefixFormat).userStories).toHaveLength(1);

      // Feature X.Y format
      const featureFormat = `# PRD\n## User Stories\n### Feature 5.7: Valid\n**Acceptance Criteria:**\n- [ ] Test`;
      expect(parsePrdMarkdown(featureFormat).userStories).toHaveLength(1);
      expect(parsePrdMarkdown(featureFormat).userStories[0]!.id).toBe('FEAT-5-7');
    });

    test('edge cases for each format', () => {
      const edgeCases = `# PRD: Edge Cases

## User Stories

### US-999: Max 3 digits for US format
**Acceptance Criteria:**
- [ ] Works

### VERYLONGPREFIX-123456: Long prefix with many digits
**Acceptance Criteria:**
- [ ] Works

### Feature 99.99: Large version numbers
**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(edgeCases);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.id).toBe('US-999');
      expect(result.userStories[1]!.id).toBe('VERYLONGPREFIX-123456');
      expect(result.userStories[2]!.id).toBe('FEAT-99-99');
    });
  });

  describe('US-X.Y.Z version-style format', () => {
    test('parses US version-style IDs (US-2.1.1)', () => {
      const md = `# PRD: Version Style Test

## Overview

Testing US version-style IDs.

## User Stories

#### US-2.1.1: Numerikus formázás

As a developer, I want f-string numeric formatting.

**Acceptance Criteria:**
- [ ] Precision support: f"{pi:.2f}"
- [ ] Integer formatting: f"{num:d}"

#### US-2.1.2: Width és Alignment

As a developer, I want width/alignment formatting.

**Acceptance Criteria:**
- [ ] Minimum width
- [ ] Right align

### US-2.2.1: Match Statement

As a developer, I want match/case statement support.

**Acceptance Criteria:**
- [ ] Literal patterns work
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.id).toBe('US-2.1.1');
      expect(result.userStories[0]!.title).toBe('Numerikus formázás');

      expect(result.userStories[1]!.id).toBe('US-2.1.2');
      expect(result.userStories[1]!.title).toBe('Width és Alignment');

      expect(result.userStories[2]!.id).toBe('US-2.2.1');
      expect(result.userStories[2]!.title).toBe('Match Statement');
    });

    test('parses mixed US-001 and US-X.Y.Z formats', () => {
      const md = `# PRD: Mixed US Formats

## User Stories

### US-001: Standard Format

**Acceptance Criteria:**
- [ ] Works

### US-1.2: Two-part version

**Acceptance Criteria:**
- [ ] Works

### US-1.2.3: Three-part version

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.id).toBe('US-001');
      expect(result.userStories[1]!.id).toBe('US-1.2');
      expect(result.userStories[2]!.id).toBe('US-1.2.3');
    });
  });

  describe('Fallback parser for non-standard formats', () => {
    test('parses any header with colon in User Stories section', () => {
      const md = `# PRD

## User Stories

### Epic 1: F-String Support

**Acceptance Criteria:**
- [ ] Works

### Epic 2: Match Support

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories.length).toBeGreaterThanOrEqual(2);

      // Auto-generated IDs
      expect(result.userStories[0]!.id).toBe('STORY-001');
      expect(result.userStories[0]!.title).toBe('F-String Support');

      expect(result.userStories[1]!.id).toBe('STORY-002');
      expect(result.userStories[1]!.title).toBe('Match Support');
    });

    test('strict patterns take precedence over fallback', () => {
      const md = `# PRD

## User Stories

### US-001: Standard Story

**Acceptance Criteria:**
- [ ] Works

### Epic 1: Non-Standard Story

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      // Should use strict parser because US-001 matches
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.id).toBe('US-001');
    });
  });

  describe('US- prefix exclusion from generic pattern', () => {
    test('US-1 and US-9999 are not matched by strict pattern (use fallback)', () => {
      const md = `# PRD: Invalid US Format Test

## User Stories

### US-1: Single digit (invalid)

**Acceptance Criteria:**
- [ ] Works

### US-9999: Four digits (invalid)

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      // These don't match strict US-XXX (3 digits), so fallback generates STORY-XXX
      expect(result.userStories.length).toBeGreaterThanOrEqual(2);
      expect(result.userStories[0]!.id).toBe('STORY-001');
      expect(result.userStories[1]!.id).toBe('STORY-002');
    });

    test('EPIC-1 and TASK-9999 are still matched by generic pattern', () => {
      const md = `# PRD: Non-US Prefix Test

## User Stories

### EPIC-1: Single digit non-US prefix

**Acceptance Criteria:**
- [ ] Works

### TASK-9999: Many digits non-US prefix

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(2);
      // Non-US prefixes are matched by the generic [A-Z]+-\d+ pattern
      expect(result.userStories[0]!.id).toBe('EPIC-1');
      expect(result.userStories[1]!.id).toBe('TASK-9999');
    });

    test('US-001 is still matched correctly (exactly 3 digits)', () => {
      const md = `# PRD: Valid US Format Test

## User Stories

### US-001: Exactly three digits

**Acceptance Criteria:**
- [ ] Works

### US-999: Max three digits

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(2);
      expect(result.userStories[0]!.id).toBe('US-001');
      expect(result.userStories[1]!.id).toBe('US-999');
    });

    test('US-X.Y.Z version format still works', () => {
      const md = `# PRD: US Version Format Test

## User Stories

### US-2.1: Two-part version

**Acceptance Criteria:**
- [ ] Works

### US-2.1.1: Three-part version

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(2);
      expect(result.userStories[0]!.id).toBe('US-2.1');
      expect(result.userStories[1]!.id).toBe('US-2.1.1');
    });
  });

  describe('Ultimate fallback - ALWAYS generates JSON', () => {
    test('parses PRD without User Stories section', () => {
      const md = `# My Project PRD

## Introduction

Some intro text.

## Feature 1: Login System

Users should be able to log in.

- [ ] Email login
- [ ] Password validation

## Feature 2: Dashboard

Users see a dashboard after login.

- [ ] Show stats
- [ ] Recent activity
`;

      const result = parsePrdMarkdown(md);
      // Should find Feature 1 and Feature 2 via ultimate fallback
      expect(result.userStories.length).toBeGreaterThanOrEqual(2);
    });

    test('parses completely non-standard PRD', () => {
      const md = `# Random Document

## Section A: First Thing

Do the first thing.

**Criteria:**
- [ ] Done

## Section B: Second Thing

Do the second thing.

**Criteria:**
- [ ] Done
`;

      const result = parsePrdMarkdown(md);
      // Should still find stories via ultimate fallback
      expect(result.userStories.length).toBeGreaterThanOrEqual(2);
      expect(result.userStories[0]!.id).toBe('STORY-001');
      expect(result.userStories[0]!.title).toBe('First Thing');
    });

    test('skips common non-story headers', () => {
      const md = `# PRD

## Overview: Project Summary

This is the overview.

## Task 1: Implement Feature

Do the feature.

- [ ] Done

## Technical: Architecture Notes

Architecture details here.
`;

      const result = parsePrdMarkdown(md);
      // Should skip Overview and Technical, only find Task 1
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.title).toBe('Implement Feature');
    });
  });

  describe('Parser exit on unknown H1/H2 headers', () => {
    test('stops parsing on unknown H2 section (## Architecture)', () => {
      const md = `# PRD: Test

## User Stories

### US-001: First Story

**Acceptance Criteria:**
- [ ] Works

## Architecture

This section should not be parsed as a story.

### Some: Header With Colon

This should not be matched.
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.id).toBe('US-001');
    });

    test('stops parsing on unknown H1 section', () => {
      const md = `# PRD: Test

## User Stories

### US-001: First Story

**Acceptance Criteria:**
- [ ] Works

# Appendix

### Something: Else

Should not be parsed.
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.id).toBe('US-001');
    });

    test('continues parsing H3/H4 story headers after H2 stories', () => {
      const md = `# PRD: Test

## User Stories

## US-001: H2 Story

**Acceptance Criteria:**
- [ ] Works

### US-002: H3 Story

**Acceptance Criteria:**
- [ ] Works

#### US-003: H4 Story

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);
    });
  });
});
