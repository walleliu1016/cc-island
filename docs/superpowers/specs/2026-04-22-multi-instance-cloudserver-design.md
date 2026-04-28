# Multi-Instance Cloud Server Architecture Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable cloud-server to run multiple instances for high availability and scalability, using PostgreSQL LISTEN/NOTIFY for cross-instance message routing without external dependencies.

**Architecture:** Each instance maintains local connection state in memory. Cross-instance messages are persisted to PostgreSQL and broadcast via NOTIFY. Instances check if the target connection belongs to them, retrieve and deliver the message, then delete it.

**Tech Stack:** PostgreSQL LISTEN/NOTIFY, tokio async runtime, existing ConnectionRouter pattern

---

## 1. Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │           PostgreSQL                │
                    │  ┌─────────────┐ ┌───────────────┐  │
                    │  │pending_msgs │ │ LISTEN/NOTIFY │  │
                    │  └─────────────┘ └───────────────┘  │
                    └─────────────────────────────────────┘
                              ↑ INSERT      ↑↓ NOTIFY (lightweight)
                              │             │
        ┌─────────────────────┼─────────────┼─────────────────────┐
        │                     │             │                     │
   ┌────┴───┐            ┌────┴───┐    ┌────┴───┐            ┌────┴───┐
   │ 实例 A │            │ 实例 B │    │ 实例 C │            │ 实例 D │
   ├────────┤            ├────────┤    ├────────┤            ├────────┤
   │内存表: │            │内存表: │    │内存表: │            │内存表: │
   │desktop │            │desktop │    │desktop │            │desktop │
   │- tok1  │            │- tok3  │    │- tok5  │            │- tok7  │
   │- tok2  │            │- tok4  │    │- tok6  │            │- tok8  │
   │mobile  │            │mobile  │    │mobile  │            │mobile  │
   │- tok1  │            │- tok2  │    │- tok3  │            │- tok4  │
   └─────────┘            └─────────┘    └─────────┘            └─────────┘
       ↑                      ↑              ↑                    ↑
   Desktop                 Mobile         Desktop               Mobile
   (tok1,tok2)             (tok1,tok2)    (tok5,tok6)           (tok7,tok8)
```

### Core Flow

**Desktop → Mobile Message:**
1. Instance receives Desktop message → check local memory for subscribed Mobile
2. Has subscriber → direct memory broadcast (fast path)
3. No subscriber → INSERT to pending_messages + NOTIFY broadcast
4. Other instances receive NOTIFY → check local memory → if belongs to them, retrieve message, deliver, delete

**Mobile → Desktop Message:**
- Same logic, reversed direction

**Benefit:** Intra-instance messages bypass NOTIFY, minimizing DB operations.

---

## 2. Database Design

### New Table: pending_messages

```sql
-- Migration: 004_pending_messages.sql
CREATE TABLE pending_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('to_mobile', 'to_desktop')),
    message_type TEXT NOT NULL,
    message_body JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pending_device_direction
    ON pending_messages(device_token, direction, created_at);
```

### NOTIFY Payload Format

NOTIFY carries minimal information (JSON string):

```json
{
    "device_token": "abc123",
    "direction": "to_mobile",
    "message_id": "uuid-xxx"
}
```

---

## 3. Instance Component Design

### New Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `NotifyListener` | `ws/notify_listener.rs` | LISTEN PostgreSQL NOTIFY, parse payload, check if connection belongs to this instance |
| `PendingMessageRepo` | `db/pending_message.rs` | INSERT/SELECT/DELETE operations on pending_messages table |

### Modified Components

| Component | File | Changes |
|-----------|------|---------|
| `ConnectionRouter` | `ws/router.rs` | Add `has_mobile_subscribers(device_token)` and `has_desktop_connection(device_token)` methods |
| `MessageHandler` | `ws/handler.rs` | Before sending, check local connections, decide memory direct or NOTIFY path |

### Core Logic (MessageHandler.handle)

```rust
// Decision logic when sending messages
fn send_message(device_token: &str, direction: &str, message: Message) {
    if direction == "to_mobile" {
        if router.has_mobile_subscribers(&device_token) {
            // Local subscriber exists → memory direct
            router.broadcast_to_mobiles(&device_token, message);
        } else {
            // No local subscriber → store + NOTIFY
            let msg_id = pending_repo.insert(&device_token, direction, message);
            notify_repo.notify(&device_token, direction, &msg_id);
        }
    } else if direction == "to_desktop" {
        if router.has_desktop_connection(&device_token) {
            router.send_to_desktop(&device_token, message);
        } else {
            let msg_id = pending_repo.insert(&device_token, direction, message);
            notify_repo.notify(&device_token, direction, &msg_id);
        }
    }
}
```

### NotifyListener Logic

```rust
// Handle incoming NOTIFY
fn handle_notify(payload: &str) {
    let notify_data = parse_notify_payload(payload);

    // Check if target connection belongs to this instance
    if notify_data.direction == "to_mobile"
        && router.has_mobile_subscribers(&notify_data.device_token) {
        // Belongs to us → retrieve → deliver → delete
        let msg = pending_repo.get_and_delete(&notify_data.message_id);
        if let Some(message) = msg {
            router.broadcast_to_mobiles(&notify_data.device_token, message);
        }
    } else if notify_data.direction == "to_desktop"
        && router.has_desktop_connection(&notify_data.device_token) {
        let msg = pending_repo.get_and_delete(&notify_data.message_id);
        if let Some(message) = msg {
            router.send_to_desktop(&notify_data.device_token, message);
        }
    }
    // Not ours → skip
}
```

---

## 4. Startup and Connection Lifecycle

### Instance Startup Flow

```
Instance Start
    │
    ├─► Initialize ConnectionRouter (memory connection table)
    │
    ├─► Initialize Repository (DB connection pool)
    │
    ├─► Initialize PendingMessageRepo
    │
    ├─► Start NotifyListener
    │       │
    │       ├─► LISTEN 'pending_message_notify'
    │       │
    │       └─► Loop: listen NOTIFY → call handle_notify()
    │
    └─► Start WebSocket Server (accept client connections)
