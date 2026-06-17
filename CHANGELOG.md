# Changelog

All notable changes to this project will be documented in this file.

## [0.3.9] - 2026-06-17

### Features

#### 统一会话管理 & 历史 Tab
- 三 Tab 布局：活动 / 空闲 / 历史，所有会话持久化到 `sessions.json`
- 历史 tab 支持重启已结束的会话（`claude --resume <id>`）
- RestartDialog：终端选择、多选下拉框选择 Claude CLI 参数、预设保存/管理
- 空闲 tab 不再折叠，平铺展示与活动 tab 一致

#### 死进程自动检测
- 每 5 秒检查实例 PID 是否存活
- Unix 使用 `libc::kill(pid, 0)`，Windows 使用 `OpenProcess`
- 死进程自动标记为 Ended 并移入历史 tab

### Fixes
- 岛模式下无活动会话时隐藏分组标签 → 有历史会话即显示
- restart_session 防御性清理：同时从 history_store 和 InstanceManager 移除
- SessionEnd 增加 tracing 日志便于调试

### Technical
- 新增 `history_store.rs`：统一 sessions.json 持久化（upsert/get_ended/cleanup）
- 新增 `restart_config_store.rs`：重启参数持久化配置
- `appStore.ts` 新增 `historySessions` 状态
- `libc` 依赖用于 Unix 进程存活检测

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