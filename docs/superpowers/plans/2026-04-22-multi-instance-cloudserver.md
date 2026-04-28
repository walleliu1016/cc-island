# Multi-Instance Cloud Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable cloud-server to run multiple instances using PostgreSQL LISTEN/NOTIFY for cross-instance message routing.

**Architecture:** Each instance maintains local connection state in memory. Cross-instance messages are persisted to PostgreSQL pending_messages table and broadcast via NOTIFY. Instances check if target connection belongs to them, retrieve and deliver message, then delete.

**Tech Stack:** PostgreSQL LISTEN/NOTIFY, sqlx, tokio async runtime

---

## File Structure

| Category | File | Purpose |
|----------|------|---------|
| Migration | `migrations/004_pending_messages.sql` | Create pending_messages table |
| DB Repo | `src/db/pending_message.rs` | INSERT/SELECT/DELETE pending_messages |
| WS Notify | `src/ws/notify_listener.rs` | LISTEN PostgreSQL NOTIFY, handle incoming |
| Router | `src/ws/router.rs` | Add has_mobile_subscribers/has_desktop_connection |
| Handler | `src/ws/handler.rs` | Modify send logic to use NOTIFY path |
| Main | `src/main.rs` | Start NotifyListener and cleanup task |
| Module | `src/db/mod.rs` | Export pending_message module |
| Module | `src/ws/mod.rs` | Export notify_listener module |

---

### Task 1: Database Migration - pending_messages Table

**Files:**
- Create: `cloud-server/migrations/004_pending_messages.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration: 004_pending_messages.sql
-- Purpose: Store cross-instance messages for NOTIFY-based routing

CREATE TABLE pending_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('to_mobile', 'to_desktop')),
    message_type TEXT NOT NULL,
    message_body JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient lookup by device and direction
CREATE INDEX idx_pending_device_direction
    ON pending_messages(device_token, direction, created_at);

-- Index for cleanup by timestamp
CREATE INDEX idx_pending_created_at
    ON pending_messages(created_at);
```

- [ ] **Step 2: Commit migration**

```bash
git add cloud-server/migrations/004_pending_messages.sql
git commit -m "feat: Add pending_messages migration for cross-instance routing"
```

---

### Task 2: PendingMessageRepo - Database Operations

**Files:**
- Create: `cloud-server/src/db/pending_message.rs`
- Modify: `cloud-server/src/db/mod.rs`

- [ ] **Step 1: Create PendingMessageRepo struct and types**

```rust
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use sqlx::PgPool;
use anyhow::Result;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::protocol::Message;

/// Direction of pending message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    ToMobile,
    ToDesktop,
}

impl Direction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Direction::ToMobile => "to_mobile",
            Direction::ToDesktop => "to_desktop",
        }
    }
}

/// Pending message stored in database
#[derive(Debug, Clone)]
pub struct PendingMessage {
    pub id: Uuid,
    pub device_token: String,
    pub direction: String,
    pub message_type: String,
    pub message_body: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Notify payload (lightweight, sent via PostgreSQL NOTIFY)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyPayload {
    pub device_token: String,
    pub direction: String,
    pub message_id: Uuid,
}

/// Repository for pending_messages table operations
#[derive(Clone)]
pub struct PendingMessageRepo {
    pool: PgPool,
}

impl PendingMessageRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a pending message
    pub async fn insert(
        &self,
        device_token: &str,
        direction: Direction,
        message_type: &str,
        message_body: serde_json::Value,
    ) -> Result<Uuid> {
        let id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO pending_messages (id, device_token, direction, message_type, message_body)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            id,
            device_token,
            direction.as_str(),
            message_type,
            message_body,
        )
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    /// Get and delete a pending message by id (atomic operation)
    pub async fn get_and_delete(&self, message_id: Uuid) -> Result<Option<PendingMessage>> {
        // Use DELETE with RETURNING for atomic get-and-delete
        let result = sqlx::query_as::<_, PendingMessage>(
            r#"
            DELETE FROM pending_messages
            WHERE id = $1
            RETURNING id, device_token, direction, message_type, message_body, created_at
            "#,
        )
        .bind(message_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    /// Delete stale messages older than threshold
    pub async fn delete_stale(&self, older_than_minutes: i32) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            DELETE FROM pending_messages
            WHERE created_at < NOW() - INTERVAL '1 minute' * $1
            "#,
            older_than_minutes,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Send NOTIFY to PostgreSQL channel
    pub async fn notify(&self, payload: &NotifyPayload) -> Result<()> {
        let payload_json = serde_json::to_string(payload)?;
        sqlx::query!(
            r#"
            SELECT pg_notify('pending_message_notify', $1)
            "#,
            payload_json,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Reconstruct WebSocket Message from stored data
    pub fn to_ws_message(&self, pending: &PendingMessage) -> Message {
        // The message_body is already the full CloudMessage JSON
        Message::text(pending.message_body.to_string())
    }
}
```

