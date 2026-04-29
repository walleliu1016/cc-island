# CC-MCP-Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Channel MCP Server that enables Mobile → Claude Code bidirectional messaging through Cloud Relay.

**Architecture:** MCP Bridge spawns per Claude session (stdio transport), connects to Desktop via WebSocket (localhost:17530), routes messages: Mobile → Cloud → Desktop → MCP Bridge → Claude. Claude replies via `reply` tool back to Mobile.

**Tech Stack:** Bun + TypeScript (MCP Bridge), Rust + Axum + WebSocket (Desktop), Rust + PostgreSQL + WebSocket (Cloud Server), React + TypeScript (Mobile)

---

## File Structure

```
cc-mcp-bridge/                   # 新目录 - MCP Bridge Server
├── package.json
├── server.ts                    # MCP Server + WebSocket Client
└── .mcp.json                    # MCP 配置文件

src-tauri/src/
├── ws_server.rs                 # 新文件 - WebSocket Server for MCP Bridge
├── lib.rs                       # 修改 - 启动 ws_server，添加 mcp_bridges 字段
├── cloud_client.rs              # 修改 - 添加 send_chat_reply 方法

cloud-server/src/
├── messages.rs                  # 修改 - 添加 ChatMessage/ChatReply 类型
├── ws/handler.rs                # 修改 - 处理 chat_message/chat_reply 路由

mobile-app/src/
├── components/ChatInput.tsx     # 新文件 - 聊天输入组件
├── hooks/useAllDevicesWebSocket.ts  # 修改 - 添加 sendChatMessage 处理 chat_reply
└── types.ts                     # 修改 - 添加 ChatMessage/ChatReply 类型
```

---

### Task 1: Create cc-mcp-bridge MCP Server

**Files:**
- Create: `cc-mcp-bridge/package.json`
- Create: `cc-mcp-bridge/server.ts`
- Create: `cc-mcp-bridge/.mcp.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "cc-mcp-bridge",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "bun run server.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd cc-mcp-bridge && bun install`
Expected: Dependencies installed successfully

- [ ] **Step 3: Create server.ts - MCP Server setup**

