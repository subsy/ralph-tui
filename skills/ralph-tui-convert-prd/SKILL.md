---
name: ralph-tui-convert-prd
description: "Convert existing PRD documents to ralph-tui format. Transforms any PRD format into structured user stories with acceptance criteria for automated execution. Triggers on: convert prd, transform prd, import prd, prd from file."
---

# Ralph TUI - Convert PRD

Converts existing PRD documents (any format) into ralph-tui compatible format with structured user stories.

---

## The Job

1. Analyze the provided PRD document structure
2. Identify requirements, features, or specifications that can become user stories
3. Transform them into US-XXX format with acceptance criteria
4. Output the converted PRD wrapped in `[PRD]...[/PRD]` markers

**Important:** Do NOT implement anything. Just convert the document structure.

---

## Input Analysis

When analyzing the input PRD, look for:

### Common PRD Structures

1. **Functional Requirements (FR-XXX)**
   - Convert each FR to a user story
   - FR-1 → US-001, FR-2 → US-002, etc.

2. **Feature Sections (4.1.1, 4.1.2, etc.)**
   - Each feature subsection can become one or more user stories
   - Group related requirements into single stories

3. **User Stories (existing)**
   - Preserve and reformat to match ralph-tui structure

4. **Requirements Lists**
   - Bullet points under feature sections → acceptance criteria

5. **Use Cases**
   - Convert to user story format: "As a [user], I want [feature] so that [benefit]"

### What to Extract

- **Title:** Short descriptive name
- **Description:** User story format or feature description
- **Acceptance Criteria:** Specific, verifiable checklist items
- **Priority:** Infer from document order or explicit priority
- **Dependencies:** Infer from logical flow or explicit references

---

## Conversion Rules

### Story Sizing

**Critical:** Each story must be completable in ONE ralph-tui iteration.

**Split large features into multiple stories:**
- Database schema changes (separate story)
- Backend API endpoints (separate story per resource)
- Frontend components (separate story per component)
- Integration/wiring (separate story)

**Example:**
Input: "4.1.1 Invoice Management - Create, edit, delete invoices with PDF export"

Output:
- US-001: Create invoice data model and database schema
- US-002: Implement invoice CRUD API endpoints
- US-003: Create invoice form component
- US-004: Create invoice list component
- US-005: Implement invoice PDF export

### Acceptance Criteria

Transform requirements into verifiable criteria:

**Bad (vague):**
- "System should handle invoices properly"
- "Good user experience"

**Good (verifiable):**
- "Invoice form validates required fields (number, date, customer, total)"
- "Invoice list displays: number, date, customer, total, status"
- "PDF export includes company logo, invoice details, and line items"

### Dependencies

Infer dependencies from logical order:
1. Schema/database changes → no dependencies
2. Backend API → depends on schema
3. Frontend components → depends on API
4. Integration features → depends on components

### Priority Assignment

- P1: Core/foundational (schema, auth, base setup)
- P2: Primary features (main functionality)
- P3: Secondary features (enhancements)
- P4: Polish/optional (nice-to-have)

---

## Output Format

**CRITICAL:** Wrap the converted PRD in markers:

```
[PRD]
# PRD: [Feature Name]

> Generated: [timestamp]
> Source: Converted from existing PRD

## Overview

[Brief description extracted from source document]

## Quality Gates

These commands must pass for every user story:
- `[Ask user or use default: bun run typecheck && bun run build]`

## User Stories

### US-001: [Title]
**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**
- [ ] Specific verifiable criterion
- [ ] Another criterion

**Priority:** P[1-4]
**Depends on:** [None or US-XXX]

### US-002: [Title]
...

## Non-Goals

[List items explicitly out of scope from source document]

## Technical Considerations

[Extract any technical notes from source document]
[/PRD]
```

---

## Conversion Process

### Step 1: Document Analysis

First, scan the document and identify:
- Document title/name
- Main sections and structure
- Number of potential user stories
- Technology stack mentioned

Report to user:
```
I've analyzed your PRD. Here's what I found:

- **Title:** [extracted title]
- **Sections:** [count] main feature areas
- **Estimated Stories:** [count] user stories
- **Tech Stack:** [if mentioned]

I'll now convert this to ralph-tui format. Do you want me to:
A. Proceed with conversion (recommended)
B. Ask clarifying questions first
C. Focus on specific sections only
```

### Step 2: Quality Gates Question

Ask about quality gates:
```
What quality commands should pass for each story?
A. bun run typecheck && bun run build
B. npm run typecheck && npm run lint
C. pnpm typecheck && pnpm lint
D. Other: [specify]
```

### Step 3: Conversion

- Extract features → user stories
- Generate acceptance criteria
- Assign priorities and dependencies
- Output wrapped in `[PRD]...[/PRD]`

---

## Example Conversion

### Input (excerpt):
```markdown
## 4.1.2 Invoice Management

**Description:** Create, manage, and track invoices for customers.

**Requirements:**
- Invoice Creation with sequential numbering
- Line items with VAT calculation
- Invoice status tracking (Draft, Sent, Paid)
- PDF export

**User Stories:**
- As a business owner, I want to create invoices so that I can bill customers.
```

### Output:
```
### US-005: Add invoice database schema
**Description:** As a developer, I need the invoice data model so that I can store invoice data.

**Acceptance Criteria:**
- [ ] Create invoices table with fields: id, number, date, customerId, status, total
- [ ] Create invoiceItems table with fields: id, invoiceId, description, quantity, unitPrice, vatRate
- [ ] Add foreign key constraints
- [ ] Create database migration

**Priority:** P1
**Depends on:** US-003 (customer schema)

### US-006: Implement invoice CRUD API
**Description:** As a developer, I need API endpoints for invoice operations.

**Acceptance Criteria:**
- [ ] GET /api/invoices - list invoices with filters
- [ ] POST /api/invoices - create new invoice
- [ ] GET /api/invoices/:id - get single invoice
- [ ] PUT /api/invoices/:id - update invoice
- [ ] PATCH /api/invoices/:id/status - update status

**Priority:** P2
**Depends on:** US-005

### US-007: Create invoice form component
**Description:** As a business owner, I want an invoice creation form so that I can bill customers.

**Acceptance Criteria:**
- [ ] Form includes: invoice number (auto-generated), date, customer dropdown
- [ ] Line items section with add/remove functionality
- [ ] VAT calculation per line item (0%, 5%, 20%)
- [ ] Total calculation with VAT breakdown
- [ ] Save as draft or send actions

**Priority:** P2
**Depends on:** US-006
```

---

## Checklist Before Output

- [ ] Analyzed document structure
- [ ] Asked about quality gates
- [ ] Each story is small enough for one iteration
- [ ] Acceptance criteria are specific and verifiable
- [ ] Dependencies reflect logical order
- [ ] PRD wrapped in `[PRD]...[/PRD]` markers
- [ ] Non-goals section identifies out-of-scope items
