#!/bin/bash
# lint-content.sh
# Checks JSON data files for AI-tell patterns before deploy
# Usage: ./tools/lint-content.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

echo "========================================"
echo "ReadTheDelta Content Linter"
echo "========================================"
echo ""

# Define patterns
# Critical: These fail the build
CRITICAL_PATTERNS=(
  "—"                    # Em-dash
  ";"                    # Semicolon (in prose, not JSON syntax)
  "!"                    # Exclamation point
)

# Warning: These should be reviewed
WARNING_PATTERNS=(
  "Furthermore"
  "Moreover"
  "Additionally"
  "Nevertheless"
  "Consequently"
  "It's worth noting"
  "It should be noted"
  "Notably"
  "Significantly"
  "Interestingly"
  "Importantly"
  "This is significant"
  "It is important"
  "In terms of"
  "When it comes to"
  "Given the fact"
  "utilize"
  "leverage"
  "robust"
)

# Files to check
DATA_FILES="data/latest.jobs.json data/latest.inflation.json"

echo "Checking files:"
for f in $DATA_FILES; do
  if [ -f "$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f (not found)"
  fi
done
echo ""

# Extract text fields from JSON for checking
# We check: headline.title, headline.summary, headline.context, editorial.*
extract_text_fields() {
  local file=$1
  # Use node to extract text fields safely
  node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$file'));
    const fields = [
      data.headline?.title,
      data.headline?.summary,
      data.headline?.context,
      data.editorial?.what_changed,
      data.editorial?.what_didnt,
      data.editorial?.why_it_matters,
      data.editorial?.revision_note,
      data.editorial?.editor_note
    ].filter(Boolean);
    console.log(fields.join('\n'));
  " 2>/dev/null
}

# Check for critical patterns
echo "Checking for CRITICAL patterns (build will fail):"
echo "----------------------------------------"
for file in $DATA_FILES; do
  if [ ! -f "$file" ]; then
    continue
  fi
  
  TEXT=$(extract_text_fields "$file")
  
  for pattern in "${CRITICAL_PATTERNS[@]}"; do
    # Skip semicolon check for now - too many false positives from JSON
    if [ "$pattern" = ";" ]; then
      # Check only in extracted text, not raw JSON
      MATCHES=$(echo "$TEXT" | grep -n "$pattern" 2>/dev/null || true)
    else
      MATCHES=$(echo "$TEXT" | grep -n "$pattern" 2>/dev/null || true)
    fi
    
    if [ -n "$MATCHES" ]; then
      echo -e "${RED}✗ FAIL${NC}: '$pattern' found in $file"
      echo "$MATCHES" | head -3 | sed 's/^/    /'
      ((ERRORS++))
    fi
  done
done

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ No critical patterns found${NC}"
fi
echo ""

# Check for warning patterns
echo "Checking for WARNING patterns (review recommended):"
echo "----------------------------------------"
for file in $DATA_FILES; do
  if [ ! -f "$file" ]; then
    continue
  fi
  
  TEXT=$(extract_text_fields "$file")
  
  for pattern in "${WARNING_PATTERNS[@]}"; do
    MATCHES=$(echo "$TEXT" | grep -in "$pattern" 2>/dev/null || true)
    
    if [ -n "$MATCHES" ]; then
      echo -e "${YELLOW}⚠ WARN${NC}: '$pattern' found in $file"
      echo "$MATCHES" | head -2 | sed 's/^/    /'
      ((WARNINGS++))
    fi
  done
done

if [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✓ No warning patterns found${NC}"
fi
echo ""

# Summary
echo "========================================"
echo "Summary"
echo "========================================"
echo "Critical errors: $ERRORS"
echo "Warnings: $WARNINGS"
echo ""

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}FAILED${NC}: Fix critical errors before deploy"
  exit 1
else
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}PASSED WITH WARNINGS${NC}: Review flagged content"
  else
    echo -e "${GREEN}PASSED${NC}: Content looks clean"
  fi
  exit 0
fi
