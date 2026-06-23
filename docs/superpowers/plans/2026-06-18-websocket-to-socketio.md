# WebSocket → Socket.IO 迁移实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三层 WebSocket 架构全部迁移到 Socket.IO，利用 socketioxide/postgres/rust-socketio/socket.io-client 内置机制替代自建基础设施。

**Architecture:** Cloud Server 用 socketioxide + socketioxide-postgres adapter；Desktop Client 用 rust-socketio；Mobile App 用 socket.io-client。按 /, /hooks, /chat, /sessions, /devices 五个 namespace 组织事件，用 rooms 替代 HashMap 路由，用 middleware 处理认证。

**Tech Stack:** socketioxide 0.18, socketioxide-postgres 0.1 (sqlx driver), rust-socketio 0.6, socket.io-client 4.8

---

## File Structure

```
cloud-server/src/ws/
├── mod.rs                  # 修改：新模块结构
├── server.rs               # 重写：SocketIo builder
├── auth.rs                 # 新增：认证 middleware
├── events.rs               # 新增：事件 payload 类型（替代 messages.rs）
├── handlers/
│   ├── mod.rs              # 新增
│   ├── hooks.rs            # 新增：/hooks namespace
│   ├── chat.rs             # 新增：/chat namespace
│   ├── sessions.rs         # 新增：/sessions namespace
│   └── devices.rs          # 新增：/devices namespace（连接/断开生命周期）
├── connection.rs           # 删除
├── router.rs               # 删除
├── handler.rs              # 删除
└── notify_listener.rs      # 删除

cloud-server/src/
├── messages.rs             # 删除（CloudMessage enum 不再需要）
├── main.rs                 # 修改：adapter 初始化
└── config.rs               # 不变

cloud-server/
├── Cargo.toml              # 修改：替换依赖
└── migrations/
    └── 004_pending_messages.sql  # 删除

src-tauri/src/
├── cloud_client.rs         # 重写
├── lib.rs                  # 修改
└── Cargo.toml              # 修改

mobile-app/src/
├── hooks/
│   └── useSocketIO.ts      # 新增（替代 useAllDevicesWebSocket.ts）
├── types.ts                # 重写
└── App.tsx                 # 修改
```

---

### Task 1: 更新 cloud-server 依赖

**Files:**
- Modify: `cloud-server/Cargo.toml`

- [ ] **Step 1: 替换 WebSocket 依赖为 Socket.IO 依赖**

```toml
# 删除
# tokio-tungstenite = "0.21"
# futures-util = "0.3"
# socket2 = "0.5"

# 新增
socketioxide = { version = "0.18", features = ["tracing"] }
socketioxide-postgres = { version = "0.1", features = ["sqlx"] }
```

- [ ] **Step 2: 运行 cargo check 确认依赖解析**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

Expected: 依赖下载成功，无编译错误（可能会有 unused import warning，后续任务消除）

- [ ] **Step 3: 提交**

```bash
git add cloud-server/Cargo.toml cloud-server/Cargo.lock
git commit -m "chore(cloud-server): replace tokio-tungstenite with socketioxide + postgres adapter"
```

---

### Task 2: 更新 desktop client 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 替换依赖**

```toml
# 删除
# tokio-tungstenite = { version = "0.26", features = ["native-tls"] }
# native-tls = "0.2"
# futures-util = "0.3"

# 新增
rust_socketio = { version = "0.6", features = ["async"] }
```

- [ ] **Step 2: 验证编译**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 依赖解析成功

- [ ] **Step 3: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(desktop): replace tokio-tungstenite with rust-socketio"
```

---

### Task 3: 更新 mobile-app 依赖

**Files:**
- Modify: `mobile-app/package.json`

- [ ] **Step 1: 添加 socket.io-client**

```bash
cd mobile-app && pnpm add socket.io-client@^4.8
```

- [ ] **Step 2: 提交**

```bash
git add mobile-app/package.json mobile-app/pnpm-lock.yaml
git commit -m "chore(mobile): add socket.io-client"
```

---

### Task 4: 创建事件 payload 类型定义

**Files:**
- Create: `cloud-server/src/ws/events.rs`
- Delete: `cloud-server/src/messages.rs`

- [ ] **Step 1: 创建 events.rs**

```rust
use serde::{Deserialize, Serialize};