```

### Connection Establish (unchanged)

```
Client connects → sends DeviceRegister/MobileAuth
    │
    ├─► ConnectionRouter.register_desktop() or register_mobile()
    │       (record in local memory HashMap)
    │
    ├─► Send AuthSuccess
    │
    └─► Begin normal message processing
```

### Connection Disconnect (unchanged)

```
Client disconnects → ConnectionRouter.unregister_xxx()
    │
    └─► Remove from local memory HashMap
    │
    (pending_messages need no handling, natural expiry or delivered by other instance)
```

### Intra-Instance Message (Fast Path)

```
Desktop sends HookMessage
    │
    ├─► MessageHandler.handle()
    │       │
    │       ├─► router.has_mobile_subscribers(device_token)?
    │       │       YES → router.broadcast_to_mobiles() (memory direct)
    │       │       NO  → pending_repo.insert() + notify()
    │
    └─► Message processed
```

---

## 5. Error Handling and Edge Cases

### Case 1: NOTIFY arrives but message already delivered by other instance

```
Instance A receives NOTIFY → checks local connection → goes to DB → message not found (deleted by Instance B)
```

**Handling:** Query returns empty → ignore, no impact

### Case 2: Instance crashes after INSERT but before NOTIFY

```
Instance A INSERT message → (crashes before NOTIFY)
```

**Handling:** Message stays in DB, cleaned up by stale message cleanup task

### Case 3: Message arrives when target connection disconnected

```
Mobile disconnects → NOTIFY arrives → instance checks no subscriber → skips → message stays in DB
```

**Handling:** Message stays in DB, cleaned up by stale message cleanup task

### Stale Message Cleanup Task

```rust
// Cleanup messages older than 5 minutes, runs every minute
async fn cleanup_stale_messages() {
    pending_repo.delete_where("created_at < NOW() - INTERVAL '5 minutes'");
}
```

**Why 5 minutes:**
- Gives NOTIFY processing enough time
- Short buffer for potential reconnect (no harm with discard strategy)
- Prevents table from growing indefinitely

### Case 4: PostgreSQL LISTEN connection disconnects

```
NotifyListener's LISTEN connection drops due to network issue
```

**Handling:**
- LISTEN uses dedicated DB connection, must be long-lived
- On disconnect: reconnect + re-LISTEN
- NOTIFY messages during reconnect gap are lost (acceptable with relaxed latency requirement)

---

## 6. Testing Strategy

### Unit Tests

| Test | Content |
|------|---------|
| `ConnectionRouter.has_mobile_subscribers()` | Test subscription check logic |
| `ConnectionRouter.has_desktop_connection()` | Test connection check logic |
| `PendingMessageRepo.insert/get/delete` | Test message CRUD |

### Integration Tests

| Test | Content |
|------|---------|
| Single instance memory direct | Desktop+Mobile same instance, no NOTIFY |
| Cross-instance NOTIFY | Desktop on Instance A, Mobile on Instance B, message delivered correctly |
| Multi-instance race | Multiple instances receive NOTIFY simultaneously, only one successfully delivers and deletes |
| Disconnect discard | Mobile disconnects, messages to it stay in DB, cleaned up by timer |
| LISTEN reconnect | Simulate LISTEN connection drop, auto reconnect and recovery |

### Test Environment

- Start 2-3 instance processes locally, different ports
- Share same PostgreSQL (with pending_messages table)
- Use simulated clients to verify cross-instance messaging

---

## 7. Implementation Files

| Category | Files |
|----------|-------|
| Migration | `cloud-server/migrations/004_pending_messages.sql` |
| New Components | `cloud-server/src/ws/notify_listener.rs`, `cloud-server/src/db/pending_message.rs` |
| Modified Components | `cloud-server/src/ws/router.rs`, `cloud-server/src/ws/handler.rs` |
| Main | `cloud-server/src/main.rs` (start NotifyListener) |

---

## 8. Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Cross-instance mechanism | PostgreSQL LISTEN/NOTIFY | Zero external dependencies, built-in pub/sub |
| Message storage | Store in DB, NOTIFY minimal payload | Reduce NOTIFY payload size, retrieve on demand |
| Connection state | Local memory HashMap | Simple, no DB registration overhead |
| Offline handling | Discard + 5-min cleanup | Relaxed latency, no persistence needed |
| Instance assignment | Random (no hash) | NOTIFY overhead small, avoid redirect complexity |
| Cleanup interval | Every minute, 5-min threshold | Balance cleanup overhead and table growth |