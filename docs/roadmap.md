# CC-Island Roadmap

> 更新日期: 2026-04-21

## 当前版本: 0.2.2

---

## TODO

### WebSocket 心跳机制

**优先级: 高**

**问题:** Android WebView 黑屏后可能出现僵尸连接，WebSocket readyState 显示 OPEN 但实际已断开，服务器端 subscriber 已被清理。

**现状:**
- 服务器：响应 WebSocket 协议层 Ping，支持应用层 `CloudMessage::Ping`
- 客户端：无心跳发送机制

**方案:**
1. 客户端定时发送 Ping（建议 30 秒间隔）
2. 超时检测：Pong 未在 X 秒内返回，主动断开重连
3. 双层保障：WebSocket 协议层 + 应用层心跳

**涉及文件:**
- `mobile-app/src/hooks/useAllDevicesWebSocket.ts` - 添加定时 Ping 和超时检测
- `mobile-app/src/types.ts` - 添加 Ping/Pong 消息类型（如需）

---

### 其他待办

- [ ] iOS 构建和发布
- [ ] Desktop QR Code 生成（方便移动端扫码添加设备）
- [ ] 离线消息缓存（移动端断线期间的消息补发）

---

## 已完成

### 0.2.2 (2026-04-21)

- [x] Android WebView 僵尸连接修复 - visibilitychange 强制重连
- [x] 服务器 MobileAuth 立即设置订阅 - 避免空订阅问题
- [x] 移动端 ChatView 支持
- [x] 移动端 AskUserQuestion 多问题导航

### 0.2.1 (2026-04-16)

- [x] Phase 1 MVP: Cloud Relay 基础功能
- [x] Desktop 状态同步到 Cloud
- [x] Mobile 远程权限响应