# Cloud Relay Protocol Documentation

> **Version:** 2.0  
> **Last Updated:** 2026-04-17  
> **Status:** Active

## Overview

CC-Island cloud relay enables remote monitoring and control of Claude Code sessions from mobile devices. The protocol supports:
- Real-time state synchronization between Desktop and Mobile clients
- Remote popup approval (Permission and AskUserQuestion)
- Multi-device subscription from a single mobile connection

---

## Architecture

### Components

```
┌─────────────────┐                    ┌─────────────────┐
│   Desktop App   │◄──── WebSocket ───►│   Cloud Server  │
│  (Tauri/Rust)   │     Port 8080      │    (Rust/Axum)  │
│                 │                    │                 │
│ - HTTP Hooks    │                    │ - Router        │
│ - CloudClient   │                    │ - StateCache    │
│ - PopupQueue    │                    │ - Repository    │
└─────────────────┘                    └─────────────────┘
                                               │
                                               │ WebSocket
                                               │
                               ┌───────────────┴───────────────┐
                               │                               │
                        ┌──────┴──────┐                 ┌──────┴──────┐
                        │  Mobile 1   │                 │  Mobile 2   │
                        │  (React)    │                 │  (React)    │
                        │             │                 │             │
                        │ - Subscribe │                 │ - Subscribe │
                        │   [A, B]    │                 │   [A]       │
                        └─────────────┘                 └─────────────┘
```

### Connection Management

**Desktop Connection:**
- Registers with `device_register` containing unique `device_token`
- Pushes state updates, popups, chat messages to cloud
- Receives popup responses from mobile clients

**Mobile Connection:**
- Authenticates with `mobile_auth` containing `device_tokens[]` (array)
- Single WebSocket connection subscribes to multiple desktops
- Receives broadcast messages for subscribed devices
- Sends popup responses back to specific desktop

### Router Data Structures

```rust
// cloud-server/src/ws/router.rs
struct RouterInner {
    // Desktop: one token → one connection
    desktop_connections: HashMap<String, Sender<Message>>,
    
    // Mobile: one token → multiple connections (multiple users can subscribe same device)
    mobile_connections: HashMap<String, Vec<(Uuid, Sender<Message>)>>,
    
    // Reverse index: connection_id → subscribed tokens (for cleanup)
    mobile_subscriptions: HashMap<Uuid, Vec<String>>,
}
```

---

## WebSocket Connection Management

### Connection Types

| Client | Authentication | Connection ID | Subscription |
|--------|----------------|---------------|--------------|
| Desktop | `device_register` + single token | device_token | Pushes state for one device |
| Mobile | `mobile_auth` + token array | UUID (generated) | Subscribes to multiple devices |

