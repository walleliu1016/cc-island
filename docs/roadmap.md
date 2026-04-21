# CC-Island Roadmap

> 更新日期: 2026-04-21

## 当前版本: 0.2.2

---

## TODO

### 其他待办

- [ ] iOS 构建和发布
- [ ] Desktop QR Code 生成（方便移动端扫码添加设备）
- [ ] 离线消息缓存（移动端断线期间的消息补发）

---

## 已完成

### heartbeat 分支 (2026-04-21)

- [x] WebSocket 心跳机制：每 30 秒发送 Ping，60 秒 Pong 超时重连

### feature/fix-android (2026-04-21)

- [x] Android WebView 僵尸连接修复 - visibilitychange 强制重连
- [x] 服务器 MobileAuth 立即设置订阅 - 避免空订阅问题
- [x] H5 hook 状态无条件更新 - 和 Desktop 一致
- [x] 移动端 ChatView 支持
- [x] 移动端 AskUserQuestion 多问题导航

### 0.2.2 (2026-04-21)

- [x] Phase 1 MVP: Cloud Relay 基础功能
- [x] Desktop 状态同步到 Cloud
- [x] Mobile 远程权限响应