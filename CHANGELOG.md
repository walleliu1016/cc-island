# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

#### 双窗口统一架构
- 灵动岛窗口 + 桌面窗口同时运行，共享 Rust 后端状态，各自独立轮询
- 灵动岛（main）：始终可见，顶部悬浮条，折叠/展开，快速处理权限弹窗
- 桌面窗（desktop）：侧边栏会话管理 + 聊天 + 活动时间线，隐藏式关闭（不销毁）
- 窗口间通过 Tauri event 同步状态（`popup-resolved`、`desktop-window-state`）

#### 桌面窗口完整功能
- 侧边栏：三 Tab（活动/空闲/历史）、搜索、键盘导航（↑↓ Enter Esc）
- 会话操作：置顶、通知角标、相对时间、悬停操作按钮
- 聊天 + 命令历史时间线（Layout C：左聊天右活动列表）
- 权限请求浮层：半透明遮罩 + 300s 倒计时 + Allow/Deny 按钮
- 活动项 hover 弹窗：自适应方向（右/左），显示详情 + 执行耗时
- 最大/最小/关闭窗口控件，最大化图标切换
- 云连接状态指示器

### Fixes

#### PermissionRequest 竞态条件自动拒绝
- PreToolUse（非阻塞）和 PermissionRequest（阻塞）并发到达时，`cancel_session_popups` 在非阻塞 handler 中取消了刚创建的权限弹窗
- 新增 10 秒宽限期（`CANCEL_GRACE_PERIOD`），跳过最近创建的弹窗，防止误取消
- `WaitingContext` 新增 `created_at` 字段用于精确计算弹窗年龄
- 弹窗生命周期事件增加 tracing 诊断日志

### Technical
- `lib.rs`：新增 `desktop_window_open` 状态字段、4 个窗口命令（`get_window_label`/`open_desktop_window`/`close_desktop_window`/`get_desktop_window_state`）
- `activity_store.rs`：新增 `duration_ms` 列，`update_activity_result` 自动计算耗时
- `DesktopLayout.tsx`：新建 ~850 行桌面窗口完整布局（侧边栏 + 聊天 + 时间线 + 权限浮层）
- `IslandLayout.tsx`：从 App.tsx 提取灵动岛 UI
- `App.tsx`：简化为窗口标签路由（`waitForLabel` → IslandLayout / DesktopLayout）
- `appStore.ts`：移除 `LayoutMode`，新增 `windowLabel`/`isDesktopWindowOpen` 状态
- `capabilities/default.json`：双窗口权限（minimize/maximize/show/hide/event）
- `vite.config.ts`：排除 `.claude/` 目录防止 inotify ENOSPC
- 删除死代码 `DesktopMode.tsx`
- 新增设计参考文件 `preview-desktop-ui.html`、`preview-dual-window.html`
- `popup_queue.rs`：新增 `created_at: Instant` 字段、模块级 `CANCEL_GRACE_PERIOD` 常量
- `http_server.rs`：阻塞弹窗创建/解析/超时路径增加日志

### Documentation
- WebSocket → Socket.IO 迁移设计文档（`docs/superpowers/plans/2026-06-18-websocket-to-socketio.md`）

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