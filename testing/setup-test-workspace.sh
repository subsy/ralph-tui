#!/usr/bin/env bash
# ABOUTME: Sets up a clean test workspace for Ralph-TUI manual testing.
# Creates a git repo OUTSIDE ralph-tui to avoid nested repo issues.
# Copies test-prd.json to workspace so the source template stays clean.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default location: ~/.cache/ralph-tui/test-workspace
# This avoids nested git repo issues and survives reboots (unlike /tmp)
DEFAULT_WORKSPACE="${XDG_CACHE_HOME:-$HOME/.cache}/ralph-tui/test-workspace"
TEST_WORKSPACE="${1:-$DEFAULT_WORKSPACE}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Ralph-TUI Test Workspace Setup ===${NC}"
echo ""

# Check if workspace already exists
if [ -d "$TEST_WORKSPACE" ]; then
    echo -e "${YELLOW}Test workspace already exists at: $TEST_WORKSPACE${NC}"
    read -p "Delete and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$TEST_WORKSPACE"
        echo -e "${GREEN}Removed existing workspace${NC}"
    else
        echo -e "${BLUE}Keeping existing workspace. Use reset-test.sh to reset state.${NC}"
        exit 0
    fi
fi

# Create workspace directory (including parent dirs)
echo -e "${YELLOW}[1/6] Creating test workspace...${NC}"
mkdir -p "$TEST_WORKSPACE"
echo -e "${GREEN}  Created: $TEST_WORKSPACE${NC}"

# Initialize git repo
echo -e "${YELLOW}[2/6] Initializing git repository...${NC}"
cd "$TEST_WORKSPACE"
git init --initial-branch=main
echo -e "${GREEN}  Git repo initialized${NC}"

# Copy test PRDs to workspace
echo -e "${YELLOW}[3/6] Copying test PRDs...${NC}"
cp "$SCRIPT_DIR/test-prd.json" "$TEST_WORKSPACE/test-prd.json"
echo -e "${GREEN}  Copied test-prd.json to workspace${NC}"
cp "$SCRIPT_DIR/test-conflict-prd.json" "$TEST_WORKSPACE/test-conflict-prd.json"
echo -e "${GREEN}  Copied test-conflict-prd.json to workspace${NC}"

# Create initial files
echo -e "${YELLOW}[4/6] Creating initial files...${NC}"

# Create a simple README
cat > README.md << EOF
# Ralph-TUI Test Workspace

This is a test workspace for manually testing Ralph-TUI end-to-end workflow.

**Source**: Created by \`$SCRIPT_DIR/setup-test-workspace.sh\`

## Available Tests

### 1. Basic Parallel Execution Test (\`test-prd.json\`)

Tests task selection, parallel execution, and dependency resolution.
Tasks create **separate files** so no merge conflicts occur.

\`\`\`bash
bun run dev -- run --prd $TEST_WORKSPACE/test-prd.json --cwd $TEST_WORKSPACE
\`\`\`

### 2. Conflict Resolution Test (\`test-conflict-prd.json\`)

Tests AI conflict resolution during parallel execution.
Multiple tasks modify the **same file** to trigger merge conflicts.

\`\`\`bash
bun run dev -- run --prd $TEST_WORKSPACE/test-conflict-prd.json --cwd $TEST_WORKSPACE --parallel 3
\`\`\`

## Files Created

### Basic Test
- \`output-a.txt\`, \`output-b.txt\`, \`output-c.txt\` - Individual task outputs
- \`merged-ab.txt\` - Combines A and B
- \`summary.txt\` - Final summary

### Conflict Test
- \`FEATURES.md\` - Shared file modified by all parallel tasks (triggers conflicts)
- \`SUMMARY.md\` - Summary created after conflicts are resolved

## Reset

\`\`\`bash
# Soft reset (re-copies PRDs, cleans outputs)
$SCRIPT_DIR/reset-test.sh

# Hard reset (full clean slate)
git reset --hard test-start && git clean -fd
\`\`\`
EOF

# Create a .gitignore
# Note: We do NOT gitignore output-*.txt, merged-*.txt, summary.txt because
# parallel execution requires these files to be committed for merges to work.
cat > .gitignore << 'EOF'
# Ralph-TUI session state (reset between tests)
.ralph-tui/
EOF

# Create .ralph-tui directory structure
mkdir -p .ralph-tui/iterations

# Create initial commit
git add .
git commit -m "Initial test workspace setup"

echo -e "${GREEN}  Created README.md, .gitignore${NC}"

# Create a git tag for easy reset
echo -e "${YELLOW}[5/6] Creating reset point...${NC}"
git tag -a "test-start" -m "Initial state for testing"
echo -e "${GREEN}  Created git tag 'test-start' for easy reset${NC}"

# Save workspace location for reset script
echo -e "${YELLOW}[6/6] Saving workspace location...${NC}"
echo "$TEST_WORKSPACE" > "$SCRIPT_DIR/.test-workspace-path"
echo -e "${GREEN}  Saved to $SCRIPT_DIR/.test-workspace-path${NC}"

# Final summary
echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo -e "Test workspace created at: ${BLUE}$TEST_WORKSPACE${NC}"
echo ""
echo -e "${YELLOW}Available tests:${NC}"
echo ""
echo -e "  ${GREEN}1. Basic parallel execution test:${NC}"
echo -e "     ${BLUE}bun run dev -- run --prd $TEST_WORKSPACE/test-prd.json --cwd $TEST_WORKSPACE${NC}"
echo ""
echo -e "  ${GREEN}2. Conflict resolution test (triggers AI merge resolution):${NC}"
echo -e "     ${BLUE}bun run dev -- run --prd $TEST_WORKSPACE/test-conflict-prd.json --cwd $TEST_WORKSPACE --parallel 3${NC}"
echo ""
echo -e "${YELLOW}Reset commands:${NC}"
echo ""
echo -e "  Soft reset (re-copies PRDs, cleans outputs):"
echo -e "     ${BLUE}./testing/reset-test.sh${NC}"
echo ""
echo -e "  Hard reset (full git clean slate):"
echo -e "     ${BLUE}cd $TEST_WORKSPACE && git reset --hard test-start && git clean -fd${NC}"
