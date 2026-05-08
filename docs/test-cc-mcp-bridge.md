# CC-MCP-Bridge 测试指南

## 测试环境准备

### 前置条件

1. **Desktop应用运行**
   - Cloud模式已启用
   - WebSocket Server (17530) 启动

2. **Cloud Server运行**
   - PostgreSQL已启动
   - WebSocket监听17528端口

3. **Mobile App运行**
   - 已连接到Cloud Server
   - 已订阅Desktop设备

4. **Bun运行时**
   - 用于运行MCP Bridge

---

## 测试步骤

### Step 1: 启动Desktop应用

```bash
# 切换到main分支（最新版本）
git checkout main

# 启动Desktop开发模式
pnpm tauri:dev
```

**验证要点：**
- 查看终端日志，确认输出：`MCP Bridge WebSocket Server starting on 127.0.0.1:17530`
- Desktop Settings中确认Cloud模式已启用
- Desktop连接到Cloud Server成功

---

### Step 2: 启动Cloud Server

```bash
# 启动PostgreSQL
cd cloud-server
docker-compose up -d

# 配置.env文件（如果未配置）
cp .env.example .env
# 编辑DATABASE_URL

# 启动Cloud Server
cargo run
```

**验证要点：**
- Cloud Server监听17528端口
- PostgreSQL连接成功
- 日志显示：`WebSocket server started on port 17528`

---

### Step 3: 启动Mobile App

```bash
# 启动Mobile开发服务器
cd mobile-app
pnpm dev
```

**验证要点：**
- Mobile访问 http://localhost:3001
- Settings页面配置Cloud Server地址（ws://localhost:17528）
- 订阅Desktop设备（输入device_token）

---

### Step 4: 启动MCP Bridge

```bash
# 确保在cc-mcp-bridge目录
cd cc-mcp-bridge

# 运行MCP Bridge
bun run server.ts
```

**验证要点：**
- 查看stderr输出：
  ```
  cc-mcp-bridge: WebSocket connected to ws://localhost:17530/ws
  cc-mcp-bridge: Bridge ID: [UUID]
  cc-mcp-bridge: Waiting for set_session call...
  cc-mcp-bridge: Registered with Desktop
  ```

---

### Step 5: 测试Mobile发送消息

**操作：**
1. 在Mobile App中选择一个Claude session
2. 进入ChatView
3. 在ChatInput输入测试消息：`Hello from Mobile`
4. 点击发送按钮

**验证路径：**

```
Mobile → Cloud Server → Desktop → MCP Bridge → Claude Code
```

**验证日志：**

**Cloud Server日志：**
```
ChatMessage from mobile: device=[token], session=[id], msg_id=[id]
```

**Desktop日志：**
```
Sent chat_message to MCP Bridge [bridge_id] (session [session_id])
```

**MCP Bridge stderr：**
```
cc-mcp-bridge: Delivered message to Claude: Hello from Mobile
```

---

### Step 6: 测试Claude回复消息

**操作：**
Claude收到channel消息后会自动或手动使用reply工具回复。

**Claude看到的channel消息：**
```
<channel source="cc-mcp-bridge" session_id="xxx" message_id="m-xxx">
Hello from Mobile
</channel>
```

**Claude使用reply工具：**
```
Call reply tool:
- text: "Hello from Claude"
- reply_to: "m-xxx" (可选)
```

**验证路径：**

```
Claude Code → MCP Bridge → Desktop → Cloud Server → Mobile
```

**验证日志：**

**MCP Bridge stderr：**
```
cc-mcp-bridge: Sent reply to Mobile: Hello from Claude
```

**Desktop日志：**
```
Sent chat_reply to Cloud: session [session_id]
```

**Cloud Server日志：**
```
ChatReply from desktop: device=[token], session=[id], reply_to=[id]
```

**Mobile App：**
- ChatView中显示Claude的回复消息

---

## 测试结果检查清单

| 测试项 | 预期结果 | 实际结果 |
|--------|----------|----------|
| Desktop启动 | MCP Bridge WS Server (17530) 启动 | ✅/❌ |
| MCP Bridge连接 | 成功连接到Desktop | ✅/❌ |
| Mobile发送消息 | Cloud Server接收 | ✅/❌ |
| Cloud → Desktop | Desktop路由到MCP Bridge | ✅/❌ |
| MCP Bridge → Claude | Claude收到channel消息 | ✅/❌ |
| Claude回复 | MCP Bridge发送chat_reply | ✅/❌ |
| Desktop → Cloud | Cloud Server路由到Mobile | ✅/❌ |
| Mobile接收 | ChatView显示回复 | ✅/❌ |

---

## 常见问题排查

### Q1: MCP Bridge连接失败

**检查：**
```bash
# 检查Desktop是否启动
ps aux | grep cc-island

# 检查17530端口是否监听
netstat -an | grep 17530
# 或
lsof -i :17530
```

**解决：**
- 重启Desktop应用
- 检查Desktop日志是否有错误

---

### Q2: Mobile消息未到达Claude

**检查链路：**
1. Cloud Server日志：是否收到chat_message
2. Desktop日志：是否调用send_to_mcp_bridge
3. MCP Bridge stderr：是否收到消息

**可能原因：**
- Cloud Server未运行
- Desktop未连接到Cloud Server
- MCP Bridge session未绑定（需要调用set_session）

---

### Q3: Claude回复未到达Mobile

**检查链路：**
1. MCP Bridge stderr：是否发送chat_reply
2. Desktop日志：是否调用send_chat_reply_from_bridge
3. Cloud Server日志：是否路由到Mobile
4. Mobile App：是否连接WebSocket

**可能原因：**
- MCP Bridge未正确绑定session
- Desktop Cloud Client未连接
- Mobile未订阅正确设备

---

### Q4: MCP Bridge session未绑定

**现象：**
```
cc-mcp-bridge: Received message but session not bound yet
```

**解决：**
Claude需要先调用set_session工具：
```
Call set_session tool with your current session_id
```

---

## 自动化测试脚本（可选）

```bash
#!/bin/bash
# test-cc-mcp-bridge.sh

echo "=== Testing CC-MCP-Bridge ==="

# 1. 检查Desktop进程
echo "Step 1: Check Desktop running"
pgrep -f "cc-island" && echo "✅ Desktop running" || echo "❌ Desktop not running"

# 2. 检查17530端口
echo "Step 2: Check MCP Bridge WS port"
netstat -an | grep 17530 && echo "✅ Port 17530 listening" || echo "❌ Port 17530 not listening"

# 3. 检查Cloud Server
echo "Step 3: Check Cloud Server"
netstat -an | grep 17528 && echo "✅ Cloud Server running" || echo "❌ Cloud Server not running"

# 4. 测试MCP Bridge连接
echo "Step 4: Test MCP Bridge connection"
cd cc-mcp-bridge
timeout 5 bun run server.ts 2>&1 | grep "WebSocket connected" && echo "✅ MCP Bridge connected" || echo "❌ MCP Bridge failed"

echo "=== Test completed ==="
```