- [ ] **Step 2: Update db/mod.rs to export pending_message**

```rust
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
pub mod models;
pub mod pool;
pub mod repository;
pub mod pending_message;  // Add this line
```

- [ ] **Step 3: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/db/pending_message.rs cloud-server/src/db/mod.rs
git commit -m "feat: Add PendingMessageRepo for cross-instance message storage"
```

---

### Task 3: ConnectionRouter - Add Connection Check Methods

**Files:**
- Modify: `cloud-server/src/ws/router.rs`

- [ ] **Step 1: Add has_mobile_subscribers method**

Add after `is_desktop_online` method (around line 196):

```rust
    /// Check if any mobile subscriber exists for a device (local memory)
    pub fn has_mobile_subscribers(&self, device_token: &str) -> bool {
        let inner = self.inner.read();
        inner.mobile_subscriptions
            .get(device_token)
            .map(|subs| !subs.is_empty())
            .unwrap_or(false)
    }

    /// Check if desktop connection exists for a device (local memory)
    pub fn has_desktop_connection(&self, device_token: &str) -> bool {
        let inner = self.inner.read();
        inner.desktop_connections.contains_key(device_token)
    }
```

- [ ] **Step 2: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add cloud-server/src/ws/router.rs
git commit -m "feat: Add has_mobile_subscribers and has_desktop_connection to ConnectionRouter"
```

---

### Task 4: NotifyListener - LISTEN PostgreSQL NOTIFY

**Files:**
- Create: `cloud-server/src/ws/notify_listener.rs`
- Modify: `cloud-server/src/ws/mod.rs`

- [ ] **Step 1: Create NotifyListener**

