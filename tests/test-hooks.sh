#!/bin/bash
# CC-Island Hooks Test Script
# Usage: ./test-hooks.sh [session_id]

set -e

BASE_URL="http://localhost:17527"
SESSION_ID="${1:-test-session-$$}"
PROJECT_DIR="${2:-/tmp/test-project}"

echo "=== CC-Island Hooks Test ==="
echo "Session ID: $SESSION_ID"
echo "Project Dir: $PROJECT_DIR"
echo ""

# Check if server is running
echo "1. Checking HTTP server..."
if curl -s "$BASE_URL/instances" > /dev/null 2>&1; then
    echo "   ✓ Server is running"
else
    echo "   ✗ Server is not running. Please start CC-Island first."
    exit 1
fi
echo ""

# Test SessionStart
echo "2. Testing SessionStart..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"$SESSION_ID\",\"cwd\":\"$PROJECT_DIR\"}"
echo ""
echo "   ✓ SessionStart sent"
echo ""

# Check instance created
echo "3. Checking instance created..."
INSTANCE=$(curl -s "$BASE_URL/instances" | jq -r ".[] | select(.session_id == \"$SESSION_ID\") | .session_id")
if [ "$INSTANCE" = "$SESSION_ID" ]; then
    echo "   ✓ Instance created: $SESSION_ID"
else
    echo "   ✗ Instance not found"
fi
echo ""

# Test PreToolUse
echo "4. Testing PreToolUse..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"PreToolUse\",\"session_id\":\"$SESSION_ID\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm test\"}}"
echo ""
echo "   ✓ PreToolUse sent"
echo ""

# Test PostToolUse
echo "5. Testing PostToolUse..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"$SESSION_ID\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm test\"},\"tool_result\":\"All tests passed\"}"
echo ""
echo "   ✓ PostToolUse sent"
echo ""

# Test UserPromptSubmit
echo "6. Testing UserPromptSubmit..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"$SESSION_ID\",\"prompt\":\"Write a hello world program\"}"
echo ""
echo "   ✓ UserPromptSubmit sent"
echo ""

# Test PermissionRequest
echo "7. Testing PermissionRequest (blocking)..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"PermissionRequest\",\"session_id\":\"$SESSION_ID\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"rm -rf /tmp/test\"},\"permission_data\":{\"tool_name\":\"Bash\",\"action\":\"Delete test directory\"}}" &
PERM_PID=$!
sleep 1
echo "   Checking popup..."
POPUP_ID=$(curl -s "$BASE_URL/popups" | jq -r ".[] | select(.session_id == \"$SESSION_ID\" and .type == \"permission\") | .id" | head -1)
if [ -n "$POPUP_ID" ]; then
    echo "   ✓ Permission popup created: $POPUP_ID"
    # Respond to popup
    curl -s -X POST "$BASE_URL/response" \
        -H "Content-Type: application/json" \
        -d "{\"popup_id\":\"$POPUP_ID\",\"decision\":\"allow\"}"
    echo ""
    echo "   ✓ Permission response sent: allow"
else
    echo "   ✗ Permission popup not found"
fi
wait $PERM_PID 2>/dev/null || true
echo ""

# Test AskUserQuestion
echo "8. Testing AskUserQuestion (blocking)..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"PermissionRequest\",\"session_id\":\"$SESSION_ID\",\"tool_name\":\"AskUserQuestion\",\"tool_input\":{\"questions\":[{\"header\":\"Framework\",\"question\":\"Which framework?\",\"multiSelect\":false,\"options\":[{\"label\":\"React\",\"description\":\"Facebook's UI library\"},{\"label\":\"Vue\",\"description\":\"Progressive framework\"}]}]}}" &
ASK_PID=$!
sleep 1
echo "   Checking popup..."
ASK_POPUP_ID=$(curl -s "$BASE_URL/popups" | jq -r ".[] | select(.session_id == \"$SESSION_ID\" and .type == \"ask\") | .id" | head -1)
if [ -n "$ASK_POPUP_ID" ]; then
    echo "   ✓ Ask popup created: $ASK_POPUP_ID"
    # Respond to popup
    curl -s -X POST "$BASE_URL/response" \
        -H "Content-Type: application/json" \
        -d "{\"popup_id\":\"$ASK_POPUP_ID\",\"answers\":[[\"React\"]]}"
    echo ""
    echo "   ✓ Ask response sent: React"
else
    echo "   ✗ Ask popup not found"
fi
wait $ASK_PID 2>/dev/null || true
echo ""

# Test Stop
echo "9. Testing Stop..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"Stop\",\"session_id\":\"$SESSION_ID\"}"
echo ""
echo "   ✓ Stop sent"
echo ""

# Test SessionEnd
echo "10. Testing SessionEnd..."
curl -s -X POST "$BASE_URL/hook" \
    -H "Content-Type: application/json" \
    -d "{\"hook_event_name\":\"SessionEnd\",\"session_id\":\"$SESSION_ID\"}"
echo ""
echo "   ✓ SessionEnd sent"
echo ""

# Final status check
echo "11. Final instance status..."
STATUS=$(curl -s "$BASE_URL/instances" | jq -r ".[] | select(.session_id == \"$SESSION_ID\") | .status")
echo "   Status: $STATUS"
echo ""

echo "=== Test Complete ==="
echo ""
echo "To test with a custom session ID:"
echo "  ./test-hooks.sh my-custom-session /path/to/project"