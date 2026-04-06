#!/bin/bash
# SessionStart hook for CC-Island
# Read full JSON from stdin and forward to HTTP server
INPUT=$(cat)
curl -s -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  > /dev/null 2>&1