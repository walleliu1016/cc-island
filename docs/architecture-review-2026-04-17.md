# CC-Island 架构 Review 报告

> 日期：2026-04-17
> 状态：P0/P20 已修复

---

## 一、项目概述

CC-Island 是基于 Claude Code Hooks 的多 Claude 管理系统，支持 Desktop 和 Mobile 远程协作。

**核心架构：**
```
Claude Code (Hook) → cc-island Desktop → cloud-server → mobile-app
        │                   HTTP              WebSocket          WebSocket
        │                 (localhost)        (Relay+DB)          (H5/App)
```

**核心组件：**
| 组件 | 技术栈 | 端口 |
|------|--------|------|
| cc-island Desktop | Tauri 2.x + Rust + React | HTTP: 17527 |
| cloud-server | Rust + Axum + PostgreSQL | WebSocket: 18080 |
| mobile-app | React + Capacitor + TypeScript | H5: 5173 |

---

## 二、数据流向分析

### 2.1 Hook 消息流

```
┌────────────┐   HTTP POST    ┌────────────┐   WebSocket    ┌────────────┐
│ Claude Code│ ──────────────▶│ cc-island  │ ─────────────▶│cloud-server│
│  (Hook)    │   /hook        │  Desktop   │   hook_message│   (Relay)  │
└────────────┘                └────────────┘                └──────┬─────┘
                                                                   │
                                                           WebSocket│
                                                                   │
                                                           ┌──────▼─────┐
                                                           │ mobile-app │
                                                           │   (H5)     │
                                                           └───────────┘
```

**消息类型：**
| HookType | 阻塞 | 说明 |
|----------|------|------|
| SessionStart | 否 | 会话启动 |
| SessionEnd | 否 | 会话结束 |
| PreToolUse | 否 | 工具执行前 |
| PostToolUse | 否 | 工具执行后 |
| Stop | 否 | 响应完成 |
| UserPromptSubmit | 否 | 用户输入 |
| PermissionRequest | 是 | 权限审批 (300s timeout) |
| Notification (ask) | 是 | 问答弹窗 (120s timeout) |

### 2.2 审批响应流

```
┌────────────┐                ┌────────────┐                ┌────────────┐
│ mobile-app │   WebSocket    │cloud-server│   WebSocket    │ cc-island  │
│   (审批)   │ ──────────────▶│   (转发)   │ ──────────────▶│  Desktop   │
└────────────┘   hook_response└────────────┘                └──────┬─────┘
                                                                  │
                                                           popup_queue│
                                                           .resolve()│
                                                                  │
                                                           ┌──────▼─────┐
                                                           │ Claude Code│
                                                           │  (继续)    │
                                                           └───────────┘
```

### 2.3 数据存储

| 数据 | 落库 | 存储时机 | 查询时机 |
|------|------|---------|---------|
| Device | ✅ | Desktop 连接/断开 | Mobile Auth |
| Session | ✅ | 每个 hook 事件 | Mobile Auth + request |
| Popup | ❌ | **无写入** | 无查询 |
| ChatMessage | ✅ | Desktop 推送 | Mobile request |

---

## 三、发现的问题

### 问题汇总表

| # | 问题 | 严重程度 | 优先级 | 影响范围 |
|---|------|---------|--------|---------|
| **P1** | 锁竞争导致消息丢失 | 🔴 高 | **P0** | Desktop → Cloud |
| **P2** | hook_type 命名不一致 | 🔴 高 | **P0** | 全链路 |
| **P20** | Popup 表无写入逻辑 | 🔴 高 | **P0** | Mobile 重连 |
| **P7** | 状态合并策略问题 | 🟡 中 | **P1** | Mobile 显示 |
| **P8** | 无状态超时机制 | 🟡 中 | **P1** | Mobile 显示 |
| **P13** | hook_response 无确认 | 🟡 中 | **P1** | 审批流程 |
| **P10** | 无应用层心跳 | 🟡 中 | **P2** | 连接可靠性 |
| **P12** | 无消息缓存 | 🟡 中 | **P2** | Mobile 重连 |
| **P16** | Desktop 忽略非 hook_response | 🟡 中 | **P2** | Desktop 接收 |
| **P19** | 连接后推送 snake_case | 🟡 中 | **P2** | 初始化 |
| **P11** | 广播持有锁过长 | 🟢 低 | **P3** | 性能 |
| **P3** | 消息队列容量有限 | 🟢 低 | **P3** | 内存 |
| **P15** | 认证后缺少完整性通知 | 🟢 低 | **P3** | 初始化 |
| **P17** | Pong 无心跳超时 | 🟢 低 | **P3** | 连接 |
| **P18** | 无消息序列号 | 🟢 低 | **P3** | 可靠性 |