```rust
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use anyhow::Result;
use tokio_util::sync::CancellationToken;
use crate::db::pending_message::{PendingMessageRepo, NotifyPayload};
use super::router::ConnectionRouter;

/// Listen for PostgreSQL NOTIFY events and handle cross-instance messages
pub struct NotifyListener {
    pool: PgPool,
    router: ConnectionRouter,
    pending_repo: PendingMessageRepo,
}

impl NotifyListener {
    pub fn new(pool: PgPool, router: ConnectionRouter) -> Self {
        let pending_repo = PendingMessageRepo::new(pool.clone());
        Self {
            pool,
            router,
            pending_repo,
        }
    }

    /// Start listening for NOTIFY events
    pub async fn run(self, shutdown: CancellationToken) -> Result<()> {
        tracing::info!("NotifyListener starting, LISTEN on 'pending_message_notify'");

        // Create dedicated listener connection
        let mut listener = PgListener::connect_with(&self.pool).await?;
        listener.listen("pending_message_notify").await?;

        tracing::info!("NotifyListener connected and listening");

        loop {
            tokio::select! {
                // Wait for NOTIFY notification
                notification = listener.recv() => {
                    match notification {
                        Ok(notif) => {
                            tracing::debug!("Received NOTIFY: {:?}", notif.payload());
                            self.handle_notification(notif.payload());
                        }
                        Err(e) => {
                            tracing::error!("NotifyListener error: {}, reconnecting...", e);
                            // Reconnect on error
                            loop {
                                match PgListener::connect_with(&self.pool).await {
                                    Ok(new_listener) => {
                                        listener = new_listener;
                                        if let Err(e) = listener.listen("pending_message_notify").await {
                                            tracing::error!("Failed to re-LISTEN: {}", e);
                                            continue;
                                        }
                                        tracing::info!("NotifyListener reconnected");
                                        break;
                                    }
                                    Err(e) => {
                                        tracing::error!("Reconnect failed: {}, retrying in 5s...", e);
                                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                                    }
                                }
                            }
                        }
                    }
                }

                // Handle shutdown signal
                _ = shutdown.cancelled() => {
                    tracing::info!("NotifyListener shutdown signal received");
                    break;
                }
            }
        }

        tracing::info!("NotifyListener stopped");
        Ok(())
    }

    /// Handle a NOTIFY notification payload
    fn handle_notification(&self, payload: &str) {
        // Parse NOTIFY payload
        let notify_data: NotifyPayload = match serde_json::from_str(payload) {
            Ok(data) => data,
            Err(e) => {
                tracing::warn!("Failed to parse NOTIFY payload '{}': {}", payload, e);
                return;
            }
        };

        tracing::debug!(
            "NOTIFY received: device={}, direction={}, msg_id={}",
            notify_data.device_token,
            notify_data.direction,
            notify_data.message_id
        );

        // Check if target connection belongs to this instance
        if notify_data.direction == "to_mobile" {
            if self.router.has_mobile_subscribers(&notify_data.device_token) {
                // Belongs to us → retrieve → deliver → delete
                self.deliver_to_mobile(&notify_data);
            } else {
                tracing::debug!("NOTIFY skipped (no mobile subscriber for {})", notify_data.device_token);
            }
        } else if notify_data.direction == "to_desktop" {
            if self.router.has_desktop_connection(&notify_data.device_token) {
                // Belongs to us → retrieve → deliver → delete
                self.deliver_to_desktop(&notify_data);
            } else {
                tracing::debug!("NOTIFY skipped (no desktop connection for {})", notify_data.device_token);
            }
        }
    }

    /// Deliver message to mobile subscribers
    fn deliver_to_mobile(&self, notify_data: &NotifyPayload) {
        // Use blocking spawn to handle async DB operation
        let pending_repo = self.pending_repo.clone();
        let router = self.router.clone();
        let device_token = notify_data.device_token.clone();
        let message_id = notify_data.message_id;

        tokio::spawn(async move {
            match pending_repo.get_and_delete(message_id).await {
                Ok(Some(pending)) => {
                    let msg = pending_repo.to_ws_message(&pending);
                    router.broadcast_to_mobiles(&device_token, msg);
                    tracing::info!("Delivered pending message {} to mobile for device {}", message_id, device_token);
                }
                Ok(None) => {
                    tracing::debug!("Pending message {} already delivered by another instance", message_id);
                }
                Err(e) => {
                    tracing::error!("Failed to retrieve pending message {}: {}", message_id, e);
                }
            }
        });
    }

    /// Deliver message to desktop connection
    fn deliver_to_desktop(&self, notify_data: &NotifyPayload) {
        let pending_repo = self.pending_repo.clone();
        let router = self.router.clone();
        let device_token = notify_data.device_token.clone();
        let message_id = notify_data.message_id;

        tokio::spawn(async move {
            match pending_repo.get_and_delete(message_id).await {
                Ok(Some(pending)) => {
                    let msg = pending_repo.to_ws_message(&pending);
                    router.send_to_desktop(&device_token, msg);
                    tracing::info!("Delivered pending message {} to desktop for device {}", message_id, device_token);
                }
                Ok(None) => {
                    tracing::debug!("Pending message {} already delivered by another instance", message_id);
                }
                Err(e) => {
                    tracing::error!("Failed to retrieve pending message {}: {}", message_id, e);
                }
            }
        });
    }
}
```

- [ ] **Step 2: Update ws/mod.rs to export notify_listener**

```rust
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
pub mod server;
pub mod connection;
pub mod router;
pub mod handler;
pub mod notify_listener;  // Add this line
```

- [ ] **Step 3: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/ws/notify_listener.rs cloud-server/src/ws/mod.rs
git commit -m "feat: Add NotifyListener for PostgreSQL LISTEN/NOTIFY"
```

---

### Task 5: MessageHandler - Integrate NOTIFY Path

**Files:**
- Modify: `cloud-server/src/ws/handler.rs`

- [ ] **Step 1: Add PendingMessageRepo to MessageHandler**

Modify MessageHandler struct (around line 11):

```rust
use crate::db::pending_message::{PendingMessageRepo, Direction, NotifyPayload};