### Desktop Connection Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                    Desktop Connection Flow                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Connect                                                  │
│     │                                                        │
│     ├─► WebSocket.connect(server_url)                        │
│     │                                                        │
│  2. Register                                                 │
│     │                                                        │
│     ├─► Send: { type: "device_register",                     │
│     │          device_token: "abc123",                       │
│     │          device_name: "Office" }                       │
│     │                                                        │
│  3. Auth Success                                             │
│     │                                                        │
│     ◄─ Receive: { type: "auth_success",                      │
│                  device_id: "abc123" }                       │
│     │                                                        │
│     ├─► Router: desktop_connections["abc123"] = sender       │
│     ├─► CloudClient.connected = true                         │
│     │                                                        │
│  4. Runtime                                                  │
│     │                                                        │
│     ├─► Push StateUpdate (on hook events)                    │
│     ├─► Push NewPopup (on PermissionRequest/Elicitation)     │
│     ├─► Push ChatMessages (on chat history updates)          │
│     ├─► Receive PopupResponse (from mobile) → resolve popup  │
│     │                                                        │
│  5. Disconnect                                               │
│     │                                                        │
│     ├─► Router: unregister_desktop("abc123")                 │
│     ├─► Repository: set_device_offline("abc123")             │
│     ├─► Cache: remove_device("abc123")                       │
│     ├─► Broadcast: DeviceOffline { device_token: "abc123" }  │
│     │        to all subscribed mobiles                       │
│     │                                                        │
└──────────────────────────────────────────────────────────────┘
```

**Implementation:** `src-tauri/src/cloud_client.rs`

```rust
pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
    let (ws_stream, _) = connect_async(&self.config.server_url).await?;
    let (ws_tx, ws_rx) = ws_stream.split();
    
    // Send device registration
    ws_tx.send(Message::text(json!({
        "type": "device_register",
        "device_token": self.device_token,
        "device_name": self.config.device_name,
    }).to_string())).await?;
    
    // Wait for auth_success
    match ws_rx.next().await {
        Some(Ok(Message::Text(text))) => {
            let json: Value = serde_json::from_str(&text)?;
            if json["type"] == "auth_success" {
                *self.connected.write() = true;
            }
        }
        ...
    }
    
    // Spawn send/receive tasks
    tokio::spawn(async move {
        tokio::select! {
            _ = send_task => {},
            _ = recv_task => {},
        }
    });
}
```

### Mobile Connection Lifecycle (Single Connection → Multiple Devices)

```
┌──────────────────────────────────────────────────────────────┐
│                 Mobile Connection Flow (Multi-Subscribe)      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Connect                                                  │
│     │                                                        │
│     ├─► WebSocket.connect(server_url)                        │
│     │   (Single physical connection)                         │
│     │                                                        │
│  2. Subscribe                                                │
│     │                                                        │
│     ├─► Send: { type: "mobile_auth",                         │
│     │          device_tokens: ["abc123", "def456"] }         │
│     │   (Subscribe to multiple desktops at once)             │
│     │                                                        │
│  3. Auth Success + Device List                               │
│     │                                                        │
│     ◄─ Receive: { type: "auth_success",                      │
│                  device_id: "abc123" }                       │
│     │                                                        │
│     ◄─ Receive: { type: "device_list",                       │
│                  devices: ["abc123", "def456"] }              │
│     │   (List of currently online desktops)                  │
│     │                                                        │
│     ├─► Router: conn_id = Uuid::new_v4()                     │
│     ├─► Router: mobile_subscriptions[conn_id] = ["abc123","def456"]
│     ├─► Router: mobile_connections["abc123"].push((conn_id, sender))
│     ├─► Router: mobile_connections["def456"].push((conn_id, sender))
│     │                                                        │
│  4. Receive Aggregated State                                 │
│     │                                                        │
│     ◄─ Receive: { type: "initial_state",                     │
│                  sessions: [...],                            │
│                  popups: [...] }                              │
│     │   (Aggregated from all subscribed devices)             │
│     │                                                        │
│  5. Runtime                                                  │
│     │                                                        │
│     ◄─ Receive: NewPopupFromDevice { device_token, popup }   │
│     ◄─ Receive: PopupResolved { device_token, popup_id, ... }
│     ◄─ Receive: DeviceOffline { device_token: "abc123" }     │
│     │                                                        │
│     ├─► Send: RespondPopup { device_token, popup_id, ... }   │
│     │   (Routes to correct desktop via device_token)         │
│     │                                                        │
│  6. Disconnect                                               │
│     │                                                        │
│     ├─► Router: unregister_mobile(conn_id)                   │
│     │        ├─► Lookup mobile_subscriptions[conn_id]         │
│     │        │    = ["abc123", "def456"]                      │
│     │        ├─► Remove from mobile_connections["abc123"]     │
│     │        ├─► Remove from mobile_connections["def456"]     │
│     │        └─► Desktops continue running (no effect)       │
│     │                                                        │
└──────────────────────────────────────────────────────────────┘
```

**Implementation:** `mobile-app/src/hooks/useAllDevicesWebSocket.ts`

```typescript
export function useAllDevicesWebSocket({ devices, serverUrl, showToast }) {
  const wsRef = useRef<WebSocket | null>(null)  // Single connection
  const [state, setState] = useState<AggregatedState>({
    serverConnected: false,
    serverConnecting: false,
    devices: {},
    allSessions: [],
    allPopups: [],
  })

  const connect = useCallback(() => {
    if (devices.length === 0) return
    
    const ws = new WebSocket(serverUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Subscribe to all devices in single auth message
      ws.send(JSON.stringify({
        type: 'mobile_auth',
        device_tokens: devices,  // Array of device tokens
      }))
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      switch (msg.type) {
        case 'device_list':     // Online devices list
        case 'device_offline':  // Device went offline
        case 'new_popup_from_device':  // New popup from subscribed device
        case 'popup_resolved':  // Popup resolved notification
        ...
      }
    }

    ws.onclose = () => {
      // Reconnect after 5 seconds
      setTimeout(() => connect(), 5000)
    }
  }, [serverUrl, devices])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])
}
```

### Router Connection Routing

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Router Routing Logic                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Desktop A (token: "abc")          Desktop B (token: "def")              │
│       │                                 │                                │
│       ├─► register_desktop("abc")       ├─► register_desktop("def")      │
│       │                                 │                                │
│       │   desktop_connections = {       │                                │
│       │     "abc": sender_A,            │                                │
│       │     "def": sender_B             │                                │
│       │   }                             │                                │
│       │                                 │                                │
│  ─────┴─────────────────────────────────┴────────────────────────────────│
│                                                                          │
│  Mobile 1 (subscribes ["abc", "def"])                                    │
│       │                                                                  │
│       ├─► register_mobile(["abc", "def"], sender_M1)                     │
│       │   ├─► conn_id = uuid_1                                           │
│       │   ├─► mobile_subscriptions[uuid_1] = ["abc", "def"]              │
│       │   ├─► mobile_connections["abc"].push((uuid_1, sender_M1))        │
│       │   └─► mobile_connections["def"].push((uuid_1, sender_M1))        │
│       │                                                                  │
│  Mobile 2 (subscribes ["abc"])                                           │
│       │                                                                  │
│       ├─► register_mobile(["abc"], sender_M2)                            │
│       │   ├─► conn_id = uuid_2                                           │
│       │   ├─► mobile_subscriptions[uuid_2] = ["abc"]                     │
│       │   └─► mobile_connections["abc"].push((uuid_2, sender_M2))        │
│       │                                                                  │
│  ─────┴──────────────────────────────────────────────────────────────────│
│                                                                          │
│  Final State:                                                            │
│                                                                          │
│  desktop_connections = {                                                 │
│    "abc": sender_A,                                                      │
│    "def": sender_B                                                       │
│  }                                                                       │
│                                                                          │
│  mobile_connections = {                                                  │
│    "abc": [(uuid_1, sender_M1), (uuid_2, sender_M2)],  // 2 subscribers  │
│    "def": [(uuid_1, sender_M1)]                         // 1 subscriber  │
│  }                                                                       │
│                                                                          │
│  mobile_subscriptions = {                                                │
│    uuid_1: ["abc", "def"],  // Mobile 1's subscriptions                  │
│    uuid_2: ["abc"]          // Mobile 2's subscriptions                  │
│  }                                                                       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Message Routing Examples

#### Example 1: Desktop A pushes state_update

```
Desktop A → state_update { device_token: "abc", sessions, popups }
        │
        ├─► Cloud: broadcast_to_mobiles("abc", msg)
        │       │
        │       ├─► Lookup mobile_connections["abc"]
        │       │    = [(uuid_1, sender_M1), (uuid_2, sender_M2)]
        │       │
        │       ├─► Send to sender_M1 → Mobile 1 receives
        │       └─► Send to sender_M2 → Mobile 2 receives
        │
        └─► Desktop B does NOT receive (only subscribed to "def")
