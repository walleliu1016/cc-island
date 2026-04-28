# CC-MCP-Bridge 设计文档

**日期:** 2026-04-28
**状态:** 已确认

## 概述

CC-MCP-Bridge 是一个 Claude Channel MCP Server，实现 Mobile → Claude Code 的消息推送能力。Mobile 用户发送消息 → Cloud Server → Desktop → MCP Bridge → Claude 接收并处理 → Claude 回复通过相同路径返回到 Mobile。

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Claude Code Session 1                                              │
│    ├─ spawn cc-mcp-bridge 1 (stdio)                                 │
│    │     └─ WebSocket → Desktop (localhost:17530)                   │
│  Claude Code Session 2                                              │
│    ├─ spawn cc-mcp-bridge 2 (stdio)                                 │
│    │     └─ WebSocket → Desktop (localhost:17530)                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Desktop (Tauri App)                                                 │
│    ├─ HTTP Server (17527) ← Claude Hooks                            │
│    ├─ WebSocket Client → Cloud Server (17528)                       │
│    ├─ WebSocket Server (17530) ← cc-mcp-bridge                      │
│    │     └─ session_id → MCP Bridge 映射                            │
│    └─ 消息路由:                                                       │
│         - chat_message: Cloud → MCP Bridge                          │
│         - chat_reply: MCP Bridge → Cloud                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Cloud Server                                                        │
│    ├─ WebSocket ← Mobile App                                        │
│    ├─ WebSocket ← Desktop                                           │
│    └─ 消息路由:                                                       │
│         - chat_message: Mobile → Desktop                            │
│         - chat_reply: Desktop → Mobile                              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Mobile App                                                          │
│    └─ WebSocket → Cloud Server                                      │
│         └─ 发送 chat_message (指定 session_id)                       │
│         └─ 接收 chat_reply                                          │
└─────────────────────────────────────────────────────────────────────┘
```

## 关键设计决策

### 1. MCP Bridge 作为 Claude Child Process

每个 Claude session 启动一个独立的 cc-mcp-bridge 进程：
- 使用 stdio transport 与 Claude 通信
- Claude session 结束 → stdin EOF → MCP Bridge 退出
- 一个 MCP Bridge 只服务一个 session

### 2. 本地 WebSocket 连接

cc-mcp-bridge 只连接本机 Desktop：
- 固定 URL: `ws://localhost:17530`
- 无需 device_token 认证（本地连接）
- 仅用 session_id 注册身份

### 3. 消息路由分层

| 方向 | 路径 | 路由依据 |
|------|------|---------|
| Mobile → Claude | Mobile → Cloud → Desktop → MCP Bridge | device_token → session_id |
| Claude → Mobile | MCP Bridge → Desktop → Cloud → Mobile | device_token |

## 组件详细设计

### cc-mcp-bridge

**文件结构:**
```
cc-mcp-bridge/
├── package.json
├── server.ts
└── .mcp.json
```

**核心职责:**
- MCP Server 使用 stdio transport
- WebSocket Client 连接 Desktop (localhost:17530)
- 接收 Mobile 消息 → 推送 `notifications/claude/channel`
- 提供 `reply` 工具让 Claude 回复

**关键实现:**
```typescript
const sessionId = process.env.SESSION_ID!
const ws = new WebSocket('ws://localhost:17530')

const mcp = new Server(
  { name: 'cc-mcp-bridge', version: '0.1.0' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: 'Messages from Mobile arrive via Cloud relay. Reply with the reply tool.'
  }
)

// 认证
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', session_id: sessionId }))
}

// 接收消息 → 推送到 Claude
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  if (data.type === 'chat_message') {
    mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: data.text,
        meta: { session_id: data.session_id, message_id: data.message_id, source: 'mobile' }
      }
    })
  }
}

// reply 工具
mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const args = req.params.arguments as { text: string; reply_to?: string }
    ws.send(JSON.stringify({
      type: 'chat_reply',
      session_id: sessionId,
      text: args.text,
      reply_to: args.reply_to
    }))
    return { content: [{ type: 'text', text: 'sent to mobile' }] }
  }
})

await mcp.connect(new StdioServerTransport())
process.stdin.on('end', () => process.exit(0))
```

**MCP 配置:**
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

### Desktop WebSocket Server

**新增端口:** 17530

**核心职责:**
- 接收 cc-mcp-bridge WebSocket 连接
- 维护 session_id → MCP Bridge 映射
- 路由消息：chat_message → MCP Bridge / chat_reply → Cloud