```typescript
#!/usr/bin/env bun
/**
 * CC-MCP-Bridge - Claude Channel MCP Server
 *
 * Bridges Mobile messages to Claude Code via Desktop WebSocket.
 * Each Claude session spawns one MCP Bridge instance.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import WebSocket from 'ws'

const SESSION_ID = process.env.SESSION_ID!
const DESKTOP_WS_URL = 'ws://localhost:17530'

if (!SESSION_ID) {
  process.stderr.write('cc-mcp-bridge: SESSION_ID environment variable required\n')
  process.exit(1)
}

// WebSocket connection to Desktop
let ws: WebSocket | null = null
let connected = false

// MCP Server
const mcp = new Server(
  { name: 'cc-mcp-bridge', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} }
    },
    instructions: [
      'Messages from Mobile arrive via Cloud relay.',
      'Reply with the reply tool to send responses back to Mobile.',
      'Messages appear as <channel source="cc-mcp-bridge" session_id="...">.'
    ].join('\n')
  }
)

// Connect to Desktop WebSocket
function connectWebSocket() {
  ws = new WebSocket(DESKTOP_WS_URL)

  ws.onopen = () => {
    process.stderr.write(`cc-mcp-bridge: WebSocket connected to ${DESKTOP_WS_URL}\n`)
    // Send authentication
    ws!.send(JSON.stringify({
      type: 'auth',
      session_id: SESSION_ID
    }))
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data.toString())

      if (data.type === 'auth_success') {
        connected = true
        process.stderr.write(`cc-mcp-bridge: Authentication successful for session ${SESSION_ID}\n`)
      } else if (data.type === 'auth_failed') {
        process.stderr.write(`cc-mcp-bridge: Authentication failed: ${data.reason}\n`)
        ws!.close()
      } else if (data.type === 'chat_message') {
        // Push message to Claude via channel notification
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: data.text,
            meta: {
              session_id: data.session_id,
              message_id: data.message_id,
              source: 'mobile'
            }
          }
        })
        process.stderr.write(`cc-mcp-bridge: Delivered message to Claude: ${data.text.slice(0, 50)}\n`)
      }
    } catch (err) {
      process.stderr.write(`cc-mcp-bridge: Failed to parse WebSocket message: ${err}\n`)
    }
  }

  ws.onerror = (err) => {
    process.stderr.write(`cc-mcp-bridge: WebSocket error: ${err}\n`)
  }

  ws.onclose = () => {
    connected = false
    process.stderr.write('cc-mcp-bridge: WebSocket disconnected\n')
    // Attempt reconnect after 1 second
    setTimeout(connectWebSocket, 1000)
  }
}

// Reply tool handler
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message back to Mobile. Use this to respond to messages received from Mobile.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The message to send' },
          reply_to: { type: 'string', description: 'Message ID to reply to (optional)' }
        },
        required: ['text']
      }
    }
  ]
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name !== 'reply') {
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true }
  }

  const args = (req.params.arguments ?? {}) as { text?: string; reply_to?: string }

  if (!args.text) {
    return { content: [{ type: 'text', text: 'Missing required argument: text' }], isError: true }
  }

  if (!ws || !connected) {
    return { content: [{ type: 'text', text: 'Not connected to Desktop' }], isError: true }
  }

  // Send reply to Desktop → Cloud → Mobile
  ws.send(JSON.stringify({
    type: 'chat_reply',
    session_id: SESSION_ID,
    text: args.text,
    reply_to: args.reply_to
  }))

  process.stderr.write(`cc-mcp-bridge: Sent reply to Mobile: ${args.text.slice(0, 50)}\n`)
  return { content: [{ type: 'text', text: 'Message sent to Mobile' }] }
})

// Start MCP Server with stdio transport
await mcp.connect(new StdioServerTransport())
process.stderr.write(`cc-mcp-bridge: MCP Server started for session ${SESSION_ID}\n`)

// Connect WebSocket
connectWebSocket()

// Cleanup on stdin EOF (Claude session ended)
process.stdin.on('end', () => {
  process.stderr.write('cc-mcp-bridge: Claude session ended, shutting down\n')
  if (ws) ws.close()
  process.exit(0)
})

process.stdin.on('close', () => {
  if (ws) ws.close()
  process.exit(0)
})

// Handle process signals
process.on('SIGTERM', () => {
  if (ws) ws.close()
  process.exit(0)
})

process.on('SIGINT', () => {
  if (ws) ws.close()
  process.exit(0)
})
```

- [ ] **Step 4: Create .mcp.json configuration**

```json
{
  "mcpServers": {
    "cc-mcp-bridge": {
      "command": "bun",
      "args": ["run", "server.ts"],
      "env": {
        "SESSION_ID": "${session_id}"
      }
    }
  }
}
```

- [ ] **Step 5: Commit cc-mcp-bridge files**

```bash
git add cc-mcp-bridge/
git commit -m "feat: Add cc-mcp-bridge MCP Server

- MCP Server with stdio transport for Claude Channel
- WebSocket client connects to Desktop (localhost:17530)
- Supports chat_message from Mobile → Claude
- reply tool for Claude → Mobile responses"
```

---

### Task 2: Desktop WebSocket Server for MCP Bridge

**Files:**
- Create: `src-tauri/src/ws_server.rs`
- Modify: `src-tauri/src/lib.rs` (add ws_server module, start server, add mcp_bridges field)
- Modify: `src-tauri/src/http_server.rs` (no changes needed - separate port)

- [ ] **Step 1: Create ws_server.rs - WebSocket Server**