---

## 四、问题详细分析

### P1: 锁竞争导致消息丢失

**问题代码：**
```rust
// src-tauri/src/http_server.rs:1228-1248
fn push_hook_to_cloud(state: &Arc<RwLock<AppState>>, ...) {
    let state_guard = state.read();
    if let Some(ref cloud_client) = state_guard.cloud_client {
        if let Ok(client) = cloud_client.try_read() {  // ← try_read 非阻塞
            if client.is_connected() {
                client.push_hook_message(...);
            }
        }
        // ← try_read 失败时无日志，消息静默丢弃
    }
}
```

**问题分析：**
- `try_read()` 非阻塞，锁被占用时返回 Err
- 消息被静默丢弃，没有任何日志
- 高频 hook 时锁竞争概率高

**修复方案：**
```rust
fn push_hook_to_cloud(state: &Arc<RwLock<AppState>>, ...) {
    let state_guard = state.read();
    if let Some(ref cloud_client) = state_guard.cloud_client {
        match cloud_client.try_read() {
            Ok(client) if client.is_connected() => {
                client.push_hook_message(...);
            }
            Ok(_) => {
                tracing::warn!("Cloud client not connected, hook dropped: {}", hook_type);
            }
            Err(_) => {
                tracing::warn!("Failed to acquire cloud_client lock, hook dropped: {}", hook_type);
            }
        }
    }
}
```

---

### P2: hook_type 命名不一致

**当前状态：**
```
Claude Code:  "PreToolUse" (PascalCase)
    ↓
cc-island:    hook_type_to_snake_case() → "pre_tool_use"
    ↓ WebSocket
cloud-server: HookType enum (serde snake_case) → 匹配成功
    ↓ WebSocket
mobile-app:   case 'pre_tool_use': ← snake_case switch
```

**需要统一的文件：**

| 文件 | 当前行为 | 目标行为 |
|------|----------|----------|
| `src-tauri/src/http_server.rs:1237` | 转换为 snake_case | **删除转换** |
| `src-tauri/src/cloud_client.rs:137` | `"session_start"` | `"SessionStart"` |
| `cloud-server/src/messages.rs:54` | `serde(rename_all="snake_case")` | 删除或改 PascalCase |
| `mobile-app/src/types.ts:16-25` | HookType snake_case | PascalCase |
| `mobile-app/src/hooks/*.ts` | `case 'pre_tool_use':` | `case 'PreToolUse':` |
| `mobile-app/src/components/*.tsx` | `'permission_request'` | `'PermissionRequest'` |

---

### P20: Popup 表无写入逻辑

**数据库表存在：**
```sql
-- migrations/001_init.sql
CREATE TABLE popups (
    id TEXT PRIMARY KEY,
    device_token TEXT NOT NULL,
    session_id TEXT,
    popup_type TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT DEFAULT 'pending',
    ...
);
```

**但代码无写入：**
- 没有 `upsert_popup()` 函数
- `PermissionRequest` 只更新 session，不写入 popup
- Mobile 重连后无法获取待处理的 popup

**修复方案：**
1. 在 repository.rs 添加 `upsert_popup()` 函数
2. 在 handler.rs 的 PermissionRequest 处理中调用写入
3. 添加 `get_pending_popups()` 查询函数

---

### P7: 状态合并策略问题

**问题代码：**
```typescript
// mobile-app/src/hooks/useAllDevicesWebSocket.ts:145-152
const mergedSessions = serverSessions.map(serverSession => {
    const existing = existingSessions.find(e => e.sessionId === serverSession.sessionId)
    if (existing && existing.status !== 'idle') {
        return existing  // ← 可能保留过期状态
    }
    return serverSession
})
```

**问题：**
- 无时间戳比较，无法判断新鲜度
- hook_message 丢失后状态永远过期

**修复方案：**
```typescript
// 添加 updatedAt 字段，按时间戳比较
const mergedSessions = serverSessions.map(serverSession => {
    const existing = existingSessions.find(e => e.sessionId === serverSession.sessionId)
    if (existing) {
        const existingTime = existing.updatedAt || 0
        const serverTime = serverSession.updatedAt || 0
        return existingTime > serverTime ? existing : serverSession
    }
    return serverSession
})
```

---

### P8: 无状态超时机制

