# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Development (hot reload) - 必须使用pnpm tauri dev启动，不能用cargo run
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

**重要：** Desktop启动方式
- ✅ `pnpm tauri dev` - 完整开发环境（前端Vite + 后端Tauri）
- ❌ `cargo run` - 只有后端，前端缺失，窗口会显示"Connection refused"错误

## Service Ports (固定端口)

| 服务 | 端口 | 说明 |
|------|------|------|
| Desktop HTTP Server | 17527 | Claude Code hooks接收端口 |
| Cloud Server WebSocket | 17528 | Desktop/Mobile连接端口 |
| Cloud Server HTTP API | 17529 | 状态查询API端口 |
| APM Server HTTP | 17530 | APM 数据接收和查询端口 |
| APM Server OTLP | 17531 | OTLP 协议接收端口 |
| Desktop Vite (dev) | 1420 | Tauri dev前端热更新 |
| **Mobile H5 Vite** | **3001** | Mobile开发服务器（固定） |

**注意：** Mobile H5端口固定为3001，不要修改 `mobile-app/vite.config.ts` 中的端口配置。

## Architecture Overview

CC-Island is a Tauri 2.x desktop app that monitors multiple Claude Code terminal instances via HTTP hooks, with optional cloud relay for mobile remote access.

**Tech Stack:**
- Frontend: React 18 + TypeScript + Zustand + Framer Motion + Tailwind CSS + uPlot
- Backend: Rust + Axum HTTP server (port 17527) + Tokio async runtime
- Cloud Server: Rust + PostgreSQL + WebSocket + LISTEN/NOTIFY
- APM Server: Rust + Axum + GreptimeDB HTTP API + OTLP

**Core Data Flow (Desktop):**
```
Claude Code terminals → HTTP POST /hook (port 17527) → Rust backend → Frontend (polling via Tauri IPC)
```

**Core Data Flow (Cloud Relay):**
```
Desktop → WebSocket → Cloud Server → PostgreSQL → NOTIFY → Other Instance → Mobile
```

**Core Data Flow (APM):**
```
Desktop (APM Collector) → HTTP POST → APM Server → GreptimeDB → Frontend ApmView / Grafana
```

**Key Components:**

| Layer | File | Purpose |
|-------|------|---------|
| HTTP API | `src-tauri/src/http_server.rs` | Receives Claude Code hooks, handles blocking (PermissionRequest/Ask) and non-blocking events |
| State | `src-tauri/src/lib.rs` | Global `SHARED_STATE` (Arc<RwLock<AppState>>) shared between HTTP server and Tauri commands |
| Popup Queue | `src-tauri/src/popup_queue.rs` | Manages pending popups with oneshot channels for blocking responses |
| Instance Manager | `src-tauri/src/instance_manager.rs` | Tracks Claude session lifecycle (SessionStart → SessionEnd) |
| Chat History | `src-tauri/src/chat_messages.rs` | Stores per-session message history (user, assistant, tool calls) |
| APM Collector | `src-tauri/src/apm/collector.rs` | Collects APM data (hooks, messages) and sends to APM Server |
| APM Sender | `src-tauri/src/apm/sender.rs` | HTTP POST to APM Server with tenant headers (X-User-ID, X-Device-ID) |
| Platform Jump | `src-tauri/src/platform/macos.rs` | AppleScript to activate terminal window |
| Frontend State | `src/stores/appStore.ts` | Zustand store for instances, popups, activities |
| APM API | `src/services/apmApi.ts` | APM Server HTTP client for metrics queries |
| UI | `src/App.tsx` | Click to expand, three-column header layout, ApmView toggle |
| Instance List | `src/components/InstanceList.tsx` | Displays instances with inline Allow/Deny buttons |
| Chat View | `src/components/ChatView.tsx` | Shows message history with code blocks |
| Apm View | `src/components/ApmView/index.tsx` | APM monitoring dashboard with charts |
| Token Chart | `src/components/ApmView/TokenChart.tsx` | uPlot chart for token usage visualization |
| Cost Chart | `src/components/ApmView/CostChart.tsx` | uPlot chart for cost visualization |
| Settings | `src/components/Settings.tsx` | Tabbed interface for Hooks, General, Remote, and APM settings |
| Status Icons | `src/components/StatusIcons.tsx` | Pixel-style icons (crab, spinner, indicators) |
| Notch Shape | `src/components/NotchShape.tsx` | SVG path generator for Dynamic Island shape |

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

## UI Interaction Patterns

**Click to Expand:**
- Click the island header to toggle expanded state
- Click outside window or press ESC to collapse
- Settings/ChatView back buttons return to instance list (keep expanded)

