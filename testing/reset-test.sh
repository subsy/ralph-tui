#!/usr/bin/env bash
# ABOUTME: Reset script for idempotent Ralph-TUI manual testing.
# Resets all state to allow re-running the same test from scratch.

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
    echo -e "Run ${BLUE}$SCRIPT_DIR/setup-test-workspace.sh${NC} first."
    exit 1
fi

echo -e "Workspace: ${BLUE}$TEST_WORKSPACE${NC}"
echo ""

# 1. Reset the PRD file to initial state (all passes: false)
echo -e "${YELLOW}[1/5] Resetting test-prd.json...${NC}"
if [ -f "$SCRIPT_DIR/test-prd.json" ]; then
    # Use jq if available (preferred), otherwise use perl (portable fallback)
    if command -v jq &> /dev/null; then
        jq '.userStories |= map(.passes = false)' "$SCRIPT_DIR/test-prd.json" > "$SCRIPT_DIR/test-prd.json.tmp"
        mv "$SCRIPT_DIR/test-prd.json.tmp" "$SCRIPT_DIR/test-prd.json"
        echo -e "${GREEN}  PRD reset: all tasks set to passes: false${NC}"
    else
        # Fallback: use perl (portable across macOS and Linux, unlike sed -i)
        perl -pi -e 's/"passes": true/"passes": false/g' "$SCRIPT_DIR/test-prd.json"
        echo -e "${GREEN}  PRD reset (via perl): all tasks set to passes: false${NC}"
    fi
else
    echo -e "${RED}  Warning: test-prd.json not found${NC}"
fi

# 2. Clean up test workspace outputs
echo -e "${YELLOW}[2/5] Cleaning test workspace outputs...${NC}"
rm -f "$TEST_WORKSPACE"/output-*.txt
rm -f "$TEST_WORKSPACE"/merged-*.txt
rm -f "$TEST_WORKSPACE"/summary.txt
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
echo -e "To run the test:"
echo -e "  ${BLUE}bun run dev -- run --prd testing/test-prd.json --cwd $TEST_WORKSPACE${NC}"