// --- 保留原有数据类型（不变） ---
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageType { User, Assistant, ToolCall, ToolResult, Thinking, Interrupted }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageData {
    pub id: String,
    pub session_id: String,
    pub message_type: MessageType,
    pub content: String,
    pub tool_name: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub token: String,
    pub hostname: Option<String>,
    pub registered_at: Option<String>,
    pub online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub session_id: String,
    pub project_name: String,
    pub status: String,
    pub current_tool: Option<String>,
    pub created_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HookType {
    SessionStart, SessionEnd, PreToolUse, PostToolUse,
    PostToolUseFailure, PermissionRequest, Elicitation, Notification,
    Stop, UserPromptSubmit, PreCompact, PostCompact,
    SubagentStart, SubagentStop, StatusUpdate,
}

// --- Socket.IO 事件 payload ---

/// /hooks namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPayload {
    pub device_token: String,
    pub session_id: String,
    pub hook_type: HookType,
    pub hook_body: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResponsePayload {
    pub device_token: String,
    pub session_id: String,
    pub decision: Option<String>,
    pub answers: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupResolvedPayload {
    pub device_token: String,
    pub popup_id: String,
    pub session_id: String,
    pub source: String,
    pub decision: Option<String>,
    pub answers: Option<Vec<Vec<String>>>,
}

/// /chat namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryPayload {
    pub device_token: String,
    pub session_id: String,
    pub messages: Vec<ChatMessageData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestChatHistoryPayload {
    pub device_token: String,
    pub session_id: String,
    pub limit: Option<u32>,
}

/// /sessions namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSessionListPayload {
    pub device_token: String,
    pub mobile_conn_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListResponsePayload {
    pub device_token: String,
    pub mobile_conn_id: String,
    pub sessions: Vec<ClaudeSession>,
}

/// /devices namespace events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceOnlinePayload {
    pub device: DeviceInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceOfflinePayload {
    pub device_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceListPayload {
    pub devices: Vec<DeviceInfo>,
}
```

- [ ] **Step 2: 删除 messages.rs**

```bash
rm cloud-server/src/messages.rs
```

- [ ] **Step 3: 运行 cargo check 确认类型定义无错误**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

Expected: 编译通过（可能有无用代码警告，后续任务逐步使用）

- [ ] **Step 4: 提交**

```bash
git add cloud-server/src/ws/events.rs && git rm cloud-server/src/messages.rs
git commit -m "refactor(cloud-server): replace CloudMessage enum with Socket.IO event payloads"
```

---

### Task 5: 创建认证 middleware

**Files:**
- Create: `cloud-server/src/ws/auth.rs`

- [ ] **Step 1: 创建 auth.rs**

```rust
use socketioxide::extract::{SocketRef, Data};
use socketioxide::adapter::Adapter;
use crate::db::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopAuth {
    device_token: String,
    hostname: Option<String>,
    device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MobileAuth {
    device_tokens: Vec<String>,
}

struct AuthState {
    pub connection_type: ConnectionType,
    pub device_token: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionType { Desktop, Mobile }

pub async fn auth_middleware<A: Adapter>(s: SocketRef<A>, Data(data): Data<serde_json::Value>) -> Result<(), socketioxide::extract::Error> {
    let repo = s.extensions.get::<Repository>().expect("Repository not in extensions");
    let pool = s.extensions.get::<sqlx::PgPool>().expect("PgPool not in extensions");

    // 尝试解析 Desktop auth
    if let Ok(desktop) = serde_json::from_value::<DesktopAuth>(data.clone()) {
        let device_token = desktop.device_token.clone();
        let hostname = desktop.hostname.clone();

        // 验证设备
        match repo.get_device(&pool, &device_token).await {
            Ok(Some(_)) => {} // 已注册
            Ok(None) => {
                repo.register_device(&pool, &device_token, hostname.as_deref(), desktop.device_name.as_deref()).await.ok();
            }
            Err(_) => {
                s.emit("auth_error", &serde_json::json!({"reason": "db error"})).await.ok();
                let _ = s.disconnect();
                return Err(socketioxide::extract::Error::new("auth failed"));
            }
        }

        s.extensions.insert(AuthState {
            connection_type: ConnectionType::Desktop,
            device_token: Some(device_token.clone()),
            hostname: hostname.clone(),
        });

        // 加入 device room
        s.join(format!("device:{}", device_token)).await.ok();

        // 回复认证成功
        s.emit("auth_success", &serde_json::json!({
            "device_id": device_token,
            "hostname": hostname,
        })).await.ok();

        // 通知所有订阅此设备的 mobile：上线
        s.within("/devices").broadcast().emit("online", &super::events::DeviceOnlinePayload {
            device: super::events::DeviceInfo {
                token: device_token,
                hostname,
                registered_at: None,
                online: true,
            },
        }).await.ok();

        return Ok(());
    }

    // 尝试解析 Mobile auth
    if let Ok(mobile) = serde_json::from_value::<MobileAuth>(data.clone()) {
        s.extensions.insert(AuthState {
            connection_type: ConnectionType::Mobile,
            device_token: None,
            hostname: None,
        });

        let conn_id = s.id.to_string();

        // 订阅设备 rooms
        for token in &mobile.device_tokens {
            s.join(format!("device:{}", token)).await.ok();
        }

        // 回复成功
        s.emit("auth_success", &serde_json::json!({
            "device_id": conn_id,
            "subscriptions": mobile.device_tokens,
        })).await.ok();

        return Ok(());
    }

    s.emit("auth_error", &serde_json::json!({"reason": "invalid auth payload"})).await.ok();
    let _ = s.disconnect();
    Err(socketioxide::extract::Error::new("auth failed"))
}
```

- [ ] **Step 2: 运行 cargo check**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

Expected: 编译通过，可能会有 `within` API 细节需要调整（与 socketioxide 实际 API 对齐）

- [ ] **Step 3: 提交**

```bash
git add cloud-server/src/ws/auth.rs
git commit -m "feat(cloud-server): add Socket.IO auth middleware for desktop/mobile"
```

---

### Task 6: 创建 /hooks namespace handler

**Files:**
- Create: `cloud-server/src/ws/handlers/mod.rs`
- Create: `cloud-server/src/ws/handlers/hooks.rs`

- [ ] **Step 1: 创建 handlers/mod.rs**

```rust
pub mod hooks;
pub mod chat;
pub mod sessions;
pub mod devices;
```

- [ ] **Step 2: 创建 handlers/hooks.rs**

```rust
use socketioxide::adapter::Adapter;
use socketioxide::extract::{SocketRef, Data};
use crate::db::Repository;
use crate::ws::events::*;

pub async fn on_hook<A: Adapter>(s: SocketRef<A>, Data(payload): Data<HookPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    // 持久化 session lifecycle 到 DB
    match &payload.hook_type {
        HookType::SessionStart => {
            let cwd = payload.hook_body.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let project_name = payload.hook_body.get("project_name").and_then(|v| v.as_str()).unwrap_or(cwd);
            repo.upsert_session(&payload.device_token, &payload.session_id, project_name, "idle").await.ok();
        }
        HookType::SessionEnd => {
            repo.end_session(&payload.session_id).await.ok();
        }
        HookType::PreToolUse => {
            let tool_name = payload.hook_body.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
            repo.update_session_status(&payload.session_id, "working", Some(tool_name)).await.ok();
        }
        HookType::PostToolUse | HookType::PostToolUseFailure => {
            repo.update_session_status(&payload.session_id, "idle", None).await.ok();
        }
        HookType::PermissionRequest | HookType::Elicitation => {
            repo.update_session_status(&payload.session_id, "waitingForApproval", None).await.ok();
        }
        HookType::Stop => {
            repo.update_session_status(&payload.session_id, "idle", None).await.ok();
        }
        HookType::UserPromptSubmit => {
            repo.update_session_status(&payload.session_id, "thinking", None).await.ok();
        }
        HookType::PreCompact => {
            repo.update_session_status(&payload.session_id, "compacting", None).await.ok();
        }
        HookType::PostCompact => {
            repo.update_session_status(&payload.session_id, "idle", None).await.ok();
        }
        _ => {}
    }

    // 广播到该设备的所有 mobile 订阅者
    s.within("/hooks")
        .to(format!("device:{}", payload.device_token))
        .emit("hook", &payload)
        .await
        .ok();
}

pub async fn on_hook_response<A: Adapter>(s: SocketRef<A>, Data(payload): Data<HookResponsePayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    // 转发到 desktop
    s.within("/hooks")
        .to(format!("device:{}", payload.device_token))
        .emit("hook:response", &payload)
        .await
        .ok();

    // 解决 popup（如果有关联）
    repo.resolve_popup_by_session(&payload.session_id, payload.decision.as_deref()).await.ok();
}

pub async fn on_popup_resolved<A: Adapter>(s: SocketRef<A>, Data(payload): Data<PopupResolvedPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    repo.resolve_popup(&payload.popup_id, payload.decision.as_deref(), &payload.source).await.ok();

    // 广播到所有订阅者
    s.within("/hooks")
        .to(format!("device:{}", payload.device_token))
        .emit("popup:resolved", &payload)
        .await
        .ok();
}

pub fn register_hooks_handlers<A: Adapter>(io: &socketioxide::Namespace<A>) {
    io.on("hook", on_hook::<A>);
    io.on("hook:response", on_hook_response::<A>);
    io.on("popup:resolved", on_popup_resolved::<A>);
}
```

- [ ] **Step 3: 编译检查**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

- [ ] **Step 4: 提交**

```bash
git add cloud-server/src/ws/handlers/
git commit -m "feat(cloud-server): add /hooks namespace handler (hook relay, responses, popups)"
```

---

### Task 7: 创建 /chat namespace handler

**Files:**
- Create: `cloud-server/src/ws/handlers/chat.rs`

- [ ] **Step 1: 创建 handlers/chat.rs**

```rust
use socketioxide::adapter::Adapter;
use socketioxide::extract::{SocketRef, Data};
use crate::db::Repository;
use crate::ws::events::*;

pub async fn on_history<A: Adapter>(s: SocketRef<A>, Data(payload): Data<ChatHistoryPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    // 持久化到 DB
    for msg in &payload.messages {
        repo.save_chat_message(
            &payload.session_id,
            format!("{:?}", msg.message_type).to_lowercase().as_str(),
            &msg.content,
            msg.tool_name.as_deref(),
            msg.timestamp,
        ).await.ok();
    }

    // 广播到该设备的所有 mobile 订阅者
    s.within("/chat")
        .to(format!("device:{}", payload.device_token))
        .emit("history", &payload)
        .await
        .ok();
}

pub async fn on_history_request<A: Adapter>(s: SocketRef<A>, Data(payload): Data<RequestChatHistoryPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    let messages = repo.get_chat_history(&payload.session_id, payload.limit.unwrap_or(100)).await.unwrap_or_default();

    let _ = s.emit("history", &ChatHistoryPayload {
        device_token: payload.device_token,
        session_id: payload.session_id,
        messages,
    });
}

pub fn register_chat_handlers<A: Adapter>(io: &socketioxide::Namespace<A>) {
    io.on("history", on_history::<A>);
    io.on("history:request", on_history_request::<A>);
}
```

- [ ] **Step 2: 编译检查**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

- [ ] **Step 3: 提交**

```bash
git add cloud-server/src/ws/handlers/chat.rs
git commit -m "feat(cloud-server): add /chat namespace handler"
```

---

### Task 8: 创建 /sessions namespace handler

**Files:**
- Create: `cloud-server/src/ws/handlers/sessions.rs`

- [ ] **Step 1: 创建 handlers/sessions.rs**

```rust
use socketioxide::adapter::Adapter;
use socketioxide::extract::{SocketRef, Data};
use crate::db::Repository;
use crate::ws::events::*;

pub async fn on_list_request<A: Adapter>(s: SocketRef<A>, Data(payload): Data<RequestSessionListPayload>) {
    // 只转发到特定 desktop room
    s.within("/sessions")
        .to(format!("device:{}", payload.device_token))
        .emit("list:request", &payload)
        .await
        .ok();
}

pub async fn on_list_response<A: Adapter>(s: SocketRef<A>, Data(payload): Data<SessionListResponsePayload>) {
    // desktop 回复：转发到请求的 mobile
    // mobile_conn_id 用于路由到具体 mobile socket
    // 通过 room 已经是 device:xxx，直接广播即可
    s.within("/sessions")
        .to(format!("device:{}", payload.device_token))
        .emit("list", &serde_json::json!({
            "device_token": payload.device_token,
            "sessions": payload.sessions,
        }))
        .await
        .ok();
}

pub fn register_sessions_handlers<A: Adapter>(io: &socketioxide::Namespace<A>) {
    io.on("list:request", on_list_request::<A>);
    io.on("list:response", on_list_response::<A>);
}
```

- [ ] **Step 2: 编译检查**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

- [ ] **Step 3: 提交**

```bash
git add cloud-server/src/ws/handlers/sessions.rs
git commit -m "feat(cloud-server): add /sessions namespace handler"
```

---

### Task 9: 创建设备生命周期 handler

**Files:**
- Create: `cloud-server/src/ws/handlers/devices.rs`

- [ ] **Step 1: 创建 handlers/devices.rs**

```rust
use socketioxide::adapter::Adapter;
use socketioxide::extract::SocketRef;
use crate::db::Repository;
use crate::ws::events::*;

pub async fn on_connect<A: Adapter>(s: SocketRef<A>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    // 移动端连接后发送 device list
    let devices = repo.get_all_devices().await.unwrap_or_default();
    let device_list: Vec<DeviceInfo> = devices.into_iter().map(|d| DeviceInfo {
        token: d.token,
        hostname: d.hostname,
        registered_at: d.registered_at.map(|t| t.to_string()),
        online: false, // 由 auth middleware 的 room join 事件更新
    }).collect();

    s.emit("list", &DeviceListPayload { devices: device_list }).await.ok();
}

pub async fn on_disconnect<A: Adapter>(s: SocketRef<A>) {
    // Socket.IO rooms 自动清理，无需手动 unregister
    // 如有需要持久化在线状态的逻辑可在此处理
    // 当前由 auth middleware 管理 room join/leave
}

pub fn register_devices_handlers<A: Adapter>(io: &socketioxide::Namespace<A>) {
    io.on_connect(on_connect::<A>);
    io.on_disconnect(on_disconnect::<A>);
}
```

- [ ] **Step 2: 编译检查**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

- [ ] **Step 3: 提交**

```bash
git add cloud-server/src/ws/handlers/devices.rs
git commit -m "feat(cloud-server): add /devices namespace handler for device lifecycle"
```

---

### Task 10: 重写 server.rs

**Files:**
- Rewrite: `cloud-server/src/ws/server.rs`

- [ ] **Step 1: 重写 server.rs**

```rust
use std::sync::Arc;
use socketioxide::SocketIo;
use socketioxide_postgres::{PostgresAdapterCtr, SqlxAdapter};
use sqlx::PgPool;
use crate::db::Repository;

pub struct ServerState {
    pub repo: Arc<Repository>,
    pub pool: PgPool,
}

pub async fn build_socketio_server(
    pool: PgPool,
    repo: Repository,
) -> anyhow::Result<(axum::routing::MethodRouter, SocketIo<SqlxAdapter<sqlx::Postgres>>)> {
    let repo = Arc::new(repo);

    // Postgres adapter for horizontal scaling
    let adapter = PostgresAdapterCtr::new_with_sqlx(pool.clone());

    let (layer, io) = SocketIo::builder()
        .with_adapter::<SqlxAdapter<_>>(adapter)
        .build_layer();

    // 注入共享状态到 extensions
    io.extensions.insert(repo.clone());
    io.extensions.insert(pool.clone());

    // 注册 namespace handlers
    let hooks_ns = io.of("/hooks").await?;
    super::handlers::hooks::register_hooks_handlers(&hooks_ns);

    let chat_ns = io.of("/chat").await?;
    super::handlers::chat::register_chat_handlers(&chat_ns);

    let sessions_ns = io.of("/sessions").await?;
    super::handlers::sessions::register_sessions_handlers(&sessions_ns);

    let devices_ns = io.of("/").await?;
    super::handlers::devices::register_devices_handlers(&devices_ns);

    // 默认 namespace 的认证 middleware
    io.ns("/", |s: socketioxide::extract::SocketRef<_>| async move {
        // auth middleware 逻辑在 on_connect 时执行
        Ok(())
    }).await?;

    Ok((layer, io))
}
```

- [ ] **Step 2: 编译检查**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

- [ ] **Step 3: 提交**

```bash
git add cloud-server/src/ws/server.rs
git commit -m "refactor(cloud-server): rewrite server with socketioxide builder + postgres adapter"
```

---

### Task 11: 修改 main.rs 集成新服务

**Files:**
- Modify: `cloud-server/src/main.rs`
- Modify: `cloud-server/src/ws/mod.rs`

- [ ] **Step 1: 更新 mod.rs**

```rust
pub mod server;
pub mod auth;
pub mod events;
pub mod handlers;
```

- [ ] **Step 2: 修改 main.rs 的 WebSocket 启动逻辑**

将原来:
```rust
let router = ConnectionRouter::new();
let pending_repo = PendingMessageRepo::new(pool.clone());

// Spawn NotifyListener
let notify = NotifyListener::new(pool.clone(), router.clone());
tokio::spawn(notify.run(shutdown.clone()));

// Run WebSocket server
let ws_task = tokio::spawn(run_server(config.ws_port, router, repo, pending_repo, shutdown.clone()));
```

替换为:
```rust
let (socketio_layer, io) = build_socketio_server(pool.clone(), repo).await?;

// Mount Socket.IO on axum
let app = axum::Router::new()
    .nest_service("/socket.io", socketio_layer)
    // 保留现有 HTTP API routes
    .route("/instances", axum::routing::get(get_instances))
    .route("/popups", axum::routing::get(get_popups))
    .route("/stats", axum::routing::get(get_stats))
    .with_state(Arc::new(app_state));

let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.ws_port)).await?;
axum::serve(listener, app).await?;
```

删除:
- `ConnectionRouter` 创建
- `PendingMessageRepo` 创建
- `NotifyListener` spawn
- `run_server` spawn
- `stale cleanup task` 中的 `pending_messages` 清理（adapter 内置处理）

- [ ] **Step 3: 验证编译**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

- [ ] **Step 4: 提交**

```bash
git add cloud-server/src/main.rs cloud-server/src/ws/mod.rs
git commit -m "refactor(cloud-server): integrate socketioxide into main.rs, remove old WS infra"
```

---

### Task 12: 删除旧文件

**Files:**
- Delete: `cloud-server/src/ws/connection.rs`
- Delete: `cloud-server/src/ws/router.rs`
- Delete: `cloud-server/src/ws/handler.rs`
- Delete: `cloud-server/src/ws/notify_listener.rs`
- Delete: `cloud-server/migrations/004_pending_messages.sql`

- [ ] **Step 1: 删除文件**

```bash
rm cloud-server/src/ws/connection.rs
rm cloud-server/src/ws/router.rs
rm cloud-server/src/ws/handler.rs
rm cloud-server/src/ws/notify_listener.rs
rm cloud-server/migrations/004_pending_messages.sql
```

- [ ] **Step 2: 验证编译**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
```

Expected: 如果之前有对旧模块的引用，需要清理。确保 mod.rs 和 main.rs 不再引用已删除的模块。

- [ ] **Step 3: 提交**

```bash
git rm cloud-server/src/ws/connection.rs cloud-server/src/ws/router.rs cloud-server/src/ws/handler.rs cloud-server/src/ws/notify_listener.rs cloud-server/migrations/004_pending_messages.sql
git commit -m "refactor(cloud-server): remove old WebSocket infra files (connection, router, handler, notify_listener, pending_messages)"
```

---

### Task 13: 重写桌面 CloudClient

**Files:**
- Rewrite: `src-tauri/src/cloud_client.rs`

- [ ] **Step 1: 创建新的 CloudClient 实现**

```rust
use std::sync::Arc;
use std::time::Duration;
use rust_socketio::{
    asynchronous::{Client, ClientBuilder},
    Payload,
};
use tokio::sync::RwLock;
use serde_json::{json, Value};

use crate::app_state::AppState;

const RECONNECT_DELAY: Duration = Duration::from_secs(5);

pub struct CloudConfig {
    pub server_url: String,
    pub device_name: Option<String>,
}

pub struct CloudClient {
    config: CloudConfig,
    device_token: String,
    hostname: Option<String>,
    app_state: Arc<RwLock<AppState>>,
    socket: Option<Client>,
}

impl CloudClient {
    pub fn new(app_state: Arc<RwLock<AppState>>, config: CloudConfig) -> Self {
        let device_token = crate::machine_id::get_machine_id();
        let hostname = hostname::get().ok().map(|h| h.to_string_lossy().to_string());
        Self {
            config,
            device_token,
            hostname,
            app_state,
            socket: None,
        }
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        let auth = json!({
            "device_token": self.device_token,
            "hostname": self.hostname,
            "device_name": self.config.device_name,
        });

        let device_token = self.device_token.clone();
        let app_state = self.app_state.clone();

        let socket = ClientBuilder::new(&self.config.server_url)
            .auth(auth)
            .namespace("/")
            .reconnect(true)
            .reconnect_delay(RECONNECT_DELAY.as_millis() as u64)
            .on("auth_success", move |_payload: Payload, _socket: Client| {
                let app_state = app_state.clone();
                let token = device_token.clone();
                async move {
                    let mut state = app_state.write().await;
                    state.cloud_connection_status = crate::CloudConnectionStatus::Connected;
                    // 发送已有 session 数据
                    // （具体逻辑参考原有 handle_initial_data 实现）
                }
            })
            .on("hook:response", move |payload: Payload, _socket: Client| {
                let app_state = app_state.clone();
                async move {
                    if let Payload::Text(values) = payload {
                        if let Some(text) = values.first() {
                            if let Ok(json) = serde_json::from_str::<Value>(text) {
                                handle_hook_response(app_state, &json).await;
                            }
                        }
                    }
                }
            })
            .on("list:request", move |payload: Payload, socket: Client| {
                let app_state = app_state.clone();
                async move {
                    if let Payload::Text(values) = payload {
                        if let Some(text) = values.first() {
                            if let Ok(req) = serde_json::from_str::<Value>(text) {
                                handle_request_session_list(app_state, &req, &socket).await;
                            }
                        }
                    }
                }
            })
            .on("auth_error", |_payload: Payload, _socket: Client| async move {
                tracing::error!("Socket.IO auth failed");
            })
            .connect()
            .await
            .map_err(|e| format!("connect failed: {}", e))?;

        self.socket = Some(socket);
        Ok(())
    }

    pub async fn push_hook_message(&self, session_id: &str, hook_type: &str, hook_body: Value) {
        if let Some(socket) = &self.socket {
            socket.emit("hook", json!({
                "device_token": self.device_token,
                "session_id": session_id,
                "hook_type": hook_type,
                "hook_body": hook_body,
            })).await.ok();
        }
    }

    pub async fn push_chat_history(&self, session_id: &str, messages: Vec<Value>) {
        if let Some(socket) = &self.socket {
            socket.emit("history", json!({
                "device_token": self.device_token,
                "session_id": session_id,
                "messages": messages,
            })).await.ok();
        }
    }

    pub async fn push_popup_resolved(&self, popup_id: &str, session_id: &str, decision: Option<&str>, answers: Option<Vec<Vec<String>>>) {
        if let Some(socket) = &self.socket {
            socket.emit("popup:resolved", json!({
                "device_token": self.device_token,
                "popup_id": popup_id,
                "session_id": session_id,
                "source": "desktop",
                "decision": decision,
                "answers": answers,
            })).await.ok();
        }
    }
}

async fn handle_hook_response(app_state: Arc<RwLock<AppState>>, json: &Value) {
    // 保留原有逻辑：通过 PopupQueue 响应 PermissionRequest/AskUserQuestion
    let session_id = json["session_id"].as_str().unwrap_or("");
    let decision = json["decision"].as_str();
    let app_state_read = app_state.read().await;
    if let Some(popup) = app_state_read.popups.get(session_id) {
        let resp = crate::popup_queue::PopupResponse {
            decision: decision.unwrap_or("deny").to_string(),
            answers: json["answers"].as_array().map(|a| a.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect()),
        };
        let _ = popup.response_tx.send(resp).await;
    }
}

async fn handle_request_session_list(app_state: Arc<RwLock<AppState>>, json: &Value, socket: &Client) {
    let instances = { app_state.read().await.instances.get_all() };
    let sessions: Vec<Value> = instances.into_iter().map(|i| json!({
        "sessionId": i.session_id,
        "projectName": i.project_name,
        "status": i.status,
        "currentTool": i.current_tool,
        "createdAt": i.created_at,
    })).collect();

    socket.emit("list:response", json!({
        "device_token": json["device_token"],
        "mobile_conn_id": json["mobile_conn_id"],
        "sessions": sessions,
    })).await.ok();
}
```

- [ ] **Step 2: 编译检查**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/cloud_client.rs
git commit -m "refactor(desktop): rewrite cloud client with rust-socketio, remove manual reconnect/heartbeat"
```

---

### Task 14: 修改 lib.rs 简化云客户端启动

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 简化 start_cloud_with_reconnect**

删除手动重连循环，改为依赖 rust-socketio 内置重连：

```rust
pub async fn start_cloud_with_reconnect(server_url: &str, device_name: Option<&str>) {
    let config = CloudConfig {
        server_url: server_url.to_string(),
        device_name: device_name.map(|s| s.to_string()),
    };

    let app_state = SHARED_STATE.read().await;
    let client = CloudClient::new(SHARED_STATE.clone(), config);
    drop(app_state);

    let client = Arc::new(AsyncRwLock::new(client));
    {
        let mut state = SHARED_STATE.write().await;
        state.cloud_connection_status = CloudConnectionStatus::Connecting;
        state.cloud_client = Some(client.clone());
    }

    let mut c = client.write().await;
    match c.connect().await {
        Ok(()) => {
            SHARED_STATE.write().await.cloud_connection_status = CloudConnectionStatus::Connected;
        }
        Err(e) => {
            SHARED_STATE.write().await.cloud_connection_status = CloudConnectionStatus::Failed(e);
        }
    }
}
```

- [ ] **Step 2: 删除 stop_cloud_client 中的 stop_signal 逻辑**

Socket.IO client drop 自动断开连接。

- [ ] **Step 3: 编译检查**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/lib.rs
git commit -m "refactor(desktop): simplify cloud start/stop with rust-socketio built-in reconnect"
```

---

### Task 15: 重写移动端 WebSocket hook

**Files:**
- Create: `mobile-app/src/hooks/useSocketIO.ts`

- [ ] **Step 1: 创建 useSocketIO.ts**

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export interface WsState {
  serverConnected: boolean;
  serverConnecting: boolean;
  connectionError: string | null;
  onlineDevices: DeviceInfo[];
  sessions: Record<string, ClaudeSession[]>;
  hookHints: Record<string, HookHint[]>;
  chatMessages: Record<string, ChatMessageData[]>;
}

interface UseSocketIOOptions {
  devices: string[];
  serverUrl: string;
}

export function useSocketIO({ devices, serverUrl }: UseSocketIOOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<WsState>({
    serverConnected: false,
    serverConnecting: true,
    connectionError: null,
    onlineDevices: [],
    sessions: {},
    hookHints: {},
    chatMessages: {},
  });

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    setState(s => ({ ...s, serverConnecting: true, connectionError: null }));

    const trimmedUrl = serverUrl.replace(/\/+$/, '');
    const socket = io(trimmedUrl, {
      auth: { device_tokens: devices },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 5000,
    });

    socket.on('connect', () => {
      setState(s => ({ ...s, serverConnected: true, serverConnecting: false }));
    });

    socket.on('auth_success', (data: { device_id: string; subscriptions?: string[] }) => {
      console.log('Socket.IO authenticated:', data.device_id);
    });

    socket.on('auth_error', (data: { reason: string }) => {
      setState(s => ({
        ...s,
        serverConnecting: false,
        connectionError: `Auth failed: ${data.reason}`,
      }));
    });

    // /devices events
    socket.on('online', (data: { device: DeviceInfo }) => {
      setState(s => ({
        ...s,
        onlineDevices: [...s.onlineDevices.filter(d => d.token !== data.device.token), data.device],
      }));
    });

    socket.on('offline', (data: { device_token: string }) => {
      setState(s => ({
        ...s,
        onlineDevices: s.onlineDevices.map(d =>
          d.token === data.device_token ? { ...d, online: false } : d
        ),
      }));
    });

    socket.on('list', (data: { devices: DeviceInfo[] }) => {
      setState(s => ({ ...s, onlineDevices: data.devices }));
    });

    // /hooks events
    socket.on('hook', (msg: HookPayload) => {
      handleHookMessage(msg, setState);
    });

    socket.on('popup:resolved', (data: PopupResolvedPayload) => {
      setState(s => {
        const hints = s.hookHints[data.device_token]?.filter(h => h.session_id !== data.session_id) || [];
        return { ...s, hookHints: { ...s.hookHints, [data.device_token]: hints } };
      });
    });

    // /chat events
    socket.on('history', (data: { device_token: string; session_id: string; messages: ChatMessageData[] }) => {
      setState(s => ({
        ...s,
        chatMessages: { ...s.chatMessages, [data.session_id]: data.messages },
      }));
    });

    // /sessions events
    socket.on('list', (data: { device_token: string; sessions: ClaudeSession[] }) => {
      setState(s => ({
        ...s,
        sessions: { ...s.sessions, [data.device_token]: data.sessions },
      }));
    });

    socket.on('disconnect', () => {
      setState(s => ({ ...s, serverConnected: false }));
    });

    socket.on('connect_error', (err: Error) => {
      setState(s => ({
        ...s,
        serverConnecting: false,
        connectionError: err.message,
      }));
    });

    socketRef.current = socket;
  }, [serverUrl, devices]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect]);

  const sendHookResponse = useCallback((deviceToken: string, sessionId: string, decision: string, answers?: string[][]) => {
    socketRef.current?.emit('hook:response', {
      device_token: deviceToken,
      session_id: sessionId,
      decision,
      answers,
    });
    // 清除本地 hint
    setState(s => ({
      ...s,
      hookHints: {
        ...s.hookHints,
        [deviceToken]: s.hookHints[deviceToken]?.filter(h => h.session_id !== sessionId) || [],
      },
    }));
  }, []);

  const requestChatHistory = useCallback((deviceToken: string, sessionId: string, limit?: number) => {
    socketRef.current?.emit('history:request', {
      device_token: deviceToken,
      session_id: sessionId,
      limit,
    });
  }, []);

  const forceSubscribe = useCallback(() => {
    socketRef.current?.emit('mobile_auth', { device_tokens: devices });
  }, [devices]);

  return { state, sendHookResponse, requestChatHistory, forceSubscribe };
}

