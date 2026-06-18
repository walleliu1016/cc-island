# WebSocket → Socket.IO Migration Design

**Date:** 2026-06-18
**Branch:** `feature/socket.io`
**Status:** Draft

## Motivation

Replace raw WebSocket (`tokio-tungstenite`) with Socket.IO across all three layers to leverage built-in connection management (heartbeat, reconnection, rooms, middleware auth) and eliminate ~600 lines of self-built infrastructure code.

## Current State

### Architecture

```
Desktop (Rust) --raw WS--> Cloud Server (Rust) <--raw WS-- Mobile (TypeScript)
     tokio-tungstenite          tokio-tungstenite            browser WebSocket API
```

### Self-built infrastructure to replace

| Mechanism | Where | Lines |
|-----------|-------|-------|
| Manual reconnection (exponential backoff) | `cloud_client.rs`, `useAllDevicesWebSocket.ts` | ~100 |
| Custom heartbeat (ping/pong events) | `connection.rs`, `cloud_client.rs`, mobile hook | ~80 |
| HashMap-based connection router | `router.rs` | ~150 |
| Oneshot channels for request/response | `handler.rs` | ~50 |
| Auth timeout (30s) | `connection.rs` | ~40 |
| TCP keepalive config | `server.rs` | ~20 |
| PostgreSQL LISTEN/NOTIFY cross-instance | `notify_listener.rs` + `pending_messages` | ~250 |
| Message type enum dispatch | `messages.rs` | ~80 |

## Target State

### Architecture

```
Desktop (Rust) --Socket.IO--> Cloud Server (Rust) <--Socket.IO-- Mobile (TypeScript)
  rust-socketio                socketioxide                     socket.io-client
                             + socketioxide-postgres
```

### Dependency Changes

| Layer | Remove | Add |
|-------|--------|-----|
| Cloud Server | `tokio-tungstenite 0.21` | `socketioxide 0.18`, `socketioxide-postgres 0.1` |
| Desktop Client | `tokio-tungstenite 0.26`, `native-tls` | `rust-socketio 0.6` |
| Mobile App | (browser `WebSocket`) | `socket.io-client ^4.8` |

### Protocol Design

All 17 `CloudMessage` variants replaced by Socket.IO events across 4 namespaces:

#### `/` (default) — Connection auth via middleware

```
io.use(auth_middleware)
  → desktop connects: auth { device_token, hostname, device_name }
  → mobile connects:  auth { device_tokens: [...] }
  
Built-in heartbeat handles keepalive.
Replaced: device_register, mobile_auth, auth_success, auth_failed, ping/pong
```

#### `/hooks` — Hook relay

| Direction | Event | Payload |
|-----------|-------|---------|
| desktop → server → mobile | `hook` | `{ session_id, hook_type, hook_body }` |
| mobile → server → desktop | `hook:response` | `{ session_id, decision, answers }` |
| any → server → all mobiles | `popup:resolved` | `{ popup_id, session_id, source, decision }` |

Replaced: `HookMessage`, `HookResponse`, `PopupResolved`

#### `/chat` — Chat history

| Direction | Event | Payload |
|-----------|-------|---------|
| desktop → server → mobile | `history` | `{ session_id, messages: [...] }` |
| mobile → server → desktop | `history:request` | `{ session_id, limit }` + ack callback |

Replaced: `ChatHistory`, `RequestChatHistory`

#### `/sessions` — Session list

| Direction | Event | Payload |
|-----------|-------|---------|
| server → desktop | `list:request` | `{ device_token, mobile_conn_id }` |
| desktop → server | `list:response` | `{ ..., sessions: [...] }` + ack |

Replaced: `RequestSessionList`, `SessionListResponse`, `SessionList`

#### `/devices` — Device presence

| Direction | Event | Payload |
|-----------|-------|---------|
| server → mobile | `online` | `{ device: { token, hostname, online: true } }` |
| server → mobile | `offline` | `{ device_token }` |
| server → mobile (on connect) | `list` | `{ devices: [...] }` |

Replaced: `DeviceList`, `DeviceOnline`, `DeviceOffline`

#### Room-based routing

