# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Development (hot reload)
pnpm tauri:dev

# Build release
pnpm tauri:build

# Build debug (for testing)
pnpm tauri build --debug

# Check Rust backend
cargo check --manifest-path src-tauri/Cargo.toml

# Check TypeScript frontend
pnpm exec tsc --noEmit
```

## Architecture Overview

CC-Island is a Tauri 2.x desktop app that monitors multiple Claude Code terminal instances via HTTP hooks.

**Tech Stack:**
- Frontend: React 18 + TypeScript + Zustand + Framer Motion + Tailwind CSS
- Backend: Rust + Axum HTTP server (port 17527) + Tokio async runtime

**Core Data Flow:**
```
Claude Code terminals → HTTP POST /hook (port 17527) → Rust backend → Frontend (polling via Tauri IPC)
```

**Key Components:**

| Layer | File | Purpose |
|-------|------|---------|
| HTTP API | `src-tauri/src/http_server.rs` | Receives Claude Code hooks, handles blocking (PermissionRequest/Ask) and non-blocking events |
| State | `src-tauri/src/lib.rs` | Global `SHARED_STATE` (Arc<RwLock<AppState>>) shared between HTTP server and Tauri commands |
| Popup Queue | `src-tauri/src/popup_queue.rs` | Manages pending popups with oneshot channels for blocking responses |
| Instance Manager | `src-tauri/src/instance_manager.rs` | Tracks Claude session lifecycle (SessionStart → SessionEnd) |
| Platform Jump | `src-tauri/src/platform/macos.rs` | AppleScript to activate terminal window |
| Frontend State | `src/stores/appStore.ts` | Zustand store for instances, popups, activities |
| UI | `src/App.tsx` | Auto-expand on pending popups, hover expand for full list |

## Claude Code Hooks

**SessionStart is special:** Uses `command` type hook (not HTTP) because Claude may not have network ready at startup. See `hooks/cc-island-session-start.sh`.

**Blocking events** (wait for user response via oneshot channel):
- `PermissionRequest` → 300s timeout, returns `{decision: "allow"|"deny"}`
- `Notification` with `type: "ask"` → 120s timeout, returns `{answer: string, answers: string[][]}`

**Non-blocking events** (immediate return):
- PreToolUse, PostToolUse, Stop, SessionEnd, etc.

## Testing Hooks

```bash
# Test SessionStart
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"SessionStart","session_id":"test-1","cwd":"/path/to/project"}'

# Test PermissionRequest (blocks until responded)
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"PermissionRequest","session_id":"test-1","cwd":"/path","permission_data":{"tool_name":"Bash","action":"npm test"}}'

# View state
curl http://localhost:17527/instances | jq
curl http://localhost:17527/popups | jq
```

## AskUserQuestion Format

AskUserQuestion comes as PermissionRequest with `tool_name: "AskUserQuestion"`. Parse questions from `tool_input.questions`:

```json
{
  "hook_event_name": "PermissionRequest",
  "tool_name": "AskUserQuestion",
  "tool_input": {
    "questions": [{
      "header": "Framework",
      "question": "Which framework?",
      "multiSelect": false,
      "options": [{"label": "React", "description": "..."}]
    }]
  }
}
```

Response: `{answers: [["React"]]}` (array per question).

## Frontend Polling

Frontend polls every 100ms via Tauri IPC commands (`get_instances`, `get_popups`, `get_recent_activities`). Tool activities have 2-second display window to catch fast executions.

## Window Properties

Tauri window config in `src-tauri/tauri.conf.json`: always on top, transparent, frameless, 44px capsule height.