**问题：**
- `working` 状态无超时
- hook_message 丢失后永远显示 working

**修复方案：**
| 状态 | 超时时间 | 超时动作 |
|------|---------|---------|
| `thinking` | 60s | → idle + warning |
| `working` | 120s | → idle + warning |
| `waitingForApproval` | 300s | 保持 |

---

### P10: 无应用层心跳

**当前状态：**
- 只依赖 WebSocket Ping/Pong (协议层)
- 无应用层心跳检测
- 断线可能长时间不发现

**修复方案：**
- Desktop → Cloud: 每 30s 发送应用层 Ping
- Cloud → Desktop: 60s 未收到 Ping 则标记 offline
- Mobile → Cloud: 同样心跳机制

---

## 五、协议规范分析

### 5.1 App ↔ Cloud-Server 协议

| 消息 | 方向 | 类型名 | 说明 |
|------|------|--------|------|
| 认证 | App → Cloud | `mobile_auth` | 设备订阅列表 |
| 认证成功 | Cloud → App | `auth_success` | 连接确认 |
| 设备列表 | Cloud → App | `device_list` | 在线设备 |
| 会话列表 | Cloud → App | `session_list` | 活跃会话 |
| Hook消息 | Cloud → App | `hook_message` | 实时状态 |
| 聊天历史 | Cloud → App | `chat_history` | 消息记录 |
| 审批响应 | App → Cloud | `hook_response` | 用户决策 |
| 请求历史 | App → Cloud | `request_chat_history` | 查询请求 |

### 5.2 Desktop ↔ Cloud-Server 协议

| 消息 | 方向 | 类型名 | 说明 |
|------|------|--------|------|
| 注册 | Desktop → Cloud | `device_register` | 设备标识 |
| 认证成功 | Cloud → Desktop | `auth_success` | 连接确认 |
| Hook推送 | Desktop → Cloud | `hook_message` | 状态同步 |
| 聊天推送 | Desktop → Cloud | `chat_history` | 消息同步 |
| 审批响应 | Cloud → Desktop | `hook_response` | Mobile决策 |

---

## 六、修复计划

### Phase 1: P0 问题修复

1. **P1 锁竞争** - 添加失败日志，考虑消息队列
2. **P2 hook_type** - 统一为 PascalCase
3. **P20 Popup写入** - 实现 popup 持久化

### Phase 2: P1 问题修复

4. **P7 状态合并** - 添加时间戳比较
5. **P8 状态超时** - 实现超时检测
6. **P13 审批确认** - 添加响应确认机制

### Phase 3: P2 问题修复

7. **P10 心跳检测** - 应用层心跳
8. **P12 消息缓存** - 短期消息队列
9. **P16 Desktop接收** - 处理更多消息类型
10. **P19 初始化格式** - 统一命名

### Phase 4: P3 问题优化

11. 性能优化、可靠性增强

---

## 七、相关文件索引

| 组件 | 关键文件 | 说明 |
|------|---------|------|
| Desktop HTTP | `src-tauri/src/http_server.rs` | Hook 处理、推送逻辑 |
| Desktop Cloud | `src-tauri/src/cloud_client.rs` | WebSocket 客户端 |
| Desktop State | `src-tauri/src/lib.rs` | 全局状态管理 |
| Desktop Popup | `src-tauri/src/popup_queue.rs` | 弹窗队列 |
| Cloud Router | `cloud-server/src/ws/router.rs` | 连接路由 |
| Cloud Handler | `cloud-server/src/ws/handler.rs` | 消息处理 |
| Cloud DB | `cloud-server/src/db/repository.rs` | 数据库操作 |
| Cloud Messages | `cloud-server/src/messages.rs` | 消息类型定义 |
| Mobile WebSocket | `mobile-app/src/hooks/useAllDevicesWebSocket.ts` | WebSocket hook |
| Mobile Types | `mobile-app/src/types.ts` | 类型定义 |
| Mobile Components | `mobile-app/src/components/*.tsx` | UI 组件 |

---

## 八、总结

本次 Review 发现 **16 个问题**，其中：
- 🔴 P0 级别：3 个（锁竞争、命名不一致、Popup 缺失）
- 🟡 P1-P2 级别：9 个（状态管理、可靠性问题）
- 🟢 P3 纺别：4 个（性能、可靠性优化）

**核心问题：** 数据同步链路多处存在断点，导致 Mobile 显示混乱、状态不实时。

**修复优先级：** 先修复 P0 确保数据不丢失，再修复显示逻辑问题，最后优化可靠性。