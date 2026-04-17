# Multi-Instance Cloud Server Architecture

> **Version:** 1.0
> **Last Updated:** 2026-04-17
> **Status:** Design

## Problem Statement

When Cloud Server runs multiple instances (e.g., behind load balancer):
- Desktop connects to Instance A
- Mobile connects to Instance B
- Desktop pushes HookMessage → Instance A → Mobile doesn't receive (connected to Instance B)

## Solution: PostgreSQL NOTIFY/LISTEN

Use PostgreSQL's native pub/sub mechanism for cross-instance communication without external dependencies (Redis, Kafka).

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              PostgreSQL                                        │
│                                                                               │
│   Channel: hook_<device_token>                                                │
│   Channel: session_<device_token>                                             │
│                                                                               │
│   NOTIFY hook_abc123 ──► All instances LISTEN hook_abc123                     │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
        │                    │                    │
        │ NOTIFY             │ LISTEN             │ LISTEN
        │ (when Desktop      │ (when Mobile       │ (no LISTEN
        │  connects)         │  subscribes)       │  for abc123)
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Instance A   │    │  Instance B   │    │  Instance C   │
│               │    │               │    │               │
│ Desktop(abc)  │    │ Mobile1(abc)  │    │ Mobile2(def)  │
│ connected     │    │ subscribed    │    │ subscribed    │
│               │    │               │    │               │
│ LISTEN:       │    │ LISTEN:       │    │ LISTEN:       │
│ hook_abc123   │    │ hook_abc123   │    │ hook_def456   │
│ (own Desktop) │    │ (Mobile1's    │    │ (Mobile2's    │
│               │    │  subscription)│    │  subscription)│
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## Key Design Principles

### 1. No Message Amplification

**Why NOTIFY won't cause infinite loops:**

```
Desktop → Instance A → NOTIFY hook_abc123
                              │
                              ├─► Instance A receives → forwards to its Mobiles
                              │   (does NOT re-NOTIFY)
                              │
                              ├─► Instance B receives → forwards to Mobile1
                              │   (does NOT re-NOTIFY)
                              │
                              └─► Instance C doesn't receive
                                  (not LISTENing hook_abc123)
```

**Each message flow is unidirectional:**
1. Desktop → Instance → NOTIFY
2. All listening instances → their Mobiles
3. **Message terminates at Mobile** (no re-NOTIFY)

### 2. Per-Subscription LISTEN

Each instance only LISTENs to channels its Mobiles subscribe to:

| Instance | Connected Mobiles | Subscribed Tokens | LISTEN Channels |
|----------|-------------------|-------------------|-----------------|
| A | Mobile1 | [abc, def] | hook_abc, hook_def |
| B | Mobile2 | [abc] | hook_abc |
| C | None | [] | (none) |

**Result:** Instance C never receives notifications for abc/def.

### 3. One Copy Per Mobile

Even if 3 instances LISTEN the same channel:
- Mobile1 receives from Instance A (one copy)
- Mobile2 receives from Instance B (one copy)
- **No duplicate delivery to same Mobile**

---

## Database Schema

### Sessions Table (State Persistence)

```sql
-- migrations/003_sessions.sql
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project_name TEXT,
    status TEXT NOT NULL,  -- JSON: {"type":"working","data":"Bash"}
    current_tool TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(device_token, session_id)
);

CREATE INDEX idx_sessions_device ON sessions(device_token);
CREATE INDEX idx_sessions_updated ON sessions(updated_at);
```

### Session List Query (for Mobile connecting after Desktop started)

```sql
-- Get all active sessions for subscribed devices
SELECT * FROM sessions
WHERE device_token IN ('abc123', 'def456')
AND status NOT LIKE '%"type":"ended"%'
ORDER BY updated_at DESC;
```

---

## Message Flow

### Desktop → Cloud → Mobile (HookMessage)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Desktop (Instance A) receives HookMessage from Claude Code              │
│                                                                             │
│     POST /hook → Instance A                                                 │
│                                                                             │
│  2. Instance A processes message                                            │
│                                                                             │
│     ├─► Save to sessions table (upsert)                                     │
│     ├─► Forward to connected Mobiles (direct WebSocket send)                │
│     └─► NOTIFY hook_<device_token>                                          │
│                                                                             │
│  3. PostgreSQL broadcasts NOTIFY                                            │
│                                                                             │
│     NOTIFY hook_abc123 → All instances LISTENing hook_abc123                │
│                                                                             │
│  4. Other instances receive notification                                    │
│                                                                             │
│     Instance B (LISTEN hook_abc123):                                        │
│     ├─► Query sessions table for latest state                               │
│     └─► Forward to Mobile1 (WebSocket send)                                 │
│                                                                             │
│     Instance C (not LISTENing):                                             │
│     └─► Ignores notification                                                │
│                                                                             │
│  5. Mobiles receive exactly one copy                                        │
│                                                                             │
│     Mobile1 ← Instance B ← NOTIFY                                          │
│     Mobiles connected to A ← Instance A (direct send)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Mobile Connecting After Desktop Started

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Mobile connects to Instance B                                           │
│                                                                             │
│     WebSocket → Instance B                                                  │
│     Send: { type: "mobile_auth", device_tokens: ["abc123"] }                │
│                                                                             │
│  2. Instance B registers subscription                                       │
│                                                                             │
│     ├─► Add to mobile_connections router                                    │
│     ├─► LISTEN hook_abc123 (if not already listening)                       │
│     └─► Query sessions table                                                │
│                                                                             │
│  3. Instance B sends initial state                                          │
│                                                                             │
│     SELECT * FROM sessions WHERE device_token = 'abc123'                    │
│     Send: { type: "session_list", sessions: [...] }                         │
│                                                                             │
│  4. Mobile receives existing Claude sessions                                │
│                                                                             │
│     ├─► Display session list                                                │
│     └─► Subscribe to future updates (via LISTEN)                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### Cloud Server: LISTEN Setup