```

#### Example 2: Mobile 1 responds to popup

```
Mobile 1 → respond_popup { device_token: "abc", popup_id: "p1", decision: "allow" }
        │
        ├─► Cloud: send_to_desktop("abc", PopupResponse)
        │       │
        │       ├─► Lookup desktop_connections["abc"]
        │       │    = sender_A
        │       │
        │       ├─► Send to sender_A → Desktop A receives
        │       │
        │       └─► Desktop A: popup_queue.resolve() → hook unblocks
        │
        ├─► Cloud: broadcast PopupResolved { device_token: "abc", source: "mobile" }
        │       │
        │       ├─► Send to sender_M1 → Mobile 1 confirms removal
        │       └─► Send to sender_M2 → Mobile 2 removes popup
```

#### Example 3: Desktop A disconnects

```
Desktop A closes WebSocket
        │
        ├─► Cloud: unregister_desktop("abc")
        │       │
        │       ├─► desktop_connections.remove("abc")
        │       │
        │       ├─► broadcast_to_mobiles("abc", DeviceOffline { device_token: "abc" })
        │       │       │
        │       │       ├─► Send to sender_M1 → Mobile 1 removes "abc" data
        │       │       └─► Send to sender_M2 → Mobile 2 removes "abc" data
        │       │
        │       ├─► Repository: set_device_offline("abc")
        │       │
        │       └─► Cache: remove_device("abc")
        │
        └─► Desktop B, Mobile 1, Mobile 2 continue unaffected
