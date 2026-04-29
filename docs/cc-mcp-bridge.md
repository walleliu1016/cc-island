# CC-MCP-Bridge 使用指南

CC-MCP-Bridge 是一个 Claude Channel MCP Server，实现 Mobile → Claude Code 的双向消息传递。

## 功能

- **Mobile 发消息给 Claude** - 在手机端发送消息，Claude 会收到并通过 `reply` 工具回复
- **双向对话** - 完整的聊天桥接体验，类似 Telegram/Discord Channel
- **本地连接** - MCP Bridge 仅连接本机 Desktop (localhost:17530)，安全可靠

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Claude Code Session                                                 │
│    └─ spawn cc-mcp-bridge (stdio transport)                         │
│         └─ WebSocket → Desktop (localhost:17530)                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Desktop (Tauri App)                                                 │
│    ├─ HTTP Server (17527) ← Claude Hooks                            │
│    ├─ WebSocket Client → Cloud Server                               │
│    ├─ WebSocket Server (17530) ← cc-mcp-bridge                      │
│    └─ 消息路由: chat_message ↔ chat_reply                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Cloud Server                                                        │
│    └─ WebSocket 路由: Mobile ↔ Desktop                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Mobile App                                                          │
│    └─ ChatView + ChatInput                                          │
│         └─ 发送 chat_message, 接收 chat_reply                        │
└─────────────────────────────────────────────────────────────────────┘
```

## 安装配置

### 1. 前置条件

- Desktop 已启用 Cloud Relay 模式
- Cloud Server 正常运行
- Mobile App 已连接到设备
- 安装 Bun 运行时

### 2. 配置 MCP Bridge

在 Claude Code 中使用 MCP Bridge：

```bash
claude --mcp-config cc-mcp-bridge/.mcp.json
```

或者将配置添加到 Claude Code 的全局 MCP 配置 (`~/.claude/.mcp.json`)：

```json
{
  "mcpServers": {
    "cc-mcp-bridge": {
      "command": "bun",
      "args": ["run", "/path/to/cc-island/cc-mcp-bridge/server.ts"],
      "env": {
        "SESSION_ID": "${session_id}"
      }
    }
  }
}
```

### 3. 启动流程

1. **启动 Desktop**: `pnpm tauri:dev` (确保 Cloud 模式已启用)
2. **启动 Cloud Server**: `cd cloud-server && cargo run`
3. **启动 Mobile**: `cd mobile-app && pnpm dev`
4. **启动 Claude Code**: 使用上述 MCP 配置

## 使用方式

### Mobile 发送消息

1. 在 Mobile App 中选择一个 Claude session
2. 点击进入 ChatView
3. 在底部输入框输入消息
4. 点击"发送"按钮

消息路径：
```
Mobile → Cloud Server → Desktop → cc-mcp-bridge → Claude Code
```

### Claude 接收消息

Claude 会收到类似这样的 Channel 消息：

```
<channel source="cc-mcp-bridge" session_id="xxx" message_id="m-xxx">
用户发送的消息内容
</channel>
```

### Claude 回复消息

Claude 使用 `reply` 工具回复：

```
使用 reply 工具回复用户：
- text: 回复内容
- reply_to: (可选) 原消息 ID
```

回复路径：
```
Claude Code → cc-mcp-bridge → Desktop → Cloud Server → Mobile
```

## 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| Desktop HTTP Server | 17527 | Claude Hooks 接收 |
| Desktop MCP Bridge WS | 17530 | MCP Bridge 连接 |
| Cloud Server WebSocket | 17528 | Desktop/Mobile 连接 |
| Cloud Server HTTP | 17529 | 状态查询 API |

## 安全说明

- MCP Bridge 仅连接 `localhost:17530`，不接受外部连接
- 认证基于 `session_id`，确保消息路由正确
- 消息仅在 Claude session 运行时传递，session 结束后 MCP Bridge 自动退出

## 常见问题

### Q: MCP Bridge 连接失败？

检查：
1. Desktop 是否正在运行
2. Desktop WebSocket Server (17530) 是否启动
3. Bun 是否已安装

### Q: Mobile 发送消息后 Claude 没收到？

检查：
1. Cloud Server 是否正常运行
2. Desktop 是否连接到 Cloud Server
3. MCP Bridge 是否成功认证 (查看 stderr 输出)

### Q: Claude 的回复 Mobile 没收到？

检查：
1. Mobile 是否连接到 Cloud Server
2. Mobile 是否订阅了正确的 device_token