```
desktop socket  → socket.join("device:{token}")
mobile subscribe → socket.join("device:{token}")

Broadcast:  io.of('/hooks').to('device:{token}').emit('hook', ...)
Unicast:    io.of('/sessions').to('device:{token}').emit('list:request', ...)
```

Replaced: `router.rs` (desktop_connections, mobile_connections, mobile_subscriptions HashMaps)

#### Cross-instance

`socketioxide-postgres` adapter handles all multi-node message routing via PostgreSQL LISTEN/NOTIFY.

Replaced: `notify_listener.rs` + `pending_messages` table

### File Changes

#### Cloud Server (`cloud-server/`)

| File | Action | Notes |
|------|--------|-------|
| `Cargo.toml` | **Modify** | Replace tokio-tungstenite with socketioxide + socketioxide-postgres |
| `src/ws/server.rs` | **Rewrite** | `SocketIo::builder().with_adapter::<SqlxAdapter>(adapter).build_layer()` |
| `src/ws/connection.rs` | **Delete** | Auth → middleware, timeout → built-in |
| `src/ws/router.rs` | **Delete** | HashMap routing → rooms |
| `src/ws/handler.rs` | **Rewrite** | Split into namespace handlers |
| `src/ws/notify_listener.rs` | **Delete** | Replaced by socketioxide-postgres adapter |
| `src/ws/mod.rs` | **Modify** | New module structure |
| `src/messages.rs` | **Delete** | Replaced by per-namespace event types |
| `src/main.rs` | **Modify** | Init with adapter, mount on axum |
| `src/ws/auth.rs` | **New** | Auth middleware (desktop device_register + mobile mobile_auth) |
| `src/ws/events.rs` | **New** | Event payload types |
| `src/ws/handlers/hooks.rs` | **New** | `/hooks` namespace |
| `src/ws/handlers/chat.rs` | **New** | `/chat` namespace |
| `src/ws/handlers/sessions.rs` | **New** | `/sessions` namespace |
| `src/ws/handlers/devices.rs` | **New** | `/devices` namespace |
| `migrations/004_pending_messages.sql` | **Delete** | Adapter handles this internally |

#### Desktop Client (`src-tauri/`)

| File | Action | Notes |
|------|--------|-------|
| `Cargo.toml` | **Modify** | Replace tokio-tungstenite with rust-socketio |
| `src/cloud_client.rs` | **Rewrite** | Use rust-socketio Client; remove reconnection, heartbeat, mpsc channel |
| `src/lib.rs` | **Modify** | Simplify cloud start/stop logic |

#### Mobile App (`mobile-app/`)

| File | Action | Notes |
|------|--------|-------|
| `package.json` | **Modify** | Add socket.io-client |
| `src/hooks/useAllDevicesWebSocket.ts` | **Rewrite** | Rename to `useSocketIO.ts`; remove reconnection, heartbeat, visibility hack |
| `src/App.tsx` | **Modify** | Adapt to new hook API |
| `src/types.ts` | **Rewrite** | Per-namespace event types |
| `capacitor.config.ts` | **Modify** | Allow `http://` for Socket.IO handshake |

### Net Code Change

```
~700 lines deleted  (router, connection, messages, notify_listener, pending_messages, 
                      manual reconnect, heartbeat, oneshot channels)
~500 lines added     (namespace handlers, auth middleware, event types)
─────────────────
~200 lines net decrease
```

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `rust-socketio` less mature than tokio-tungstenite | Medium | Verify reconnection/auth features before committing; consider `socketioxide` client fork if needed |
| `socketioxide-postgres` is newer/less battle-tested | Medium | Test multi-instance scenarios early; adapter API is simple enough to replace if issues arise |
| One-shot migration, no rollback protocol | Low | Single commit on feature branch; can revert entire branch |
| All tests need rewrite | Medium | Rewrite integration tests with socket.io-client as test driver |

### Test Strategy

| Layer | Approach |
|-------|----------|
| Cloud Server | Use `socket.io-client` (Node.js) as test client; test auth, event routing, rooms, cross-instance via adapter |
| Desktop Client | Rust unit tests with mock Socket.IO server |
| Mobile App | Existing Vitest setup; mock `socket.io-client` |

Reset integration tests: `connection_integration_test.rs`, `handler_test.rs`, `handler_integration_test.rs`.
Remove: `router_test.rs`, `routing_test.rs` (router deleted).