```

#### Example 4: Mobile 1 disconnects

```
Mobile 1 closes WebSocket
        │
        ├─► Cloud: unregister_mobile(uuid_1)
        │       │
        │       ├─► Lookup mobile_subscriptions[uuid_1]
        │       │    = ["abc", "def"]
        │       │
        │       ├─► mobile_connections["abc"].retain(|(id, _)| id != uuid_1)
        │       │    = [(uuid_2, sender_M2)]  // Mobile 2 still subscribed
        │       │
        │       ├─► mobile_connections["def"].retain(|(id, _)| id != uuid_1)
        │       │    = []  // Empty, remove entry
        │       │
        │       └─► mobile_subscriptions.remove(uuid_1)
        │
        └─► Desktop A, Desktop B continue running
        └─► Mobile 2 still receives Desktop A updates
```

### Auto-Reconnect

**Desktop Reconnect:** Not implemented (manual restart required)

**Mobile Reconnect:**
```typescript
ws.onclose = () => {
  setState(s => ({ ...s, serverConnected: false, serverConnecting: false }))
  
  // Reconnect after 5 seconds if devices list not empty
  if (serverUrl && devices.length > 0) {
    setTimeout(() => connect(), 5000)
  }
}
```

### Key Design Decisions

| Decision | Reason |
|----------|--------|
| Mobile single connection | Resource efficient; one WebSocket handles multiple subscriptions |
| UUID for mobile connection_id | `Sender<Message>` doesn't implement `Hash`/`Eq`, can't be HashMap key |
| Reverse index `mobile_subscriptions` | Enables efficient cleanup when mobile disconnects |
| Desktop disconnect → broadcast DeviceOffline | Mobile clients need to update UI immediately |
| Mobile disconnect → no broadcast | Desktops don't care; they continue running |

### Router Implementation

```rust
// cloud-server/src/ws/router.rs

impl ConnectionRouter {
    /// Register desktop: one token → one sender
    pub fn register_desktop(&self, device_token: &str, tx: Sender<Message>) {
        self.inner.write().desktop_connections.insert(device_token.to_string(), tx);
    }

    /// Register mobile: multiple tokens → one sender (with UUID tracking)
    pub fn register_mobile(&self, device_tokens: &[String], tx: Sender<Message>) -> Uuid {
        let mut inner = self.inner.write();
        let conn_id = Uuid::new_v4();
        
        // Store reverse index for cleanup
        inner.mobile_subscriptions.insert(conn_id, device_tokens.to_vec());
        
        // Add connection to each device's subscriber list
        for token in device_tokens {
            inner.mobile_connections
                .entry(token.clone())
                .or_insert_with(Vec::new)
                .push((conn_id, tx.clone()));
        }
        
        conn_id  // Return for cleanup on disconnect
    }

    /// Broadcast to all mobiles subscribed to a device
    pub fn broadcast_to_mobiles(&self, device_token: &str, msg: Message) {
        let inner = self.inner.read();
        if let Some(mobiles) = inner.mobile_connections.get(device_token) {
            for (_, tx) in mobiles {
                tx.try_send(msg.clone());
            }
        }
    }