```rust
// cloud-server/src/db/notify.rs

use sqlx::PgConnection;
use tokio_postgres::AsyncMessage;

pub struct NotifyListener {
    conn: PgConnection,
    subscribed_channels: HashSet<String>,
}

impl NotifyListener {
    /// LISTEN to a channel (if not already listening)
    pub async fn subscribe(&mut self, device_token: &str) {
        let channel = format!("hook_{}", device_token);
        if !self.subscribed_channels.contains(&channel) {
            sqlx::query(&format!("LISTEN {}", channel))
                .execute(&mut self.conn)
                .await?;
            self.subscribed_channels.insert(channel);
        }
    }

    /// UNLISTEN when no Mobiles subscribed
    pub async fn unsubscribe(&mut self, device_token: &str) {
        let channel = format!("hook_{}", device_token);
        if self.subscribed_channels.contains(&channel) {
            // Check if any Mobiles still subscribed
            if !self.router.has_mobile_subscribers(device_token) {
                sqlx::query(&format!("UNLISTEN {}", channel))
                    .execute(&mut self.conn)
                    .await?;
                self.subscribed_channels.remove(&channel);
            }
        }
    }

    /// Handle incoming NOTIFY notifications
    pub async fn listen_loop(&mut self, router: ConnectionRouter) {
        loop {
            match self.conn.recv().await {
                AsyncMessage::Notification(notification) => {
                    let channel = notification.channel();
                    let payload = notification.payload();

                    // Extract device_token from channel: "hook_abc123"
                    if let Some(device_token) = channel.strip_prefix("hook_") {
                        // Forward to all Mobiles subscribed to this device
                        router.broadcast_to_mobiles(
                            device_token,
                            Message::text(payload)
                        );
                    }
                }
                _ => {}
            }
        }
    }
}
```

### Cloud Server: NOTIFY on HookMessage

```rust
// cloud-server/src/ws/handler.rs

CloudMessage::HookMessage { device_token, session_id, hook_type, hook_body } => {
    // 1. Save to database
    self.repo.upsert_session(&device_token, &session_id, hook_type, &hook_body).await?;

    // 2. Forward to connected Mobiles (direct)
    let hook_msg = CloudMessage::HookMessage { ... };
    let json = serde_json::to_string(&hook_msg)?;
    self.router.broadcast_to_mobiles(&device_token, Message::text(json));

    // 3. NOTIFY for other instances
    let channel = format!("hook_{}", device_token);
    sqlx::query(&format!("NOTIFY {}, '{}'", channel, json))
        .execute(&self.db_conn)
        .await?;
}
```

### Mobile App: Request Session List

```typescript
// mobile-app/src/hooks/useAllDevicesWebSocket.ts

interface WsState {
    // ... existing fields
    sessions: Record<string, ClaudeSession[]>  // keyed by device_token
}

// Handle session_list message
case 'session_list': {
    const deviceToken = msg.device_token
    const sessions = msg.sessions || []
    setState(s => ({
        ...s,
        sessions: {
            ...s.sessions,
            [deviceToken]: sessions,
        }
    }))
    break
}
```

### Cloud Server: Session Query

```rust
// cloud-server/src/db/repository.rs

pub async fn get_active_sessions(
    &self,
    device_tokens: &[String]
) -> Result<Vec<Session>, sqlx::Error> {
    sqlx::query_as!(
        Session,
        "SELECT * FROM sessions
         WHERE device_token = ANY($1)
         AND status NOT LIKE '%ended%'
         ORDER BY updated_at DESC",
        device_tokens
    )
    .fetch_all(&self.pool)
    .await
}

pub async fn upsert_session(
    &self,
    device_token: &str,
    session_id: &str,
    hook_type: &str,
    hook_body: &serde_json::Value
) -> Result<(), sqlx::Error> {
    // Parse status from hook_type and hook_body
    let status = parse_session_status(hook_type, hook_body);
    let project_name = hook_body.get("project_name")
        .or(hook_body.get("cwd").and_then(|cwd| extract_project_name(cwd)))
        .and_then(|v| v.as_str());

    sqlx::query!(
        "INSERT INTO sessions (device_token, session_id, project_name, status, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (device_token, session_id)
         DO UPDATE SET status = $4, updated_at = NOW()",
        device_token,
        session_id,
        project_name,
        status
    )
    .execute(&self.pool)
    .await?;

    Ok(())
}
```

