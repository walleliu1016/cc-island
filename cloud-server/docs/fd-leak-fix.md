# FD 泄漏修复方案

## 问题诊断

日志显示大量 ESTABLISHED 连接未关闭，说明：
1. 客户端断开后服务器未检测到
2. WebSocket 连接缺少超时机制
3. 没有 TCP keepalive

## 已实施修复 ✅

### 修复 1: WebSocket 超时检测 ✅ 已实施

**文件: `ws/connection.rs`**

```rust
use tokio::time::{timeout, Duration};

/// WebSocket read timeout (no activity for this duration = disconnect)
const READ_TIMEOUT: Duration = Duration::from_secs(120);
/// Auth timeout (must auth within this duration)
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);

// 认证阶段超时
let auth_result = timeout(AUTH_TIMEOUT, ws_rx.next()).await;

// recv_task 循环中使用超时检测僵尸连接
loop {
    let msg_result = timeout(READ_TIMEOUT, ws_rx.next()).await;
    match msg_result {
        // 正常消息处理...
        Err(_) => {
            // 超时 - 无活动超过 READ_TIMEOUT 秒，断开连接
            tracing::warn!("connection timeout, disconnecting");
            break;
        }
    }
}
```

### 修复 2: TCP Keepalive ✅ 已实施

**文件: `ws/server.rs`**

```rust
use socket2::{SockRef, TcpKeepalive};

// 每个新连接设置 TCP keepalive
let sock_ref = SockRef::from(&stream);
let keepalive = TcpKeepalive::new()
    .with_time(Duration::from_secs(60))     // 60秒空闲后开始探测
    .with_interval(Duration::from_secs(10)) // 每10秒探测一次
    .with_retries(3);                       // 3次失败后关闭连接
sock_ref.set_tcp_keepalive(&keepalive);
```

**原理:** TCP keepalive 是操作系统级别的检测机制，即使应用层没有数据传输，也会定期发送 TCP 探测包。如果客户端网络中断（不是主动关闭），操作系统会在探测失败后自动关闭连接，释放 FD。

### 修复 3: tokio::select! 任务取消 ✅ 已实施

**文件: `ws/connection.rs`**

当 recv_task 因超时或其他原因退出时，tokio::select! 会自动取消 send_task，确保两个任务都正确结束，不会留下僵尸任务。

## 防护机制总览

| 机制 | 作用时机 | 检测目标 |
|------|---------|---------|
| AUTH_TIMEOUT (30s) | 认证阶段 | 未认证连接 |
| READ_TIMEOUT (120s) | 数据传输阶段 | 应用层无响应 |
| TCP keepalive (60s+10s×3) | 系统层 | 网络中断僵尸连接 |

**检测路径:**
- 正常断开 → WebSocket Close 消息 → 立即清理
- 网络中断 → TCP keepalive 失败 → OS 关闭 → recv_task 检测到错误 → 清理
- 客户端无响应 → READ_TIMEOUT → 应用层断开 → 清理
- 恶意连接不认证 → AUTH_TIMEOUT → 强制断开 → 清理