**Three-Column Header Layout:**
- Left (w-10): ClaudeCrabIcon + status indicator
- Center (flex-1): Status text or project name
- Right (w-10): Menu button (when expanded) or status icon

**Header Text Display (Priority):**

| State | Display |
|-------|---------|
| ChatView mode | Project name (selected instance) |
| Active processing | Tool name / "Thinking" / "需要授权" |
| Expanded, idle | Product name (configurable via `productName` in tauri.conf.json) |
| Collapsed, session notification | "项目名已启动" / "项目名已停止" (3 seconds) |
| Collapsed, idle | Empty |

**Session Notifications:**
- SessionStart → Shows "项目名已启动" in collapsed header center (3s)
- SessionEnd → Shows "项目名已停止" in collapsed header center (3s)

**Window Dimensions (Unified):**
- Collapsed: 300x38px
- Expanded: 480x400px
- Content containers must use consistent padding (px-2 pb-3) and height (h-[360px]) to avoid width/height mismatches

**Navigation Flow:**
1. Collapsed island shows status summary
2. Click → Expanded instance list
3. Click instance row → ChatView (shows message history)
4. ChatView Back button → Return to instance list
5. Settings button → Settings modal (Hooks/General tabs)
6. Settings Back button → Return to instance list

## Window Properties

Tauri window config in `src-tauri/tauri.conf.json`: always on top, transparent, frameless, 44px capsule height.

## Frontend Polling

Frontend polls every 100ms via Tauri IPC commands (`get_instances`, `get_popups`, `get_recent_activities`, `get_session_notification`). Tool activities have 2-second display window to catch fast executions.

## Product Name Customization

The product name displayed in expanded idle state is configurable:

1. **Local Build**: Edit `src-tauri/tauri.conf.json`:
   ```json
   {
     "productName": "Ease-Island",
     ...
   }
   ```

2. **GitHub Release**: Use workflow dispatch with `product_name` input:
   - Go to Actions → Build and Release → Run workflow
   - Enter custom product name (e.g., "Ease-Island")
   - Default is "CC-Island" if not specified

3. **Fork Customization**: After forking, modify `productName` in config directly.

## Key Components (Updated)

| Layer | File | Purpose |
|-------|------|---------|
| HTTP API | `src-tauri/src/http_server.rs` | Receives Claude Code hooks, handles blocking (PermissionRequest/Ask) and non-blocking events, sets session notifications |
| State | `src-tauri/src/lib.rs` | Global `SHARED_STATE` (Arc<RwLock<AppState>>) with `session_notification` field for start/end alerts |
| Frontend | `src/App.tsx` | Handles session notification display, product name fetch via `get_product_name` command |

## Cloud Server (Multi-Instance Architecture)

The cloud-server component enables remote monitoring from mobile devices, with multi-instance support for high availability.

**Architecture:**
- Each instance maintains local connection state in memory
- Cross-instance messages via PostgreSQL LISTEN/NOTIFY
- Messages stored in `pending_messages` table, retrieved atomically with DELETE RETURNING

**Key Cloud Server Components:**

| Layer | File | Purpose |
|-------|------|---------|
| Migration | `cloud-server/migrations/004_pending_messages.sql` | pending_messages table for cross-instance routing |
| DB Repo | `cloud-server/src/db/pending_message.rs` | INSERT/SELECT/DELETE pending messages + NOTIFY |
| NotifyListener | `cloud-server/src/ws/notify_listener.rs` | LISTEN PostgreSQL NOTIFY, handle incoming notifications |
| ConnectionRouter | `cloud-server/src/ws/router.rs` | Local connection state, has_mobile_subscribers/has_desktop_connection methods |
| MessageHandler | `cloud-server/src/ws/handler.rs` | NOTIFY path for cross-instance message routing |

**Cross-Instance Message Flow:**
```
Desktop sends HookMessage → Check local mobile subscribers → 
  If found: Direct memory broadcast (fast path)
  If not found: INSERT pending_messages + NOTIFY (slow path) →
    Other instance receives NOTIFY → Check if target belongs to them →
    get_and_delete (atomic) → Deliver → Delete
```

**Cleanup:** Stale messages (> 5 minutes) deleted every minute by cleanup task.

### WebSocket 心跳机制

Cloud Server 使用三层超时防护确保僵尸连接被及时清理：

| 机制 | 超时时间 | 作用层级 | 检测目标 |
|------|---------|---------|---------|
| AUTH_TIMEOUT | 30 秒 | 应用层认证 | 未认证连接 |
| READ_TIMEOUT | 120 秒 | 应用层数据 | 无响应连接 |
| TCP Keepalive | 60 秒 + 10 秒 × 3 次 | 系统网络层 | 网络中断僵尸 |