// handleHookMessage: 保留原有会话状态机逻辑
function handleHookMessage(msg: HookPayload, setState: React.Dispatch<React.SetStateAction<WsState>>) {
  const { device_token, session_id, hook_type, hook_body } = msg;
  const isUrgent = hook_type === 'PermissionRequest' || hook_type === 'Elicitation'
    || (hook_type === 'Notification' && hook_body.type === 'ask');

  setState(s => {
    const newHint: HookHint = {
      session_id,
      hook_type,
      urgent: isUrgent,
      tool_name: hook_body.tool_name,
      action: hook_body.action,
      questions: hook_body.questions,
      timestamp: Date.now(),
    };

    const deviceHints = s.hookHints[device_token] || [];
    const filtered = deviceHints.filter(h => h.session_id !== session_id || !isUrgent);
    const hints = { ...s.hookHints, [device_token]: [...filtered, newHint] };

    const deviceSessions = s.sessions[device_token] || [];
    const newStatus = deriveSessionStatus(hook_type);
    const updatedSessions = deviceSessions.map(s =>
      s.sessionId === session_id ? { ...s, status: newStatus } : s
    );

    const sessions = {
      ...s.sessions,
      [device_token]: hook_type === 'SessionStart'
        ? [...deviceSessions, {
            sessionId: session_id,
            projectName: extractProjectName(hook_body.cwd || ''),
            status: 'idle',
            currentTool: null,
            createdAt: Date.now(),
          }]
        : hook_type === 'SessionEnd'
          ? deviceSessions.filter(s => s.sessionId !== session_id)
          : updatedSessions,
    };

    return { ...s, hookHints: hints, sessions };
  });
}