---

## Client Changes Required

### Desktop: No Changes

Desktop continues to push HookMessage via WebSocket. Cloud Server handles NOTIFY.

### Mobile: Add session_list Handler

| File | Change |
|------|--------|
| `mobile-app/src/hooks/useAllDevicesWebSocket.ts` | Add `session_list` message handling |
| `mobile-app/src/types.ts` | Add `SessionList` message type |
| `cloud-server/src/messages.rs` | Add `SessionList { device_token, sessions }` |

### Cloud Server: Major Changes

| File | Change |
|------|--------|
| `cloud-server/src/db/repository.rs` | Add `upsert_session()`, `get_active_sessions()` |
| `cloud-server/src/db/notify.rs` | New file - LISTEN/NOTIFY implementation |
| `cloud-server/src/ws/handler.rs` | Add NOTIFY on HookMessage |
| `cloud-server/src/ws/router.rs` | Add `has_mobile_subscribers()` check |
| `cloud-server/migrations/003_sessions.sql` | New migration - sessions table |

---

## Session Status Tracking

### Hook Events → Session Status

| Hook Event | Session Status |
|------------|----------------|
| SessionStart | `{"type":"idle"}` (new session created) |
| SessionEnd | `{"type":"ended"}` |
| PreToolUse | `{"type":"working","data":"Bash"}` |
| PostToolUse | `{"type":"waiting"}` |
| PermissionRequest | `{"type":"waitingForApproval","data":"Bash"}` |
| UserPromptSubmit | `{"type":"thinking"}` |
| Stop | `{"type":"idle"}` |

### Session Cleanup

```rust
// On SessionEnd, mark session as ended (don't delete)
pub async fn end_session(&self, device_token: &str, session_id: &str) {
    sqlx::query!(
        "UPDATE sessions SET status = '{"type":"ended"}', updated_at = NOW()
         WHERE device_token = $1 AND session_id = $2",
        device_token,
        session_id
    )
    .execute(&self.pool)
    .await?;
}

// Optional: Delete ended sessions after 24 hours
pub async fn cleanup_old_sessions(&self) {
    sqlx::query!(
        "DELETE FROM sessions
         WHERE status LIKE '%ended%'
         AND updated_at < NOW() - INTERVAL '24 hours'"
    )
    .execute(&self.pool)
    .await?;
}
```

---

## Message Types Summary

### New Messages

| Message | Source | Destination | Purpose |
|---------|--------|-------------|---------|
| `session_list` | Cloud | Mobile | Send existing sessions on connect |
| `hook_message` | Desktop | Cloud → NOTIFY → Mobiles | Real-time session updates |

### Existing Messages (unchanged)

| Message | Source | Destination | Purpose |
|---------|--------|-------------|---------|
| `device_register` | Desktop | Cloud | Register device |
| `mobile_auth` | Mobile | Cloud | Subscribe to devices |
| `device_offline` | Cloud | Mobile | Notify device disconnect |
| `hook_response` | Mobile | Cloud → Desktop | Popup approval response |

---

## Advantages

1. **No External Dependencies**: PostgreSQL already required for chat history
2. **Simple Implementation**: NOTIFY/LISTEN is straightforward SQL
3. **Efficient**: Only instances with subscribers receive notifications
4. **No Message Amplification**: Unidirectional flow terminates at Mobiles
5. **State Persistence**: Sessions table provides history for late-joining Mobiles

---

## Limitations

1. **No Guaranteed Delivery**: NOTIFY is fire-and-forget (no persistence)
   - If Mobile disconnects during NOTIFY, it misses the message
   - Solution: Mobile reconnects → queries sessions table → gets latest state

2. **Payload Size Limit**: NOTIFY payload max 8000 bytes
   - Solution: Keep payloads minimal (status JSON, not full hook_body)

3. **Single PostgreSQL**: NOTIFY only works within same PostgreSQL cluster
   - If using multiple PostgreSQL instances, need additional sync mechanism

---

## Alternative Considered: Redis Pub/Sub

| Approach | Pros | Cons |
|----------|------|------|
| PostgreSQL NOTIFY/LISTEN | No new dependency, already have PostgreSQL | Payload limit 8000 bytes |
| Redis Pub/Sub | Larger payload, separate scaling | New dependency, separate deployment |

**Decision:** PostgreSQL NOTIFY/LISTEN chosen because:
- Project already uses PostgreSQL for chat history
- Payloads are small (session status JSON)
- Simpler deployment (one less service)