**客户端接入要求：**
- Desktop/Mobile 连接后必须 **30 秒内完成认证**
- 认证后应 **每 30 秒发送一次 Ping** 保持连接活跃
- 任何 WebSocket 消息（Text/Ping/Pong/Close）都会重置 120 秒超时计时器

**关键文件：**
| 文件 | 作用 |
|------|------|
| `cloud-server/src/ws/connection.rs` | AUTH_TIMEOUT/READ_TIMEOUT 常量，超时检测逻辑 |
| `cloud-server/src/ws/server.rs` | TCP Keepalive 设置 (socket2) |
| `cloud-server/docs/fd-leak-fix.md` | FD 泄漏修复方案文档 |

## Server Binary (子命令模式)

Server Binary (`cc-island-server`) 是独立的静态链接二进制文件，完全无 UI 依赖，使用子命令模式 CLI。

**子命令设计**：

| 子命令 | 用途 | 持久化 |
|--------|------|--------|
| `run` | 临时启动 | ❌ 不保存配置 |
| `config` | 配置管理 | ✅ 持久化 |
| `pair-info` | 显示配对信息 | - |
| `device-token` | 仅显示token | - |

**参数优先级**：
- `run`: CLI参数 > 配置文件 > 默认值（临时，不修改配置文件）
- `config set`: CLI参数直接保存（永久）
- 无子命令: 默认为 `run`

**关键文件**：
| 文件 | 作用 |
|------|------|
| `src-tauri-server/src/main.rs` | 子命令解析逻辑 |
| `src-tauri/src/lib.rs` | `run_background_temporary`, `config_set`, `config_reset` 函数 |

**构建命令**：
```bash
# musl static build (推荐用于服务器)
cargo build --release --bin cc-island-server --target x86_64-unknown-linux-musl
```

**注意**：
- Server 构建需要禁用 default features（避免 GTK 依赖）
- build.rs 使用 `#[cfg(feature = "desktop")]` 条件编译
- Desktop 模式保持 flag 模式（不改动）

## APM Server

APM Server 是独立的 Rust 服务，接收 Desktop 发送的使用数据并存储到 GreptimeDB。

**架构**：
```
Desktop APM Collector → HTTP POST → APM Server (17530) → GreptimeDB (4000)
```

**关键文件**：

| 文件 | 作用 |
|------|------|
| `apm-server/src/main.rs` | 服务入口，端口配置 |
| `apm-server/src/config.rs` | 配置管理（GreptimeDB 地址、数据保留等） |
| `apm-server/src/greptime/client.rs` | GreptimeDB HTTP SQL API 客户端 |
| `apm-server/src/greptime/schema.rs` | 表结构 DDL（含租户字段） |
| `apm-server/src/greptime/flows.rs` | Flow SQL 聚合定义 |
| `apm-server/src/handler/hooks.rs` | POST /api/hooks 接收 Hook 数据 |
| `apm-server/src/handler/query.rs` | GET /api/query SQL 查询代理（自动租户过滤） |
| `apm-server/src/handler/sse.rs` | GET /api/stream SSE 实时推送 |
| `apm-server/src/tenant.rs` | 租户管理（user_id + device_id 隔离） |

**环境变量配置**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APM_BIND_HOST` | 监听地址 | `0.0.0.0` |
| `APM_HTTP_PORT` | HTTP 端口 | `17530` |
| `APM_GREPTIMEDB_HOST` | GreptimeDB 地址 | `localhost` |
| `APM_GREPTIMEDB_DATABASE` | 数据库名 | `public` |
| `APM_RETENTION_DAYS` | 数据保留天数 | `30` |
| `APM_OTLP_EXPORT_URL` | OTLP 导出地址（可选） | - |

**租户隔离**：
- 所有表包含 `user_id` 和 `device_id` 字段
- `user_id` 默认为 hostname，可在 Desktop Settings 配置
- `device_id` 自动生成，与 `device_token` 一致
- 查询时自动注入租户过滤条件

**启动命令**：
```bash
# 编译
cd apm-server
cargo build --release

# 启动（需先部署 GreptimeDB）
APM_GREPTIMEDB_HOST=localhost ./apm-server
```

## APM Desktop 配置

Desktop Settings 新增 "APM" Tab：

**配置项**：
| 配置 | 说明 |
|------|------|
| `apm_enabled` | 启用 APM 监控 |
| `apm_server_url` | APM Server 地址（如 `http://localhost:17530`） |
| `apm_user_id` | 用户标识（默认 hostname，可自定义） |

**配置文件位置**：`~/.cc-island/settings.json`

**Background 模式**：
- APM Collector 在 `AppState::new()` 中初始化
- Background 模式自动包含 APM 收集功能
- 无需 UI 窗口，数据发送到 APM Server 后通过 Grafana 查看