    /// Send to desktop for a device
    pub fn send_to_desktop(&self, device_token: &str, msg: Message) -> bool {
        let inner = self.inner.read();
        if let Some(tx) = inner.desktop_connections.get(device_token) {
            tx.try_send(msg);
            return true;
        }
        false
    }

    /// Get all online devices (desktops currently connected)
    pub fn get_online_devices(&self) -> Vec<String> {
        self.inner.read().desktop_connections.keys().cloned().collect()
    }
}
```

---

## Message Types

### Authentication Messages

#### DeviceRegister (Desktop → Cloud)

```json
{
  "type": "device_register",
  "device_token": "abc123def456",
  "device_name": "Office Desktop"
}
```

#### MobileAuth (Mobile → Cloud)

```json
{
  "type": "mobile_auth",
  "device_tokens": ["abc123def456", "xyz789ghi012"]
}
```

**Note:** Mobile can subscribe to multiple devices in a single connection.

#### AuthSuccess (Cloud → Client)

```json
{
  "type": "auth_success",
  "device_id": "abc123def456",
  "device_name": "Office Desktop"
}
```

#### DeviceList (Cloud → Mobile)

Sent after mobile authentication, contains all currently online desktops.

```json
{
  "type": "device_list",
  "devices": ["abc123def456", "xyz789ghi012"]
}
```

#### DeviceOffline (Cloud → Mobile)

Broadcast when a desktop disconnects.

```json
{
  "type": "device_offline",
  "device_token": "abc123def456"
}
```

---

### State Sync Messages

#### StateUpdate (Desktop → Cloud)

Pushed on every state change (see Hook Events section for details).

```json
{
  "type": "state_update",
  "device_token": "abc123def456",
  "sessions": [
    {
      "session_id": "sess-001",
      "project_name": "cc-island",
      "status": "{\"type\":\"working\",\"data\":\"Bash\"}",
      "current_tool": "Bash",
      "tool_input": {"action": "npm test", "details": "/path/to/project"}
    }
  ],
  "popups": [
    {
      "id": "popup-001",
      "session_id": "sess-001",
      "project_name": "cc-island",
      "type": "permission",
      "data": {
        "tool_name": "Bash",
        "action": "npm test",
        "details": "/path/to/project"
      },
      "status": "pending"
    }
  ]
}
```

**Note:** `status` field is JSON-encoded `InstanceStatus` enum (see Status Parsing section).

#### NewPopup (Desktop → Cloud)

```json
{
  "type": "new_popup",
  "device_token": "abc123def456",
  "popup": {
    "id": "popup-001",
    "type": "permission",
    "data": {...},
    "status": "pending"
  }
}
```

#### NewPopupFromDevice (Cloud → Mobile)

```json
{
  "type": "new_popup_from_device",
  "device_token": "abc123def456",
  "popup": {...}
}
```

---

### Popup Response Messages

#### RespondPopup (Mobile → Cloud)

```json
{
  "type": "respond_popup",
  "device_token": "abc123def456",
  "popup_id": "popup-001",
  "decision": "allow",
  "answers": null
}
```

For AskUserQuestion:
```json
{
  "type": "respond_popup",
  "device_token": "abc123def456",
  "popup_id": "popup-002",
  "decision": null,
  "answers": [["React"], ["Dark", "Light"]]
}
```

#### PopupResponse (Cloud → Desktop)

```json
{
  "type": "popup_response",
  "popup_id": "popup-001",
  "decision": "allow",
  "answers": null
}
```

#### PopupResolved (Cloud → Mobile) - **NEW**

Broadcast to all mobiles when any client resolves a popup.

```json
{
  "type": "popup_resolved",
  "device_token": "abc123def456",
  "popup_id": "popup-001",
  "source": "desktop",
  "decision": "allow",
  "answers": null
}
```

For AskUserQuestion:
```json
{
  "type": "popup_resolved",
  "device_token": "abc123def456",
  "popup_id": "popup-002",
  "source": "desktop",
  "decision": null,
  "answers": [["React"], ["Dark", "Light"]]
}
```

**Fields:**
- `source`: `"desktop"` or `"mobile"` - indicates which client resolved
- `decision`: `"allow"` or `"deny"` for Permission type
- `answers`: Array of selected options per question for Ask type

---

### Chat Messages

#### ChatMessages (Desktop → Cloud)

```json
{
  "type": "chat_messages",
  "device_token": "abc123def456",
  "session_id": "sess-001",
  "messages": [
    {
      "id": "msg-001",
      "sessionId": "sess-001",
      "messageType": "user",
      "content": "Please implement feature X",
      "toolName": null,
      "timestamp": 1716123456000
    }
  ]
}
```

#### NewChat (Cloud → Mobile)

```json
{
  "type": "new_chat",
  "session_id": "sess-001",
  "messages": [...]
}
```

---

### Keepalive Messages

#### Ping (Desktop → Cloud)

```json
{"type": "ping"}
```

#### Pong (Cloud → Desktop)

```json
{"type": "pong"}
```

---

## Hook Events → Cloud Push

All hook events that change instance state trigger `push_state_to_cloud`.

### Events That Trigger Cloud Push

| Hook Event | Trigger | Desktop Status Change |
|------------|---------|-----------------------|
| `SessionStart` | ✅ | Create instance |
| `SessionEnd` | ✅ | Remove instance |
| `PermissionRequest` | ✅ | WaitingForApproval → create popup |
| `Elicitation` | ✅ | WaitingForApproval → create popup |
| `Stop` | ✅ | Working → Idle |
| `PreToolUse` | ✅ | Thinking → Working |
| `PostToolUse` | ✅ | Working → Waiting |
| `PostToolUseFailure` | ✅ | Working → Error |
| `PreCompact` | ✅ | Idle → Compacting |
| `PostCompact` | ✅ | Compacting → Idle |
| `UserPromptSubmit` | ✅ | Idle → Thinking |

**Implementation Location:** `src-tauri/src/http_server.rs`

```rust
// Example: PreToolUse triggers state push
"PreToolUse" => {
    instance.set_working(tool_name.clone(), tool_input);
    // ... record activity and chat message ...
    true // ← Returns true = push_state_to_cloud
}
```

### Chat Message Push

Chat messages are pushed separately via `push_chat_message_to_cloud`:

| Hook Event | Chat Message Type |
|------------|-------------------|
| `UserPromptSubmit` | User |
| `PreToolUse` | ToolCall |
| `PostToolUse` | ToolResult |
| `Stop` | Assistant |

---

## Status Parsing

### InstanceStatus Enum

Desktop sends status as JSON-encoded enum:

```rust
// src-tauri/src/instance_manager.rs
#[serde(tag = "type", content = "data")]
pub enum InstanceStatus {
    Idle,
    Thinking,
    Working(String),      // tool name
    Waiting,
    WaitingForApproval(String), // tool name
    Error,
    Compacting,
    Ended,
}
```

### JSON Examples

```json
{"type":"idle"}
{"type":"thinking"}
{"type":"working","data":"Bash"}
{"type":"waiting"}
{"type":"waitingForApproval","data":"Bash"}
{"type":"error"}
{"type":"compacting"}
{"type":"ended"}
```

### Mobile Parsing Logic

```typescript
// mobile-app/src/components/DeviceListPage.tsx
function parseSessionStatus(statusJson: string, currentTool?: string): { text: string; color: string } {
  const status = JSON.parse(statusJson)
  
  switch (status.type) {
    case 'idle': return { text: '空闲', color: 'bg-[#737373]' }
    case 'thinking': return { text: '思考中...', color: 'bg-[#22c55e]' }
    case 'working': return { text: `执行: ${status.data}`, color: 'bg-[#22c55e]' }
    case 'waiting': return { text: '等待继续', color: 'bg-[#3b82f6]' }
    case 'waitingForApproval': return { text: '需要授权', color: 'bg-[#f59e0b]' }
    case 'error': return { text: '错误', color: 'bg-[#ef4444]' }
    case 'compacting': return { text: '压缩上下文', color: 'bg-[#8b5cf6]' }
    case 'ended': return { text: '已结束', color: 'bg-[#737373]' }
  }
}
```

---

## Popup Synchronization

### Problem Statement

When both Desktop and Mobile can respond to the same popup:
- **Scenario A:** Mobile responds → Desktop unblocks → Desktop UI shows popup disappearance
- **Scenario B:** Desktop responds → Mobile shows popup → Popup disappears without feedback

### Solution: PopupResolved Broadcast

**Key Insight:** When Desktop locally resolves a popup, broadcast `PopupResolved` to all mobiles so they can:
1. Remove the popup from UI
2. Show toast notification: "已由 Desktop 处理"

### Message Flow Diagram

```
Desktop Creates Popup
        │
        ├─► NewPopup → Cloud → NewPopupFromDevice → Mobiles
        │
        ├─► Desktop blocks waiting for response
        │
        │   ┌─────────────────────────────────────┐
        │   │                                     │
        │   │   Mobile User Responds              │
        │   │          │                          │
        │   │          ├─► RespondPopup → Cloud   │
        │   │          │                          │
        │   │          │   Cloud:                 │
        │   │          │   ├─► PopupResponse → Desktop (unblock)
        │   │          │   └─► PopupResolved → All Mobiles
        │   │          │                          │
        │   │          └─► Mobile removes popup   │
        │   │                                     │
        │   └─────────────────────────────────────┘
        │
        │   ┌─────────────────────────────────────┐
        │   │                                     │
        │   │   Desktop User Responds             │
        │   │          │                          │
        │   │          ├─► POST /response         │
        │   │          │   └─► resolve popup      │
        │   │          │                          │
        │   │          ├─► push_popup_resolved    │
        │   │          │   └─► PopupResolved {    │
        │   │          │       source: "desktop", │
        │   │          │       decision: "allow"  │
        │   │          │   } → Cloud              │
        │   │          │                          │
        │   │          │   Cloud:                 │
        │   │          │   └─► broadcast PopupResolved → All Mobiles
        │   │          │                          │
        │   │          └─► Mobile receives:       │
        │   │              ├─► Remove popup       │
        │   │              └─► showToast("已由 Desktop 处理（允许）")
        │   │                                     │
        │   └─────────────────────────────────────┘
        │
        └─► Hook returns result to Claude Code