**关键实现:**
```rust
// src-tauri/src/ws_server.rs (新文件)

pub struct McpBridgeConnections {
    bridges: HashMap<String, WebSocket>,
}

// 处理认证
if msg.type == "auth" {
    let session_id = msg.session_id;
    state.mcp_bridges.insert(session_id, ws);
    ws.send(json!({ type: "auth_success" }));
}

// 路由来自 Cloud 的消息
pub fn route_from_cloud(&self, msg: &ChatMessage) {
    if let Some(bridge) = self.bridges.get(&msg.session_id) {
        bridge.send(json!({
            type: "chat_message",
            session_id: msg.session_id,
            text: msg.text,
            message_id: msg.message_id
        }));
    }
}

// 路由来自 MCP Bridge 的回复
pub fn route_from_bridge(&self, msg: &ChatReply, cloud_client: &CloudClient) {
    cloud_client.send_chat_reply(msg);
}
```

**端口规划:**
| 服务 | 端口 | 用途 |
|------|------|------|
| HTTP Server | 17527 | Claude Hooks |
| Cloud Client | 17528 | Desktop ↔ Cloud |
| MCP Bridge Server | 17530 | MCP Bridge 连接 |

### Cloud Server 消息扩展

**新增消息类型:**
```rust
// cloud-server/src/messages.rs

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Message {
    ChatMessage {
        device_token: String,
        session_id: String,
        text: String,
        message_id: String,
    },
    ChatReply {
        device_token: String,
        session_id: String,
        text: String,
        reply_to: Option<String>,
    },
}
```

**路由处理:**
```rust
// cloud-server/src/ws/handler.rs

match msg.type.as_str() {
    "chat_message" => {
        router.send_to_desktop(&msg.device_token, msg);
    }
    "chat_reply" => {
        router.broadcast_to_mobiles(&msg.device_token, msg);
    }
}
```

### Mobile App 聊天功能

**新增组件:**
- ChatInput.tsx - 消息输入框
- ChatView.tsx - 聊天界面（扩展现有）
- useCloudWebSocket.ts - 发送/接收逻辑

**发送消息:**
```typescript
const sendChatMessage = (sessionId: string, text: string) => {
  const messageId = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  
  ws.send(JSON.stringify({
    type: 'chat_message',
    device_token: deviceToken,
    session_id: sessionId,
    text: text,
    message_id: messageId
  }))
}
```

**接收回复:**
```typescript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  if (data.type === 'chat_reply') {
    addLocalMessage(data.session_id, {
      from: 'assistant',
      text: data.text,
      reply_to: data.reply_to
    })
  }
}
```

## 消息流完整路径

### Mobile → Claude

```
1. Mobile 用户输入文本
2. Mobile WebSocket.send({ type: 'chat_message', device_token, session_id, text, message_id })
3. Cloud Server 收到 → 查找 device_token 的 Desktop 连接 → 转发
4. Desktop Cloud Client 收到 → 查找 session_id 的 MCP Bridge → 转发
5. cc-mcp-bridge WebSocket.onmessage → mcp.notification({ method: 'notifications/claude/channel', ... })
6. Claude 收到 <channel source="cc-mcp-bridge" session_id="..." message_id="...">text</channel>
```

### Claude → Mobile

```
1. Claude 调用 reply 工具 { text: "回复内容" }
2. cc-mcp-bridge CallToolRequestHandler → WebSocket.send({ type: 'chat_reply', session_id, text })
3. Desktop ws_server 收到 → route_from_bridge → Cloud Client.send_chat_reply
4. Desktop Cloud Client WebSocket.send({ type: 'chat_reply', device_token, session_id, text })
5. Cloud Server 收到 → 查找 device_token 的 Mobile 连接 → 转发
6. Mobile WebSocket.onmessage → addLocalMessage → 显示回复
```

## 实现优先级

1. **cc-mcp-bridge** - 核心 MCP Server
2. **Desktop ws_server** - MCP Bridge 连接管理
3. **Cloud Server 消息扩展** - chat_message/chat_reply 路由
4. **Mobile ChatInput** - 用户输入发送

## 文件清单

| 组件 | 新增文件 | 修改文件 |
|------|---------|---------|
| cc-mcp-bridge | cc-mcp-bridge/* | - |
| Desktop | src-tauri/src/ws_server.rs | src-tauri/src/lib.rs, src-tauri/src/cloud_client.rs |
| Cloud Server | - | cloud-server/src/messages.rs, cloud-server/src/ws/handler.rs |
| Mobile | mobile-app/src/components/ChatInput.tsx | mobile-app/src/hooks/useCloudWebSocket.ts, mobile-app/src/components/ChatView.tsx |