function deriveSessionStatus(hookType: string): string {
  switch (hookType) {
    case 'PreToolUse': return 'working';
    case 'PostToolUse': case 'Stop': return 'idle';
    case 'PermissionRequest': case 'Elicitation': return 'waitingForApproval';
    case 'Notification': return 'waitingForApproval';
    case 'UserPromptSubmit': return 'thinking';
    case 'PreCompact': return 'compacting';
    case 'PostCompact': return 'idle';
    case 'PostToolUseFailure': return 'error';
    default: return 'idle';
  }
}

function extractProjectName(cwd: string): string {
  const parts = cwd.split('/');
  return parts[parts.length - 1] || cwd;
}
```

- [ ] **Step 2: 提交**

```bash
git add mobile-app/src/hooks/useSocketIO.ts
git commit -m "feat(mobile): add useSocketIO hook replacing raw WebSocket with socket.io-client"
```

---

### Task 16: 更新 mobile-app 类型和根组件

**Files:**
- Rewrite: `mobile-app/src/types.ts`
- Modify: `mobile-app/src/App.tsx`

- [ ] **Step 1: 更新 types.ts**

保留现有类型，添加 Socket.IO 专用类型：

```typescript
// 保留现有的 DeviceInfo, ClaudeSession, HookHint, ChatMessageData 等

