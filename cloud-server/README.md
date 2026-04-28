# CC-Island Cloud Server

WebSocket 云服务器，支持多实例部署，实现高可用和负载分担。

## 功能特性

- **多实例高可用** - PostgreSQL LISTEN/NOTIFY 跨实例消息路由
- **连接状态管理** - Desktop/Mobile WebSocket 连接路由
- **僵尸连接检测** - 三层超时防护 (认证/数据/TCP Keepalive)
- **原子消息投递** - DELETE RETURNING 确保多实例竞争安全

---

## 部署要求

- PostgreSQL >= 14
- Rust >= 1.70

---

## 配置

### 环境变量

```bash
# PostgreSQL 连接
DATABASE_URL=postgres://user:pass@host:5432/cc_island

# WebSocket 端口
WS_PORT=17528

# 日志级别
RUST_LOG=info
```

### 启动命令

```bash
# 编译
cargo build --release

# 启动
cargo run --release
```

---

## WebSocket 心跳机制

服务器使用三层防护确保僵尸连接被及时清理：

### 1. 认证超时 (AUTH_TIMEOUT: 30 秒)

客户端连接后必须在 **30 秒内发送认证消息**：

```json
// Desktop 认证
{"type": "device_register", "device_token": "...", "hostname": "..."}

// Mobile 认证
{"type": "mobile_auth", "device_tokens": ["token1", "token2"]}
```

超时未认证的连接会被强制断开。

### 2. 数据超时 (READ_TIMEOUT: 120 秒)

认证后的连接，如果 **120 秒内未收到任何 WebSocket 消息**，将被断开。

**任何消息类型都会重置计时器**：
- `Text` - 业务消息（HookMessage 等）
- `Ping` - 客户端主动心跳
- `Pong` - 响应服务器 Ping
- `Close` - 断开请求

### 3. TCP Keepalive (60 秒 + 10 秒 × 3)

系统级检测，应对网络物理中断：

- 空闲 **60 秒后** 开始发送 TCP 探测包
- 每 **10 秒** 发送一次探测
- **3 次** 探测失败后，操作系统关闭连接

**覆盖场景**：客户端网络断开、主机宕机、中间路由器故障等应用层无法检测的情况。

---

## 客户端接入要求

### 心跳发送频率

建议客户端 **每 30 秒发送一次 Ping**：

```javascript
// WebSocket 心跳示例
const HEARTBEAT_INTERVAL = 30000; // 30 秒

function startHeartbeat(ws) {
  const timer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
      // 或者使用 WebSocket Ping 帧（需要库支持）
    }
  }, HEARTBEAT_INTERVAL);
  
  return timer;
}
```

### 连接保活最佳实践

1. **认证优先**：连接成功后立即发送认证消息，不要等待
2. **定时心跳**：认证成功后启动 30 秒 Ping 定时器
3. **重连机制**：断开后延迟 5-10 秒重连，避免频繁重连风暴
4. **状态监听**：监听 WebSocket `onclose` 事件，及时清理心跳定时器

### 消息格式

```json
// Ping 心跳（推荐）
{"type": "ping"}

// 服务器响应
{"type": "pong"}
```

或使用 WebSocket 协议层的 Ping/Pong 帧（更高效）。

---

## 超时触发场景总览

| 场景 | 检测机制 | 超时时间 | 结果 |
|------|---------|---------|------|
| 客户端进程崩溃 | READ_TIMEOUT | 120 秒 | 断开并清理 |
| 网络物理中断 | TCP Keepalive | 60 + 30 秒 | OS 关闭 → 清理 |
| 客户端卡死 | READ_TIMEOUT | 120 秒 | 断开并清理 |
| 未认证连接 | AUTH_TIMEOUT | 30 秒 | 强制断开 |
| 正常关闭 | WebSocket Close | 立即 | 清理 |

---

## 监控建议

### 查看活跃连接数

```sql
-- 查询设备在线状态
SELECT device_token, hostname, is_online, last_seen_at 
FROM devices 
WHERE is_online = true;
```

### 日志监控

关键日志输出：

```
# 认证超时
Auth timeout (30s), closing connection

# 数据超时
connection timeout (120s), disconnecting device=xxx

# TCP Keepalive（系统日志）
Connection timed out (keepalive)
```

---

## 文件描述符泄漏防护

服务器已实施完整防护，防止 "too many open files" 错误：

- **认证超时**：拒绝不认证的恶意连接
- **数据超时**：清理无响应的僵尸连接
- **TCP Keepalive**：检测网络中断的僵尸连接
- **tokio::select!**：确保任务正确取消和清理

详见 `docs/fd-leak-fix.md`。

---

## 更多文档

- **Mobile 接入指南**: `docs/mobile-integration.md` - WebSocket 协议、消息类型、实现示例
- **多实例架构**: `docs/multi-instance-architecture.md` - 跨实例消息路由设计
- **FD 泄漏修复**: `docs/fd-leak-fix.md` - 僵尸连接检测方案

---

## 许可证

MIT License