/// Handles incoming WebSocket messages
pub struct MessageHandler {
    router: ConnectionRouter,
    repo: Repository,
    pending_repo: PendingMessageRepo,
    mobile_conn_id: Option<uuid::Uuid>,
}

impl MessageHandler {
    pub fn new(router: ConnectionRouter, repo: Repository, pending_repo: PendingMessageRepo, mobile_conn_id: Option<Uuid>) -> Self {
        Self { router, repo, pending_repo, mobile_conn_id }
    }
```

- [ ] **Step 2: Add helper method for cross-instance send**

Add new method in MessageHandler (after handle method):

```rust
    /// Send message to mobiles, using NOTIFY if not locally subscribed
    async fn send_to_mobiles_via_notify(&self, device_token: &str, message_type: &str, message_body: serde_json::Value) {
        if self.router.has_mobile_subscribers(device_token) {
            // Fast path: local subscriber exists
            let json = message_body.to_string();
            self.router.broadcast_to_mobiles(device_token, Message::text(json));
            tracing::debug!("Sent {} directly to local mobile subscribers", message_type);
        } else {
            // Slow path: no local subscriber, use NOTIFY
            match self.pending_repo.insert(device_token, Direction::ToMobile, message_type, message_body.clone()).await {
                Ok(message_id) => {
                    let payload = NotifyPayload {
                        device_token: device_token.to_string(),
                        direction: "to_mobile".to_string(),
                        message_id,
                    };
                    if let Err(e) = self.pending_repo.notify(&payload).await {
                        tracing::error!("Failed to NOTIFY for {}: {}", device_token, e);
                    } else {
                        tracing::debug!("Stored {} for device {}, sent NOTIFY", message_type, device_token);
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to insert pending message for {}: {}", device_token, e);
                }
            }
        }
    }

    /// Send message to desktop, using NOTIFY if not locally connected
    async fn send_to_desktop_via_notify(&self, device_token: &str, message_type: &str, message_body: serde_json::Value) {
        if self.router.has_desktop_connection(device_token) {
            // Fast path: local connection exists
            let json = message_body.to_string();
            self.router.send_to_desktop(device_token, Message::text(json));
            tracing::debug!("Sent {} directly to local desktop", message_type);
        } else {
            // Slow path: no local connection, use NOTIFY
            match self.pending_repo.insert(device_token, Direction::ToDesktop, message_type, message_body.clone()).await {
                Ok(message_id) => {
                    let payload = NotifyPayload {
                        device_token: device_token.to_string(),
                        direction: "to_desktop".to_string(),
                        message_id,
                    };
                    if let Err(e) = self.pending_repo.notify(&payload).await {
                        tracing::error!("Failed to NOTIFY for {}: {}", device_token, e);
                    } else {
                        tracing::debug!("Stored {} for device {}, sent NOTIFY", message_type, device_token);
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to insert pending message for {}: {}", device_token, e);
                }
            }
        }
    }
```

- [ ] **Step 3: Modify HookMessage handling to use NOTIFY path**

Replace the broadcast_to_mobiles call in HookMessage handler (around line 346-354):

Old:
```rust
                // Forward to all subscribed mobiles
                let hook_msg = CloudMessage::HookMessage {
                    device_token: device_token.clone(),
                    session_id,
                    hook_type,
                    hook_body,
                };
                let json = serde_json::to_string(&hook_msg).unwrap();
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
```

New:
```rust
                // Forward to mobiles (via NOTIFY if not locally subscribed)
                let hook_msg = CloudMessage::HookMessage {
                    device_token: device_token.clone(),
                    session_id,
                    hook_type,
                    hook_body,
                };
                let message_body = serde_json::to_value(&hook_msg).unwrap();
                self.send_to_mobiles_via_notify(&device_token, "hook_message", message_body).await;
```

- [ ] **Step 4: Modify ChatHistory handling to use NOTIFY path**

Replace broadcast_to_mobiles in ChatHistory handler (around line 375-377):

Old:
```rust
                // Forward to all subscribed mobiles
                let chat_msg = CloudMessage::ChatHistory {
                    device_token: device_token.clone(),
                    session_id,
                    messages,
                };
                let json = serde_json::to_string(&chat_msg).unwrap();
                tracing::info!("🟢 ChatHistory BROADCASTING to mobiles for device {}", device_token);
                self.router.broadcast_to_mobiles(&device_token, Message::text(json));
```

New:
```rust
                // Forward to mobiles (via NOTIFY if not locally subscribed)
                let chat_msg = CloudMessage::ChatHistory {
                    device_token: device_token.clone(),
                    session_id,
                    messages,
                };
                let message_body = serde_json::to_value(&chat_msg).unwrap();
                tracing::info!("🟢 ChatHistory sending to mobiles for device {}", device_token);
                self.send_to_mobiles_via_notify(&device_token, "chat_history", message_body).await;
```

- [ ] **Step 5: Modify HookResponse handling to use NOTIFY path**

Replace send_to_desktop in HookResponse handler (around line 416-417):

Old:
```rust
                // Forward to desktop
                let response_msg = CloudMessage::HookResponse {
                    device_token: device_token.clone(),
                    session_id,
                    decision,
                    answers,
                };
                let json = serde_json::to_string(&response_msg).unwrap();
                self.router.send_to_desktop(&device_token, Message::text(json));
```

New:
```rust
                // Forward to desktop (via NOTIFY if not locally connected)
                let response_msg = CloudMessage::HookResponse {
                    device_token: device_token.clone(),
                    session_id,
                    decision,
                    answers,
                };
                let message_body = serde_json::to_value(&response_msg).unwrap();
                self.send_to_desktop_via_notify(&device_token, "hook_response", message_body).await;
```

- [ ] **Step 6: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add cloud-server/src/ws/handler.rs
git commit -m "feat: Integrate NOTIFY path in MessageHandler for cross-instance routing"
```

---

### Task 6: Connection Handler - Pass PendingMessageRepo

**Files:**
- Modify: `cloud-server/src/ws/connection.rs`

- [ ] **Step 1: Update handle_connection signature**

Modify function signature (around line 14):

Old:
```rust
pub async fn handle_connection(
    stream: TcpStream,
    router: ConnectionRouter,
    repo: Repository,
) {
```

New:
```rust
use crate::db::pending_message::PendingMessageRepo;

pub async fn handle_connection(
    stream: TcpStream,
    router: ConnectionRouter,
    repo: Repository,
    pending_repo: PendingMessageRepo,
) {
```

- [ ] **Step 2: Update MessageHandler creation**

Modify MessageHandler::new call (around line 108):

Old:
```rust
            // Create message handler
            let handler = MessageHandler::new(router.clone(), repo.clone(), mobile_conn_id);
```

New:
```rust
            // Create message handler
            let handler = MessageHandler::new(router.clone(), repo.clone(), pending_repo.clone(), mobile_conn_id);
```

- [ ] **Step 3: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/ws/connection.rs
git commit -m "feat: Pass PendingMessageRepo to connection handler"
```

---

### Task 7: WebSocket Server - Pass PendingMessageRepo

**Files:**
- Modify: `cloud-server/src/ws/server.rs`

- [ ] **Step 1: Update run_server signature**

Modify function signature (around line 19):

Old:
```rust
pub async fn run_server(
    port: u16,
    router: ConnectionRouter,
    repo: Repository,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
```

New:
```rust
use crate::db::pending_message::PendingMessageRepo;

pub async fn run_server(
    port: u16,
    router: ConnectionRouter,
    repo: Repository,
    pending_repo: PendingMessageRepo,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
```

- [ ] **Step 2: Clone pending_repo for each connection**

Modify the connection spawn (around line 43):

Old:
```rust
                        // Clone shared state for the connection handler
                        let router_clone = router.clone();
                        let repo_clone = repo.clone();

                        // Spawn a new task for each connection
                        tokio::spawn(async move {
                            handle_connection(stream, router_clone, repo_clone).await;
                        });
```

New:
```rust
                        // Clone shared state for the connection handler
                        let router_clone = router.clone();
                        let repo_clone = repo.clone();
                        let pending_repo_clone = pending_repo.clone();

                        // Spawn a new task for each connection
                        tokio::spawn(async move {
                            handle_connection(stream, router_clone, repo_clone, pending_repo_clone).await;
                        });
```

- [ ] **Step 3: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/ws/server.rs
git commit -m "feat: Pass PendingMessageRepo to WebSocket server"
```

---

### Task 8: Main - Start NotifyListener and Cleanup Task

**Files:**
- Modify: `cloud-server/src/main.rs`

- [ ] **Step 1: Add imports and PendingMessageRepo initialization**

Modify imports and add pending_repo creation (around line 10-36):

Old:
```rust
use tokio_util::sync::CancellationToken;
use config::Config;
use db::pool::create_pool;
use db::repository::Repository;
use ws::router::ConnectionRouter;
use ws::server::run_server;

...

    // Create shared components
    let repo = Repository::new(pool.clone());
    let router = ConnectionRouter::new();
```

New:
```rust
use tokio_util::sync::CancellationToken;
use config::Config;
use db::pool::create_pool;
use db::repository::Repository;
use db::pending_message::PendingMessageRepo;
use ws::router::ConnectionRouter;
use ws::server::run_server;
use ws::notify_listener::NotifyListener;

...

    // Create shared components
    let repo = Repository::new(pool.clone());
    let router = ConnectionRouter::new();
    let pending_repo = PendingMessageRepo::new(pool.clone());
```

- [ ] **Step 2: Start NotifyListener**

Add after HTTP server spawn (around line 48):

```rust
    // Start NotifyListener for cross-instance message routing
    let notify_listener = NotifyListener::new(pool.clone(), router.clone());
    let notify_shutdown = shutdown.clone();
    tokio::spawn(async move {
        if let Err(e) = notify_listener.run(notify_shutdown).await {
            tracing::error!("NotifyListener error: {}", e);
        }
    });
    tracing::info!("NotifyListener started");
```

- [ ] **Step 3: Start stale message cleanup task**

Add after NotifyListener spawn:

```rust
    // Start stale message cleanup task (runs every minute)
    let cleanup_repo = PendingMessageRepo::new(pool.clone());
    let cleanup_shutdown = shutdown.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {
                    match cleanup_repo.delete_stale(5).await {
                        Ok(count) if count > 0 => {
                            tracing::debug!("Cleaned up {} stale pending messages", count);
                        }
                        Err(e) => {
                            tracing::error!("Cleanup task error: {}", e);
                        }
                        _ => {}
                    }
                }
                _ = cleanup_shutdown.cancelled() => {
                    tracing::info!("Cleanup task stopped");
                    break;
                }
            }
        }
    });
    tracing::info!("Stale message cleanup task started");
```

- [ ] **Step 4: Update run_server call to pass pending_repo**

Modify run_server call (around line 61):

Old:
```rust
    // Run WebSocket server
    run_server(config.ws_port, router, repo, shutdown).await?;
```

New:
```rust
    // Run WebSocket server
    run_server(config.ws_port, router, repo, pending_repo, shutdown).await?;
```

- [ ] **Step 5: Verify compilation**

```bash
cd cloud-server && cargo check
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add cloud-server/src/main.rs
git commit -m "feat: Start NotifyListener and stale message cleanup in main"
```

---

### Task 9: Final Build and Test

**Files:**
- All modified files

- [ ] **Step 1: Build release**

```bash
cd cloud-server && cargo build --release
```

Expected: Build succeeds

- [ ] **Step 2: Run migrations and verify startup**

```bash
cd cloud-server && cargo run --release
```

Expected: Server starts, logs show "NotifyListener started"

- [ ] **Step 3: Final commit (if any adjustments made)**

```bash
git status
# If changes, commit them
git add -A && git commit -m "fix: Adjust multi-instance implementation"
```

---

## Summary

| Task | Purpose |
|------|---------|
| 1 | Database migration for pending_messages table |
| 2 | PendingMessageRepo for INSERT/SELECT/DELETE and NOTIFY |
| 3 | ConnectionRouter connection check methods |
| 4 | NotifyListener for LISTEN PostgreSQL NOTIFY |
| 5 | MessageHandler integration with NOTIFY path |
| 6 | Connection handler pass PendingMessageRepo |
| 7 | WebSocket server pass PendingMessageRepo |
| 8 | Main start NotifyListener and cleanup task |
| 9 | Final build and test |

**Cross-instance flow:**
- Message arrives → check local connection → fast path (local) or slow path (INSERT + NOTIFY)
- NOTIFY received → check if target belongs to this instance → retrieve → deliver → delete
- Cleanup task deletes stale messages (> 5 minutes old) every minute