```rust
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

use axum::{
    extract::ws::{WebSocket, WebSocketUpgrade, Message},
    response::Response,
    routing::get,
    Router,
};
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;
use tokio::sync::broadcast;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

/// MCP Bridge connection state
pub struct McpBridgeState {
    /// session_id -> WebSocket sender
    bridges: HashMap<String, broadcast::Sender<Message>>,
}

impl McpBridgeState {
    pub fn new() -> Self {
        Self {
            bridges: HashMap::new(),
        }
    }
}

/// Message types for MCP Bridge protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpBridgeMessage {
    #[serde(rename = "auth")]
    Auth { session_id: String },

    #[serde(rename = "auth_success")]
    AuthSuccess,

    #[serde(rename = "auth_failed")]
    AuthFailed { reason: String },

    #[serde(rename = "chat_message")]
    ChatMessage {
        session_id: String,
        text: String,
        message_id: String,
    },

    #[serde(rename = "chat_reply")]
    ChatReply {
        session_id: String,
        text: String,
        reply_to: Option<String>,
    },
}

/// Global MCP Bridge state
pub static MCP_BRIDGE_STATE: once_cell::sync::Lazy<Arc<RwLock<McpBridgeState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(McpBridgeState::new())));

/// WebSocket server for MCP Bridge connections
pub struct WsServer {
    port: u16,
}

impl WsServer {
    pub fn new(port: u16) -> Self {
        Self { port }
    }

    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        let app = Router::new()
            .route("/ws", get(handle_ws_upgrade));

        let addr = format!("127.0.0.1:{}", self.port);
        tracing::info!("MCP Bridge WebSocket Server starting on {}", addr);

        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

/// Handle WebSocket upgrade request
async fn handle_ws_upgrade(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

/// Handle WebSocket connection
async fn handle_socket(socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();

    // Wait for auth message
    let auth_msg = match rx.next().await {
        Some(Ok(Message::Text(text))) => {
            match serde_json::from_str::<McpBridgeMessage>(&text) {
                Ok(McpBridgeMessage::Auth { session_id }) => session_id,
                Ok(other) => {
                    tracing::warn!("Expected auth message, got: {:?}", other);
                    let _ = tx.send(Message::Text(
                        serde_json::to_string(&McpBridgeMessage::AuthFailed {
                            reason: "Expected auth message first".to_string()
                        }).unwrap_or_default()
                    ).await);
                    return;
                }
                Err(e) => {
                    tracing::warn!("Failed to parse auth message: {}", e);
                    return;
                }
            }
        },
        _ => {
            tracing::warn!("No auth message received");
            return;
        }
    };

    // Register MCP Bridge
    let (bridge_tx, _bridge_rx) = broadcast::channel::<Message>(16);
    {
        let mut state = MCP_BRIDGE_STATE.write();
        state.bridges.insert(auth_msg.clone(), bridge_tx.clone());
        tracing::info!("MCP Bridge registered: session {}", auth_msg);
    }

    // Send auth success
    let auth_success = serde_json::to_string(&McpBridgeMessage::AuthSuccess).unwrap_or_default();
    if tx.send(Message::Text(auth_success)).await.is_err() {
        tracing::warn!("Failed to send auth_success");
        return;
    }

    // Handle messages
    let session_id = auth_msg.clone();
    loop {
        tokio::select! {
            // Receive from MCP Bridge
            msg = rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<McpBridgeMessage>(&text) {
                            Ok(McpBridgeMessage::ChatReply { session_id, text, reply_to }) => {
                                // Forward to Cloud Client
                                crate::cloud_client::send_chat_reply_from_bridge(&session_id, &text, reply_to.as_deref());
                            }
                            Ok(other) => {
                                tracing::debug!("Received message from MCP Bridge: {:?}", other);
                            }
                            Err(e) => {
                                tracing::warn!("Failed to parse message from MCP Bridge: {}", e);
                            }
                        }
                    },
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("MCP Bridge disconnected: session {}", session_id);
                        break;
                    },
                    Some(Err(e)) => {
                        tracing::error!("MCP Bridge WebSocket error: {}", e);
                        break;
                    },
                    _ => {}
                }
            }
            // Receive from bridge_tx (chat_message from Mobile)
            msg = bridge_rx.recv() => {
                if let Ok(msg) = msg {
                    if tx.send(msg).await.is_err() {
                        tracing::warn!("Failed to send to MCP Bridge");
                        break;
                    }
                }
            }
        }
    }

    // Cleanup
    {
        let mut state = MCP_BRIDGE_STATE.write();
        state.bridges.remove(&session_id);
        tracing::info!("MCP Bridge unregistered: session {}", session_id);
    }
}

/// Send chat_message to MCP Bridge (called by Cloud Client)
pub fn send_to_mcp_bridge(session_id: &str, text: &str, message_id: &str) {
    let state = MCP_BRIDGE_STATE.read();
    if let Some(bridge_tx) = state.bridges.get(session_id) {
        let msg = McpBridgeMessage::ChatMessage {
            session_id: session_id.to_string(),
            text: text.to_string(),
            message_id: message_id.to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap_or_default();
        if let Err(e) = bridge_tx.send(Message::Text(json)) {
            tracing::warn!("Failed to send chat_message to MCP Bridge {}: {}", session_id, e);
        } else {
            tracing::info!("Sent chat_message to MCP Bridge {}", session_id);
        }
    } else {
        tracing::warn!("No MCP Bridge for session {}", session_id);
    }
}
```

