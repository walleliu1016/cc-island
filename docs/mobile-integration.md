# CC-Island 移动端接入文档

> 版本: 0.2.2 | 更新日期: 2026-04-21

## 概述

CC-Island 移动端通过 WebSocket 连接云服务器，实时监控和远程响应 Desktop 端 Claude Code 实例的权限请求。

### 系统架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Desktop App   │────▶│   Cloud Server  │◀────│   Mobile App    │
│  (Tauri/Rust)   │     │   (Rust/Axum)   │     │   (React/H5)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
      HTTP Hooks              WebSocket               WebSocket
      (port 17527)           (port 17528)            (port 17528)
```

### 数据流向

1. **Desktop → Cloud**: HTTP POST `/hook` 接收 Claude Code hooks
2. **Cloud → Mobile**: WebSocket 推送实时状态更新
3. **Mobile → Cloud**: WebSocket 发送权限响应
4. **Cloud → Desktop**: WebSocket 转发权限响应

---

## 接入流程

### 1. 云服务器部署

```bash
# 下载发布包
tar -xzf cc-island-cloud-*.tar.gz

# 启动 PostgreSQL
docker-compose up -d

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件:
# DATABASE_URL=postgres://ccisland:password@localhost:5432/ccisland
# WS_PORT=17528
# CLEANUP_INTERVAL_SECS=3600
# MAX_DEVICE_AGE_SECS=86400

# 启动服务器
./cc-island-cloud
```

### 2. Desktop 配置

在 Desktop 应用设置中：

1. 打开 **设置** → **远程访问**
2. 启用 **云服务连接**
3. 输入云服务器地址: `ws://your-server:17528`
4. 保存后 Desktop 自动注册并获取 `device_token`

### 3. Mobile 配置

#### H5 Web 版本

访问部署的 H5 页面，输入：
- 云服务器地址: `ws://your-server:17528`
- 设备 Token（从 Desktop 获取或扫描二维码）

#### Android/iOS App

1. 安装 APK 或通过 TestFlight 安装
2. 打开设置页面
3. 输入云服务器地址并保存
4. 添加设备 Token（支持扫码）

---

## WebSocket 协议

### 连接地址

```
ws://server-address:17528
wss://server-address:17528  (生产环境推荐)
```

### 消息格式

所有消息使用 JSON 格式，包含 `type` 字段标识消息类型：

```json
{
  "type": "message_type",
  ...其他字段
}
```

---

## 消息类型详解

### 连接管理

#### 1. 设备注册 (Desktop → Cloud)

Desktop 连接时发送，注册设备身份。

