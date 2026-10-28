#!/usr/bin/env bash
# ABOUTME: Reset script for idempotent Ralph-TUI manual testing.
# Resets all state to allow re-running the same test from scratch.
# Re-copies test-prd.json from source to ensure clean state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read workspace path from saved file, or use default
if [ -f "$SCRIPT_DIR/.test-workspace-path" ]; then
    SAVED_WORKSPACE="$(cat "$SCRIPT_DIR/.test-workspace-path")"
else
    SAVED_WORKSPACE="${XDG_CACHE_HOME:-$HOME/.cache}/ralph-tui/test-workspace"
fi

TEST_WORKSPACE="${1:-$SAVED_WORKSPACE}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Ralph-TUI Test Reset ===${NC}"
echo ""

# Check if workspace exists
if [ ! -d "$TEST_WORKSPACE" ]; then
    echo -e "${RED}Test workspace not found at: $TEST_WORKSPACE${NC}"
    echo -e "Run ${BLUE}./testing/setup-test-workspace.sh${NC} first."
    exit 1
fi

echo -e "Workspace: ${BLUE}$TEST_WORKSPACE${NC}"
echo ""

# 1. Re-copy PRDs from source (always clean)
echo -e "${YELLOW}[1/5] Resetting PRD files...${NC}"
if [ -f "$SCRIPT_DIR/test-prd.json" ]; then
    cp "$SCRIPT_DIR/test-prd.json" "$TEST_WORKSPACE/test-prd.json"
    echo -e "${GREEN}  Re-copied test-prd.json from source (all tasks reset)${NC}"
else
    echo -e "${RED}  Warning: source test-prd.json not found at $SCRIPT_DIR/test-prd.json${NC}"
fi

# Also reset conflict PRD if it exists in workspace
if [ -f "$TEST_WORKSPACE/test-conflict-prd.json" ]; then
    if [ -f "$SCRIPT_DIR/test-conflict-prd.json" ]; then
        cp "$SCRIPT_DIR/test-conflict-prd.json" "$TEST_WORKSPACE/test-conflict-prd.json"
        echo -e "${GREEN}  Re-copied test-conflict-prd.json from source${NC}"
    fi
fi

# 2. Clean up test workspace outputs
echo -e "${YELLOW}[2/5] Cleaning test workspace outputs...${NC}"
rm -f "$TEST_WORKSPACE"/output-*.txt
rm -f "$TEST_WORKSPACE"/merged-*.txt
rm -f "$TEST_WORKSPACE"/summary.txt
# Conflict test outputs
rm -f "$TEST_WORKSPACE"/FEATURES.md
rm -f "$TEST_WORKSPACE"/SUMMARY.md
echo -e "${GREEN}  Removed generated output files${NC}"

# 3. Clean up .ralph-tui session state
echo -e "${YELLOW}[3/5] Cleaning Ralph-TUI session state...${NC}"
RALPH_DIR="$TEST_WORKSPACE/.ralph-tui"
if [ -d "$RALPH_DIR" ]; then
    rm -f "$RALPH_DIR/session.json"
    rm -f "$RALPH_DIR/lock.json"
    rm -f "$RALPH_DIR/progress.md"
    rm -rf "$RALPH_DIR/iterations"
    mkdir -p "$RALPH_DIR/iterations"
    echo -e "${GREEN}  Removed session.json, lock.json, progress.md, and iterations/${NC}"
else
    mkdir -p "$RALPH_DIR/iterations"
    echo -e "${BLUE}  Created fresh .ralph-tui directory${NC}"
fi

# 4. Optional: Reset git state in test workspace
echo -e "${YELLOW}[4/5] Checking git state...${NC}"
if [ -d "$TEST_WORKSPACE/.git" ]; then
    echo -e "${BLUE}  Git repo found. To fully reset git state, run:${NC}"
    echo -e "    cd $TEST_WORKSPACE && git reset --hard test-start && git clean -fd"
    echo -e "${BLUE}  (Not done automatically to preserve any work you want to keep)${NC}"
else
    echo -e "${BLUE}  No git repo in test workspace${NC}"
fi

# 5. Summary
echo ""
echo -e "${YELLOW}[5/5] Summary...${NC}"
echo -e "${GREEN}Test environment reset complete!${NC}"
echo ""
echo -e "${YELLOW}Available tests:${NC}"
echo ""
echo -e "  ${GREEN}1. Basic parallel execution test:${NC}"
echo -e "     ${BLUE}bun run dev -- run --prd $TEST_WORKSPACE/test-prd.json --cwd $TEST_WORKSPACE${NC}"
echo ""
echo -e "  ${GREEN}2. Conflict resolution test (triggers AI merge resolution):${NC}"
echo -e "     ${BLUE}bun run dev -- run --prd $TEST_WORKSPACE/test-conflict-prd.json --cwd $TEST_WORKSPACE --parallel 3${NC}"