- [ ] **Step 2: Modify lib.rs - Add ws_server module and start server**

Find the module declarations section (around line 1-13) and add:

```rust
pub mod ws_server;
```

Find the AppState struct (around line 64-76) and add a new field after `jsonl_watcher`:

```rust
pub struct AppState {
    pub instances: InstanceManager,
    pub popups: PopupQueue,
    pub chat_history: ChatHistory,
    pub conversation_parser: ConversationParser,
    pub settings: config::AppSettings,
    pub recent_activities: Vec<ToolActivity>,
    pub session_notification: Option<SessionNotification>,
    pub cloud_client: Option<Arc<AsyncRwLock<CloudClient>>>,
    pub cloud_connection_status: CloudConnectionStatus,
    pub cloud_stop_signal: Option<tokio::sync::watch::Sender<bool>>,
    pub jsonl_watcher: Option<JsonlWatcherHandle>,
}
```

Note: MCP Bridge connections are stored in `ws_server::MCP_BRIDGE_STATE` static, not in AppState.

Find the setup block (around line 741-818) and add after HTTP server start (around line 787):

```rust
// Start MCP Bridge WebSocket Server in background
let ws_server = ws_server::WsServer::new(17530);
tokio::spawn(async move {
    if let Err(e) = ws_server.run().await {
        tracing::error!("MCP Bridge WebSocket Server error: {}", e);
    }
});
```

- [ ] **Step 3: Commit Desktop WebSocket Server**

```bash
git add src-tauri/src/ws_server.rs src-tauri/src/lib.rs
git commit -m "feat: Add MCP Bridge WebSocket Server to Desktop

- WebSocket server on port 17530 for MCP Bridge connections
- Auth protocol: session_id based registration
- Message routing: chat_message → MCP Bridge, chat_reply → Cloud"
```

---

### Task 3: Desktop Cloud Client - send_chat_reply method

**Files:**
- Modify: `src-tauri/src/cloud_client.rs` (add send_chat_reply_from_bridge function)

- [ ] **Step 1: Add send_chat_reply_from_bridge function**

Find the end of the file (after `handle_request_session_list` function, around line 524) and add:

```rust
/// Send chat_reply from MCP Bridge to Cloud Server → Mobile
pub fn send_chat_reply_from_bridge(session_id: &str, text: &str, reply_to: Option<&str>) {
    // Get Cloud Client from SHARED_STATE
    let cloud_client_opt = crate::SHARED_STATE.read().cloud_client.clone();

    if let Some(cloud_client) = cloud_client_opt {
        // Use try_read for non-blocking access
        if let Ok(client) = cloud_client.try_read() {
            if client.is_connected() {
                if let Some(tx) = client.get_out_tx() {
                    let msg = serde_json::json!({
                        "type": "chat_reply",
                        "device_token": client.get_device_token(),
                        "session_id": session_id,
                        "text": text,
                        "reply_to": reply_to,
                    });
                    if let Err(e) = tx.try_send(Message::text(msg.to_string())) {
                        tracing::warn!("Failed to send chat_reply: {}", e);
                    } else {
                        tracing::info!("Sent chat_reply to Cloud: session {}", session_id);
                    }
                }
            } else {
                tracing::warn!("Cloud client not connected, cannot send chat_reply");
            }
        }
    } else {
        tracing::warn!("No cloud client configured, cannot send chat_reply");
    }
}
```

- [ ] **Step 2: Handle chat_message from Cloud → Forward to MCP Bridge**

Find the receive task in `connect()` method (around line 240-283). After handling `hook_response` and `request_session_list`, add handling for `chat_message`:

```rust
} else if msg_type == "chat_message" {
    // Forward to MCP Bridge
    let session_id = json["session_id"].as_str().unwrap_or("");
    let text = json["text"].as_str().unwrap_or("");
    let message_id = json["message_id"].as_str().unwrap_or("");
    crate::ws_server::send_to_mcp_bridge(session_id, text, message_id);
}
```

Full context for the change (modify line 252-256):

```rust
let msg_type = json["type"].as_str().unwrap_or("");
if msg_type == "hook_response" {
    handle_hook_response(&app_state, &json);
} else if msg_type == "request_session_list" {
    handle_request_session_list(&app_state, &device_token_recv, &json, &out_tx_for_recv);
} else if msg_type == "chat_message" {
    // Forward to MCP Bridge
    let session_id = json["session_id"].as_str().unwrap_or("");
    let text = json["text"].as_str().unwrap_or("");
    let message_id = json["message_id"].as_str().unwrap_or("");
    crate::ws_server::send_to_mcp_bridge(session_id, text, message_id);
}
```

- [ ] **Step 3: Commit Cloud Client changes**

```bash
git add src-tauri/src/cloud_client.rs
git commit -m "feat: Add chat_reply and chat_message handling in Cloud Client

- send_chat_reply_from_bridge: MCP Bridge → Cloud → Mobile
- Forward chat_message from Cloud to MCP Bridge"
```

---

### Task 4: Cloud Server - Add ChatMessage/ChatReply types

**Files:**
- Modify: `cloud-server/src/messages.rs` (add ChatMessage/ChatReply types)

- [ ] **Step 1: Add ChatMessage and ChatReply types**

Find the end of the CloudMessage enum (after `PopupResolved`, around line 248) and add:

```rust
// ===== Chat Messaging (Mobile → Cloud → Desktop → MCP Bridge) =====

/// Chat message from Mobile to MCP Bridge.
#[serde(rename = "chat_message")]
ChatMessage {
    /// Device token
    device_token: String,
    /// Session ID
    session_id: String,
    /// Message text
    text: String,
    /// Message ID (unique)
    message_id: String,
},

/// Chat reply from MCP Bridge to Mobile.
#[serde(rename = "chat_reply")]
ChatReply {
    /// Device token
    device_token: String,
    /// Session ID
    session_id: String,
    /// Reply text
    text: String,
    /// Original message ID (optional)
    reply_to: Option<String>,
},
```

- [ ] **Step 2: Commit Cloud Server message types**

```bash
git add cloud-server/src/messages.rs
git commit -m "feat: Add ChatMessage and ChatReply types to Cloud Server

- ChatMessage: Mobile → Cloud → Desktop → MCP Bridge
- ChatReply: MCP Bridge → Desktop → Cloud → Mobile"
```

---

### Task 5: Cloud Server - Handle chat_message/chat_reply routing

**Files:**
- Modify: `cloud-server/src/ws/handler.rs` (add routing logic)

- [ ] **Step 1: Add chat_message handling in handle_desktop_message**