```json
{
  "type": "device_register",
  "device_token": "uuid-string",
  "hostname": "my-macbook",
  "device_name": "办公电脑"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_token | string | ✓ | 设备唯一标识 (UUID) |
| hostname | string | - | 系统主机名 |
| device_name | string | - | 用户自定义名称 |

#### 2. 移动端认证 (Mobile → Cloud)

Mobile 连接时发送，订阅指定设备。

```json
{
  "type": "mobile_auth",
  "device_tokens": ["token-1", "token-2"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_tokens | string[] | ✓ | 要订阅的设备 Token 列表 |

#### 3. 认证成功响应 (Cloud → Client)

```json
{
  "type": "auth_success",
  "device_id": "client-uuid",
  "hostname": "server-hostname"
}
```

#### 4. 认证失败响应 (Cloud → Client)

```json
{
  "type": "auth_failed",
  "reason": "Invalid device token"
}
```

#### 5. 心跳保活

```json
// Ping (任意 → Cloud)
{ "type": "ping" }

// Pong (Cloud → 任意)
{ "type": "pong" }
```

---

### 设备状态

#### 6. 设备列表 (Cloud → Mobile)

认证成功后，返回在线设备列表。

```json
{
  "type": "device_list",
  "devices": [
    {
      "token": "device-token-1",
      "hostname": "my-macbook",
      "registered_at": "2026-04-21T10:00:00Z",
      "online": true
    }
  ]
}
```

#### 7. 设备上线通知 (Cloud → Mobile)

```json
{
  "type": "device_online",
  "device": {
    "token": "new-device-token",
    "hostname": "new-device",
    "registered_at": "2026-04-21T11:00:00Z",
    "online": true
  }
}
```

#### 8. 设备离线通知 (Cloud → Mobile)

```json
{
  "type": "device_offline",
  "device_token": "offline-device-token"
}
```

---

### 会话状态

#### 9. 会话列表 (Cloud → Mobile)

订阅设备后，返回该设备的活跃会话。

```json
{
  "type": "session_list",
  "device_token": "device-token-1",
  "sessions": [
    {
      "sessionId": "session-uuid",
      "projectName": "cc-island",
      "status": "working",
      "currentTool": "Bash",
      "createdAt": 1713696000000
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| sessionId | string | Claude 会话 ID |
| projectName | string | 项目名称 |
| status | string | 会话状态 |
| currentTool | string | 当前执行的工具名 |
| createdAt | number | 创建时间戳 (毫秒) |

**会话状态值:**

| 状态 | 说明 |
|------|------|
| idle | 空闲，等待用户输入 |
| thinking | Claude 正在思考 |
| working | 正在执行工具 |
| waiting | 工具执行完成，等待下一操作 |
| waitingForApproval | 等待权限审批 |
| error | 执行出错 |
| ended | 会话已结束 |
| compacting | 正在压缩上下文 |

---

### Hook 消息

#### 10. Hook 转发 (Cloud → Mobile)

实时转发 Desktop 的 Hook 事件。

```json
{
  "type": "hook_message",
  "device_token": "device-token-1",
  "session_id": "session-uuid",
  "hook_type": "PreToolUse",
  "hook_body": {
    "hook_event_name": "PreToolUse",
    "session_id": "session-uuid",
    "tool_name": "Bash",
    "tool_input": {
      "command": "npm test"
    }
  }
}
```

**Hook 类型:**

| HookType | 说明 | 阻塞类型 |
|----------|------|----------|
| SessionStart | 会话开始 | 非阻塞 |
| SessionEnd | 会话结束 | 非阻塞 |
| PreToolUse | 工具执行前 | 非阻塞 |
| PostToolUse | 工具执行后 | 非阻塞 |
| PostToolUseFailure | 工具执行失败 | 非阻塞 |
| PermissionRequest | 权限请求 | **阻塞** |
| Elicitation | AskUserQuestion | **阻塞** |
| Notification | 通知消息 | 可能阻塞 |
| Stop | Claude 停止 | 非阻塞 |
| UserPromptSubmit | 用户提交消息 | 非阻塞 |
| PreCompact | 上下文压缩前 | 非阻塞 |
| PostCompact | 上下文压缩后 | 非阻塞 |
| SubagentStart | 子代理启动 | 非阻塞 |
| SubagentStop | 子代理停止 | 非阻塞 |
| StatusUpdate | 状态更新 | 非阻塞 |

---

### 权限响应

#### 11. Hook 响应 (Mobile → Cloud → Desktop)

Mobile 用户做出决定后发送响应。

**PermissionRequest 响应:**

```json
{
  "type": "hook_response",
  "device_token": "device-token-1",
  "session_id": "session-uuid",
  "decision": "allow"
}
```

| decision | 说明 |
|----------|------|
| allow | 允许执行 |
| deny | 拒绝执行 |

**AskUserQuestion 响应:**

```json
{
  "type": "hook_response",
  "device_token": "device-token-1",
  "session_id": "session-uuid",
  "decision": null,
  "answers": [["React"], ["Option A", "Option B"]]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| answers | string[][] | 每个问题的答案数组（支持多选） |

---

### 聊天历史

#### 12. 请求聊天历史 (Mobile → Cloud)

```json
{
  "type": "request_chat_history",
  "device_token": "device-token-1",
  "session_id": "session-uuid",
  "limit": 50
}
```

#### 13. 聊天历史响应 (Cloud → Mobile)

```json
{
  "type": "chat_history",
  "device_token": "device-token-1",
  "session_id": "session-uuid",
  "messages": [
    {
      "id": "msg-uuid",
      "sessionId": "session-uuid",
      "messageType": "user",
      "content": "帮我实现一个功能",
      "timestamp": 1713696100000
    },
    {
      "id": "msg-uuid-2",
      "sessionId": "session-uuid",
      "messageType": "assistant",
      "content": "好的，我来帮你...",
      "timestamp": 1713696200000
    }
  ]
}
```

**消息类型:**

| messageType | 说明 |
|-------------|------|
| user | 用户消息 |
| assistant | Claude 响应 |
| toolCall | 工具调用 |
| toolResult | 工具结果 |
| thinking | 思考过程 |
| interrupted | 被中断 |

---

## 实现示例

### JavaScript/TypeScript 客户端

```typescript
// 连接 WebSocket
const ws = new WebSocket('ws://server:17528');

ws.onopen = () => {
  // 发送认证
  ws.send(JSON.stringify({
    type: 'mobile_auth',
    device_tokens: ['your-device-token']
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.type) {
    case 'auth_success':
      console.log('认证成功');
      break;
      
    case 'hook_message':
      handleHookMessage(msg);
      break;
      
    case 'device_list':
      updateDeviceList(msg.devices);
      break;
  }
};

// 处理 Hook 消息
function handleHookMessage(msg) {
  const { hook_type, hook_body, session_id } = msg;
  
  if (hook_type === 'PermissionRequest') {
    // 显示权限请求 UI
    showPermissionDialog({
      toolName: hook_body.tool_name,
      action: hook_body.permission_data?.action,
      onAllow: () => sendHookResponse(msg.device_token, session_id, 'allow'),
      onDeny: () => sendHookResponse(msg.device_token, session_id, 'deny')
    });
  }
}

// 发送响应
function sendHookResponse(deviceToken, sessionId, decision, answers) {
  ws.send(JSON.stringify({
    type: 'hook_response',
    device_token: deviceToken,
    session_id: sessionId,
    decision: decision,
    answers: answers
  }));
}

// 请求聊天历史
function requestChatHistory(deviceToken, sessionId, limit = 100) {
  ws.send(JSON.stringify({
    type: 'request_chat_history',
    device_token: deviceToken,
    session_id: sessionId,
    limit: limit
  }));
}
```

---

## 安全注意事项

### 1. 生产环境配置

- 使用 `wss://` (TLS 加密)
- 配置防火墙限制端口访问
- 设置合理的 `MAX_DEVICE_AGE_SECS`

### 2. Token 管理

- Device Token 应安全存储
- 不要在公开渠道分享 Token
- 定期清理离线设备

### 3. 权限控制

- 仅响应可信设备的权限请求
- 敏感操作建议在 Desktop 本地确认
- 设置自动允许白名单（可选）

---

## 错误处理

### 连接错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| 连接超时 | 网络不通或服务器未启动 | 检查网络和服务器状态 |
| 认证失败 | Token 无效 | 重新获取 Token |
| 连接断开 | 网络波动或服务器重启 | 自动重连 (5秒后) |

### 常见问题

**Q: Android 上 WebSocket 无法连接?**

确保配置了网络安全策略：
```xml
<application
    android:usesCleartextTraffic="true"
    android:networkSecurityConfig="@xml/network_security_config">
```

**Q: H5 和 App 显示状态不一致?**

Mobile 状态来自实时 WebSocket 推送，刷新页面会重置。
建议使用持久化存储缓存设备信息。

---

## 附录

### 相关文件

| 文件 | 说明 |
|------|------|
| `cloud-server/src/messages.rs` | 协议消息定义 |
| `cloud-server/src/ws/handler.rs` | WebSocket 处理逻辑 |
| `mobile-app/src/hooks/useAllDevicesWebSocket.ts` | Mobile WebSocket Hook |
| `mobile-app/src/types.ts` | TypeScript 类型定义 |

### 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 0.2.2 | 2026-04-21 | Android 网络安全配置修复 |
| 0.2.1 | 2026-04-20 | 添加 H5 构建支持 |
| 0.2.0 | 2026-04-19 | QR 码扫码功能 |

---

## 支持

- GitHub Issues: https://github.com/walleliu1016/cc-island/issues
- 文档更新: `docs/mobile-integration.md`