// 新增事件 payload 类型
export interface HookPayload {
  device_token: string;
  session_id: string;
  hook_type: string;
  hook_body: any;
}

export interface PopupResolvedPayload {
  device_token: string;
  popup_id: string;
  session_id: string;
  source: string;
  decision: string | null;
  answers: string[][] | null;
}

export interface HookResponsePayload {
  device_token: string;
  session_id: string;
  decision: string;
  answers?: string[][];
}
```

- [ ] **Step 2: 更新 App.tsx**

将:
```typescript
import { useAllDevicesWebSocket } from './hooks/useAllDevicesWebSocket';
```
替换为:
```typescript
import { useSocketIO } from './hooks/useSocketIO';
```

更新 hook 调用:
```typescript
const { state, sendHookResponse, requestChatHistory, forceSubscribe } = useSocketIO({ devices, serverUrl });
```

- [ ] **Step 3: 更新 capacitor.config.ts**

```typescript
// 确保 allowNavigation 支持 http:// 和 ws://
allowNavigation: ['http://*', 'https://*', 'ws://*', 'wss://*'],
```

- [ ] **Step 4: 提交**

```bash
git add mobile-app/src/types.ts mobile-app/src/App.tsx mobile-app/capacitor.config.ts
git commit -m "refactor(mobile): integrate useSocketIO hook, update types and config"
```

---

### Task 17: 重写测试文件

**Files:**
- Rewrite: `cloud-server/tests/connection_integration_test.rs`
- Rewrite: `cloud-server/tests/handler_integration_test.rs`
- Delete: `cloud-server/tests/router_test.rs`
- Delete: `cloud-server/tests/routing_test.rs`
- Delete: `cloud-server/tests/notify_listener_test.rs`
- Delete: `cloud-server/tests/notify_listener_integration_test.rs`
- Delete: `cloud-server/tests/handler_test.rs`

- [ ] **Step 1: 删除路由相关的测试**

```bash
rm cloud-server/tests/router_test.rs
rm cloud-server/tests/routing_test.rs
rm cloud-server/tests/notify_listener_test.rs
rm cloud-server/tests/notify_listener_integration_test.rs
rm cloud-server/tests/handler_test.rs
```

- [ ] **Step 2: 创建新的连接测试**

创建 `cloud-server/tests/connection_integration_test.rs`，使用 `socket.io-client` (Node.js) 作为测试客户端：

```rust
// 用 tokio::process::Command 启动 Node.js 测试脚本
// 或编写纯 Rust 测试使用 socketioxide 的 __test_harness feature

#[cfg(test)]
mod tests {
    // 测试将在后续迭代中根据 socketioxide test harness API 细化
    // 当前先删除旧测试，用集成测试覆盖核心流程
}
```

- [ ] **Step 3: 提交**

```bash
git rm cloud-server/tests/router_test.rs cloud-server/tests/routing_test.rs \
       cloud-server/tests/notify_listener_test.rs cloud-server/tests/notify_listener_integration_test.rs \
       cloud-server/tests/handler_test.rs
git add cloud-server/tests/connection_integration_test.rs cloud-server/tests/handler_integration_test.rs
git commit -m "test(cloud-server): remove tests for deleted modules, stub Socket.IO tests"
```

---

### Task 18: 最终验证和清理

**Files:**
- 全局

- [ ] **Step 1: 完整编译检查**

```bash
cargo check --manifest-path cloud-server/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 所有 crate 编译通过，无 warning。

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd mobile-app && pnpm exec tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: 运行遗留测试**

```bash
cargo test --manifest-path cloud-server/Cargo.toml
```

Expected: 保留的测试通过。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: final cleanup after Socket.IO migration"
```