Find `handle_desktop_message` function. Add handling for `chat_reply` after existing message types:

```rust
// Handle chat_reply from Desktop (forwarded from MCP Bridge)
"chat_reply" => {
    let device_token = msg["device_token"].as_str().unwrap_or("");
    let session_id = msg["session_id"].as_str().unwrap_or("");
    tracing::info!("Received chat_reply from Desktop: session {}", session_id);

    // Broadcast to all mobile subscribers
    router.broadcast_to_mobiles(device_token, Message::text(text));
}
```

- [ ] **Step 2: Add chat_message handling in handle_mobile_message**

Find `handle_mobile_message` function. Add handling for `chat_message` after existing message types:

```rust
// Handle chat_message from Mobile
"chat_message" => {
    let device_token = msg["device_token"].as_str().unwrap_or("");
    let session_id = msg["session_id"].as_str().unwrap_or("");
    tracing::info!("Received chat_message from Mobile: session {}", session_id);

    // Forward to Desktop
    if router.send_to_desktop(device_token, Message::text(text)) {
        tracing::info!("Forwarded chat_message to Desktop for device {}", device_token);
    } else {
        tracing::warn!("Desktop offline, cannot forward chat_message");
    }
}
```

- [ ] **Step 3: Commit Cloud Server handler changes**

```bash
git add cloud-server/src/ws/handler.rs
git commit -m "feat: Add chat_message and chat_reply routing in Cloud Server

- chat_message: Mobile → Desktop forwarding
- chat_reply: Desktop → Mobile broadcasting"
```

---

### Task 6: Mobile App - Add ChatMessage/ChatReply types

**Files:**
- Modify: `mobile-app/src/types.ts` (add ChatMessage/ChatReply types)

- [ ] **Step 1: Add types to types.ts**

Find the end of the CloudMessage type union (after `popup_resolved`) and add:

```typescript
// Chat messaging
| { type: 'chat_message'; device_token: string; session_id: string; text: string; message_id: string }
| { type: 'chat_reply'; device_token: string; session_id: string; text: string; reply_to?: string }
```

Also add interface for local chat messages:

```typescript
// Local chat message for display
export interface LocalChatMessage {
  id: string
  from: 'user' | 'assistant'
  text: string
  reply_to?: string
  timestamp: number
}
```

- [ ] **Step 2: Commit Mobile types**

```bash
git add mobile-app/src/types.ts
git commit -m "feat: Add ChatMessage and ChatReply types to Mobile"
```

---

### Task 7: Mobile App - Add sendChatMessage function

**Files:**
- Modify: `mobile-app/src/hooks/useAllDevicesWebSocket.ts` (add sendChatMessage, handle chat_reply)

- [ ] **Step 1: Add chatMessages state to WsState**

Find the WsState interface (around line 28-26) and add:

```typescript
interface WsState {
  serverConnected: boolean
  serverConnecting: boolean
  connectionError: string | null
  onlineDevices: DeviceInfo[]
  sessions: Record<string, ClaudeSession[]>
  hookHints: Record<string, HookHint[]>
  chatMessages: Record<string, ChatMessageData[]>
  // New: Local chat messages for MCP Bridge communication
  mcpChatMessages: Record<string, LocalChatMessage[]>  // keyed by session_id
}
```

Update initial state (around line 44-52):

```typescript
const [state, setState] = useState<WsState>({
  serverConnected: false,
  serverConnecting: false,
  connectionError: null,
  onlineDevices: [],
  sessions: {},
  hookHints: {},
  chatMessages: {},
  mcpChatMessages: {},
})
```

- [ ] **Step 2: Handle chat_reply in ws.onmessage**

Find the switch statement in `ws.onmessage` (around line 221-392). Add after `popup_resolved` case:

```typescript
case 'chat_reply': {
  const sessionId = msg.session_id
  const text = msg.text
  const replyTo = msg.reply_to
  console.log('[WebSocket] chat_reply received:', sessionId, text)

  if (sessionId) {
    setState(s => {
      const existing = s.mcpChatMessages[sessionId] || []
      const replyMessage: LocalChatMessage = {
        id: `r-${Date.now()}`,
        from: 'assistant',
        text: text,
        reply_to: replyTo,
        timestamp: Date.now()
      }
      return {
        ...s,
        mcpChatMessages: {
          ...s.mcpChatMessages,
          [sessionId]: [...existing, replyMessage]
        }
      }
    })
  }
  break
}
```

- [ ] **Step 3: Add sendChatMessage function**

Find the return statement (around line 873) and add sendChatMessage to the return object:

```typescript
// Send chat message to MCP Bridge via Cloud
const sendChatMessage = useCallback((deviceToken: string, sessionId: string, text: string) => {
  const ws = wsRef.current
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('Cannot send chat message: not connected')
    return
  }

  const messageId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  console.log('[WebSocket] sendChatMessage:', sessionId, text)

  ws.send(JSON.stringify({
    type: 'chat_message',
    device_token: deviceToken,
    session_id: sessionId,
    text: text,
    message_id: messageId
  }))

  // Add to local messages (user message)
  setState(s => {
    const existing = s.mcpChatMessages[sessionId] || []
    const userMessage: LocalChatMessage = {
      id: messageId,
      from: 'user',
      text: text,
      timestamp: Date.now()
    }
    return {
      ...s,
      mcpChatMessages: {
        ...s.mcpChatMessages,
        [sessionId]: [...existing, userMessage]
      }
    }
  })
}, [])

return { state, sendHookResponse, requestChatHistory, forceSubscribe, sendChatMessage }
```

- [ ] **Step 4: Commit Mobile WebSocket changes**

```bash
git add mobile-app/src/hooks/useAllDevicesWebSocket.ts
git commit -m "feat: Add sendChatMessage and chat_reply handling to Mobile

- sendChatMessage: Mobile → Cloud → Desktop → MCP Bridge
- Handle chat_reply from MCP Bridge
- Track messages in mcpChatMessages state"
```

---

### Task 8: Mobile App - Create ChatInput component

**Files:**
- Create: `mobile-app/src/components/ChatInput.tsx`

- [ ] **Step 1: Create ChatInput.tsx**

```tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import React, { useState } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled = false }) => {
  const [text, setText] = useState('')

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSend(text.trim())
      setText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-center gap-2 p-2 border-t border-gray-200 bg-white">
      <input
        type="text"
        className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:outline-none"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        disabled={disabled}
      />
      <button
        className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:bg-gray-300 disabled:text-gray-500"
        onClick={handleSend}
        disabled={!text.trim() || disabled}
      >
        发送
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit ChatInput component**

```bash
git add mobile-app/src/components/ChatInput.tsx
git commit -m "feat: Add ChatInput component for Mobile chat"
```

---

### Task 9: Mobile App - Update ChatView to use ChatInput

**Files:**
- Modify: `mobile-app/src/components/ChatView.tsx` (integrate ChatInput, show mcpChatMessages)

- [ ] **Step 1: Import ChatInput and LocalChatMessage type**

Find the imports section (around line 1-7) and add:

```typescript
import { ChatInput } from './ChatInput'
import { LocalChatMessage } from '../types'
```

- [ ] **Step 2: Add mcpChatMessages prop to ChatViewProps**

Find ChatViewProps interface (around line 477-483) and add:

```typescript
interface ChatViewProps {
  projectName: string
  onClose: () => void
  messages: ChatMessageData[]
  pendingHint?: { session_id: string; questions?: AskQuestion[] }
  onSubmitAnswers?: (sessionId: string, answers: string[][]) => void
  // New: MCP Bridge chat messages and send function
  mcpChatMessages?: LocalChatMessage[]
  onSendMcpMessage?: (text: string) => void
  mcpEnabled?: boolean  // Whether MCP Bridge is connected
}
```

- [ ] **Step 3: Add ChatInput at the bottom of ChatView**

Find the end of the component (around line 739-741, before the closing `</div>` of the main container) and add:

```tsx
      {/* MCP Bridge Chat Input */}
      {mcpEnabled && onSendMcpMessage && (
        <ChatInput onSend={onSendMcpMessage} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render mcpChatMessages in the messages area**

Find the messages list section (around line 566-738). Add before the existing `sortedMessages.map`:

```tsx
        {/* MCP Bridge chat messages */}
        {mcpChatMessages && mcpChatMessages.length > 0 && (
          <div className="border-b border-white/10 pb-3 mb-3">
            <div className="text-xs text-white/40 px-2 mb-2">MCP Bridge 消息</div>
            {mcpChatMessages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mb-2 ${msg.from === 'user' ? 'flex justify-end' : ''}`}
              >
                {msg.from === 'user' ? (
                  <div className="max-w-[80%] px-3 py-2 rounded-2xl bg-blue-500/20 text-sm text-white/90">
                    {msg.text}
                  </div>
                ) : (
                  <div className="px-3">
                    <div className="text-xs text-white/50 mb-1">Claude</div>
                    <div className="text-sm text-white/90">{msg.text}</div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
```

- [ ] **Step 5: Commit ChatView changes**

```bash
git add mobile-app/src/components/ChatView.tsx
git commit -m "feat: Integrate ChatInput into ChatView for MCP Bridge messaging

- Add mcpChatMessages prop for MCP Bridge chat display
- Add ChatInput at bottom when MCP Bridge is enabled
- Display MCP Bridge messages separately from hook-based chat"
```

---

### Task 10: Test end-to-end messaging flow

**Files:**
- No new files - testing only

- [ ] **Step 1: Start Desktop in cloud mode**

Run: `cd /home/akke/project/cc-island && pnpm tauri:dev`
Expected: Desktop starts with HTTP server on 17527, WebSocket server on 17530

- [ ] **Step 2: Start Cloud Server**

Run: `cd /home/akke/project/cc-island/cloud-server && cargo run`
Expected: Cloud Server starts on ports 17528/17529

- [ ] **Step 3: Start Mobile app**

Run: `cd /home/akke/project/cc-island/mobile-app && pnpm dev`
Expected: Mobile app starts, connects to Cloud Server

- [ ] **Step 4: Test MCP Bridge connection**

In Claude Code session, configure MCP Bridge:
```bash
claude --mcp-config cc-mcp-bridge/.mcp.json
```

Expected: MCP Bridge connects to Desktop WebSocket on 17530

- [ ] **Step 5: Test Mobile → Claude messaging**

From Mobile, send message to session → verify Claude receives via channel
Expected: Message appears in Claude session

- [ ] **Step 6: Test Claude → Mobile reply**

In Claude session, use `reply` tool → verify Mobile receives reply
Expected: Reply appears in Mobile ChatView

- [ ] **Step 7: Commit testing documentation**

```bash
git add docs/superpowers/plans/2026-04-29-cc-mcp-bridge.md
git commit -m "docs: Add cc-mcp-bridge implementation plan"
```

---

## Verification Checklist

| Item | Expected Behavior |
|------|-------------------|
| MCP Bridge starts | Claude spawns MCP Bridge per session |
| MCP Bridge auth | Connects to Desktop on port 17530 |
| Mobile sends message | Cloud → Desktop → MCP Bridge → Claude |
| Claude replies | MCP Bridge → Desktop → Cloud → Mobile |
| Session end | MCP Bridge exits on stdin EOF |

## Critical Files Summary

| Component | New Files | Modified Files |
|-----------|-----------|----------------|
| MCP Bridge | cc-mcp-bridge/* | - |
| Desktop WS | ws_server.rs | lib.rs |
| Desktop Cloud | - | cloud_client.rs |
| Cloud Server | - | messages.rs, ws/handler.rs |
| Mobile Types | - | types.ts |
| Mobile Hook | - | useAllDevicesWebSocket.ts |
| Mobile UI | ChatInput.tsx | ChatView.tsx |