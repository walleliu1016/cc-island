# Changelog

All notable changes to this project will be documented in this file.

## [0.3.4] - 2025-05-21

### Features

#### Desktop Mode (桌面模式)
- Add desktop mode as a normal draggable window application
- Window header with minimize/close buttons
- Support window drag and resize
- Content fills entire window, responsive layout
- Default window size: 480x500 (larger than island mode)
- "灵动岛" button to switch back to island mode

#### Execution History Display (执行历史)
- Display real tool execution history from SQLite database
- ActivityPopup shows last 10 activities with status icons
- Smart positioning: auto-adjust if space limited below
- Click outside to close popup
- Status differentiation: ✓ success (green), ✗ error (red), ● running (green)
- Hover tooltip shows full content and result

#### Session Card Improvements (会话卡片)
- Two-row layout with project name, status, running duration
- Status indicator with color coding
- Tool activity history tags (last 3 shown)
- "+N" button to expand full history
- Chat and Jump terminal buttons

### Fixes

- Fix window size reset when clicking ChatView in desktop mode
- Fix ActivityPopup not visible in island mode (Portal rendering)
- Fix activities data not populated in HTTP API
- Proper overflow handling for popup display
- Consistent Chinese UI text: "灵动岛模式" vs "桌面模式"

### Technical

- Add `activities` field to ClaudeInstanceDisplay struct
- Populate activities from ACTIVITY_STORE in both IPC and HTTP API
- Use React Portal for ActivityPopup to escape overflow constraints
- Dynamic maxHeight calculation for popup positioning
- Window resize optimization: only set initial size, preserve user adjustments

---

## [0.2.5] - 2025-05-20

### Features
- Initial session display improvements
- Archive tab for folded/ended sessions
- Status color coding

### Fixes
- Various UI polish and bug fixes

---

For full changelog, see [GitHub Releases](https://github.com/walleliu1016/cc-island/releases).