```

### Toast Notifications

| Scenario | Toast Message | Type |
|----------|---------------|------|
| Desktop allows permission | "已由 Desktop 处理（允许）" | success |
| Desktop denies permission | "已由 Desktop 处理（拒绝）" | warning |
| Desktop answers questions | "已由 Desktop 处理（React; Dark）" | success |
| Mobile self-resolves | No toast (user performed action) | - |

---

## Implementation Details

### Desktop: Push Popup Resolved

```rust
// src-tauri/src/http_server.rs
async fn handle_response(...) {
    // Resolve popup
    let resolved = state.popups.resolve(response.clone());
    
    if resolved {
        // Clear instance status
        instance.set_status(InstanceStatus::Idle);
        
        // Push to cloud
        push_popup_resolved_to_cloud(
            &state,
            &response.popup_id,
            response.decision.as_deref(),
            response.answers.as_ref(),
        );
    }
}

// src-tauri/src/cloud_client.rs
pub fn push_popup_resolved(&self, popup_id: &str, decision: Option<&str>, answers: Option<&Vec<Vec<String>>>) {
    let msg = json!({
        "type": "popup_resolved",
        "device_token": self.device_token,
        "popup_id": popup_id,
        "source": "desktop",
        "decision": decision,
        "answers": answers,
    });
    self.out_tx.try_send(Message::text(msg.to_string()));
}
```

### Cloud Server: Broadcast

```rust
// cloud-server/src/ws/handler.rs
CloudMessage::PopupResolved { device_token, popup_id, source, decision, answers } => {
    if source == "desktop" {
        self.cache.remove_popup(&device_token, &popup_id);
        
        // Broadcast to all mobiles
        let msg = CloudMessage::PopupResolved { ... };
        self.router.broadcast_to_mobiles(&device_token, Message::text(json));
    }
}
```

### Mobile: Handle PopupResolved

```typescript
// mobile-app/src/hooks/useAllDevicesWebSocket.ts
case 'popup_resolved': {
    const { popup_id, source, decision, answers } = msg;
    
    setState(s => ({
        ...s,
        allPopups: s.allPopups.filter(p => p.id !== popup_id)
    }));
    
    // Show toast if resolved by desktop
    if (source === 'desktop' && showToast) {
        const popup = s.allPopups.find(p => p.id === popup_id);
        if (popup?.type === 'permission') {
            showToast(`已由 Desktop 处理（${decision === 'allow' ? '允许' : '拒绝'}）`, ...);
        } else if (popup?.type === 'ask' && answers) {
            showToast(`已由 Desktop 处理（${answers.map(a => a.join(', ')).join('; ')}）`, 'success');
        }
    }
}
```

---

## Protocol Limitations

### Current Limitations

1. **No device_token in SessionState/PopupState:** 
   - Sessions and popups in `initial_state` don't carry device_token
   - Mobile assigns to "first subscribed device" as fallback
   - **Recommendation:** Add `device_token` field to these types

2. **No real-time chat history request:**
   - Mobile can request via `request_chat_history`
   - But new messages come via `new_chat` push

3. **No mobile → desktop direct messaging:**
   - All mobile messages go through cloud router
   - Desktop only receives `PopupResponse` for popups

### Potential Improvements

1. Add `device_token` to all session/popup data structures
2. Add `SessionOffline` message for session end events
3. Implement message queue for offline mobile clients
4. Add end-to-end encryption for sensitive data

---

## Message Summary Table

| Message | Source | Destination | Purpose |
|---------|--------|-------------|---------|
| `device_register` | Desktop | Cloud | Register device connection |
| `mobile_auth` | Mobile | Cloud | Subscribe to multiple devices |
| `auth_success` | Cloud | Client | Confirm authentication |
| `device_list` | Cloud | Mobile | List online devices |
| `device_offline` | Cloud | Mobile | Notify device disconnected |
| `state_update` | Desktop | Cloud → Mobile | Full state sync |
| `new_popup` | Desktop | Cloud | Create new popup |
| `new_popup_from_device` | Cloud | Mobile | Forward new popup |
| `respond_popup` | Mobile | Cloud | Respond to popup |
| `popup_response` | Cloud | Desktop | Forward popup response |
| `popup_resolved` | Cloud | Mobile | Notify popup resolved |
| `chat_messages` | Desktop | Cloud | Push chat history |
| `new_chat` | Cloud | Mobile | Forward chat messages |
| `ping` | Desktop | Cloud | Keepalive |
| `pong` | Cloud | Desktop | Keepalive response |

---

## Related Files

| Component | File | Purpose |
|-----------|------|---------|
| Desktop HTTP Hooks | `src-tauri/src/http_server.rs` | Process hooks, push to cloud |
| Desktop Cloud Client | `src-tauri/src/cloud_client.rs` | WebSocket connection, push messages |
| Desktop Popup Queue | `src-tauri/src/popup_queue.rs` | Manage pending popups |
| Desktop Instance Manager | `src-tauri/src/instance_manager.rs` | InstanceStatus enum |
| Cloud Server Messages | `cloud-server/src/messages.rs` | Message type definitions |
| Cloud Server Handler | `cloud-server/src/ws/handler.rs` | Process incoming messages |
| Cloud Server Router | `cloud-server/src/ws/router.rs` | Connection routing |
| Cloud Server Connection | `cloud-server/src/ws/connection.rs` | WebSocket connection handler |
| Cloud Server Cache | `cloud-server/src/cache/state_cache.rs` | In-memory state cache |
| Mobile WebSocket Hook | `mobile-app/src/hooks/useAllDevicesWebSocket.ts` | Single connection, multi-device |
| Mobile Types | `mobile-app/src/types.ts` | TypeScript type definitions |
| Mobile Popup Card | `mobile-app/src/components/PopupCard.tsx` | Popup UI component |
| Mobile Device List | `mobile-app/src/components/DeviceListPage.tsx` | Device/session list |