# CC-Island

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="CC-Island Logo" width="128" height="128">
</p>

<p align="center">
  <strong>iOS 灵动岛风格的 Claude Code 实例管理器</strong>
</p>

<p align="center">
  跨平台桌面应用 + 手机远程监控，实时监控和管理多个 Claude Code 终端实例
</p>

<p align="center">
  <a href="#安装">安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#功能特性">功能特性</a> •
  <a href="#架构概览">架构概览</a> •
  <a href="#编译">编译</a>
</p>

---

## 功能特性

### 核心功能

- **实时状态监控** - 显示所有 Claude 实例的运行状态
- **权限请求响应** - 远程允许/拒绝 Claude 的工具执行权限
- **Ask 问题回答** - 回答 Claude 的 AskUserQuestion 提问
- **实例跳转** - 一键激活对应的终端窗口（Jump 功能）
- **状态通知** - 实例状态变化时显示通知
- **Session 启停提示** - SessionStart/SessionEnd 时显示项目启动/停止提示
- **Cloud Relay** - 通过云服务器远程监控和响应权限请求
- **Mobile Remote** - 手机端实时查看状态、远程审批权限
- **多设备订阅** - Mobile 单连接订阅多个 Desktop 设备

### 界面特点

- **灵动岛设计** - 类似 iOS 灵动岛的弧形胶囊 UI
- **点击展开** - 点击灵动岛展开实例列表
- **自动展开** - 收到权限请求时自动展开
- **像素风格图标** - Claude 螃蟹图标和动态符号 Spinner
- **流畅动画** - iOS 风格的弹性动画效果
- **Tab 设置页** - Hooks 配置和通用设置通过 Tab 切换
- **内联权限** - 在实例行内直接显示 Allow/Deny 按钮
- **聊天视图** - 点击查看实例的完整消息历史（支持 Markdown 渲染）
- **可定制产品名** - 展开空闲状态显示可配置的产品名称
- **Cloud 连接状态** - 显示与云服务器的连接状态

### 状态显示（Desktop & Mobile 统一）

| 状态 | 图标 | 文案 |
|------|------|------|
| Thinking | 橙色 Spinner | Thinking |
| Working | 橙色 Spinner + 工具参数 | Bash: grep demo xx.log |
| Waiting | 橙色 Spinner | Thinking |
| WaitingForApproval | Amber Spinner | 需要授权 |
| Compacting | 紫色 Spinner | Compacting |
| Idle/Ended/Error | 灰色静态圆点 | (空) |

> Desktop 和 Mobile 的状态显示逻辑完全统一，包括 Spinner 动画特效、文案、颜色。

---

## 架构概览

```
┌─────────────────┐                    ┌─────────────────┐
│   Desktop App   │◄──── WebSocket ───►│   Cloud Server  │
│  (Tauri/Rust)   │                    │    (Rust/Axum)  │
│                 │                    │   + PostgreSQL  │
│ ┌─────────────┐ │                    │                 │
│ │ HTTP Server │ │                    │ ┌─────────────┐ │
│ │  (Port 17527│◄── Claude Hooks ───►│ │   Router    │ │
│ │  Axum)      │ │                    │ │  (WebSocket)│ │
│ └─────────────┘ │                    │ └─────────────┘ │
│                 │                    │                 │
│ ┌─────────────┐ │                    │ ┌─────────────┐ │
│ │ CloudClient │◄─── Push Hook ──────►│ │  Repository │ │
│ │ (WebSocket) │ │                    │ │   (Postgres)│ │
│ └─────────────┘ │                    │ └─────────────┘ │
│                 │                    │                 │
│ ┌─────────────┐ │                    │ ┌─────────────┐ │
│ │  State +    │ │                    │ │  StateCache │ │
│ │  PopupQueue │ │                    │ │   (Memory)  │ │
│ └─────────────┘ │                    │ └─────────────┘ │
│                 │                    │                 │
│ ┌─────────────┐ │                    │                 │
│ │ JSONL Watcher│◄── Conversation ────│                 │
│ │  (Polling)  │ │    File Parsing    │                 │
│ └─────────────┘ │                    │                 │
└─────────────────┘                    └─────────────────┘
                                               │
                               ┌───────────────┴───────────────┐
                               │                               │
                        ┌──────┴──────┐                 ┌──────┴──────┐
                        │  Mobile 1   │                 │  Mobile 2   │
                        │  (React +   │                 │  (React +   │
                        │  Capacitor) │                 │  Capacitor) │
                        │             │                 │             │
                        │ Subscribe:  │                 │ Subscribe:  │
                        │ [Device A,  │                 │ [Device A]  │
                        │  Device B]  │                 │             │
                        └─────────────┘                 └─────────────┘
```

### 数据流

1. **Hook 事件流**：Claude Code → HTTP Hook → Desktop → Cloud Server → Mobile
2. **权限响应流**：Mobile → Cloud Server → Desktop → Claude Code
3. **聊天历史流**：Desktop JSONL Watcher → Cloud Server → Mobile

### 核心模块

**Desktop (Tauri)**：
- HTTP Server：接收 Claude Code hooks，管理弹窗队列
- Cloud Client：WebSocket 连接云服务器，推送状态
- Instance Manager：管理实例生命周期和状态
- Popup Queue：阻塞型事件队列（Permission/Ask）
- JSONL Watcher：轮询解析对话历史文件

**Cloud Server (Rust)**：
- Router：WebSocket 连接管理，Desktop/Mobile 路由
- Repository：PostgreSQL 持久化 sessions/popups/chat history
- State Cache：内存缓存实时状态，快速推送

**Mobile (React)**：
- Multi-Device WebSocket：单连接订阅多设备
- Session List：实时显示所有订阅设备的实例
- Popup Handler：权限审批/问题回答
- Chat View：查看历史消息

---

## Mobile App

手机端支持远程监控和审批，基于 Capacitor 跨平台构建。

### 功能

- **多设备订阅** - 单个连接订阅多个 Desktop 设备
- **状态监控** - 实时查看 Claude 执行状态（完全匹配 Desktop）
- **权限审批** - 远程 Allow/Deny 权限请求
- **Ask 回答** - 远程回答 AskUserQuestion 问题
- **Toast 提示** - Desktop 处理弹窗时显示通知
- **聊天视图** - 查看完整消息历史（Markdown 渲染）

### 界面设计

采用深色主题设计，与 Desktop 状态显示完全统一：
- 动态 Spinner 显示 Thinking/Working 状态
- Amber Spinner 显示 WaitingForApproval 状态
- 工具参数完整显示（如 `Bash: grep demo xx.log`）

---

## 安装

### 下载安装包

从 [Releases](https://github.com/your-repo/cc-island/releases) 页面下载对应平台的安装包：

| 平台 | 格式 |
|------|------|
| macOS (Apple Silicon) | `.dmg`, `.app` |
| macOS (Intel) | `.dmg`, `.app` |
| Windows | `.msi`, `.exe` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

### macOS 安装注意事项

由于应用未进行代码签名，首次安装后 macOS 可能会提示"文件已损坏"。解决方法：

```bash
xattr -cr /Applications/Ease-Island.app
```

---

## 快速开始

### 1. 启动 CC-Island

首次启动应用时，它会自动：
- 创建 `~/.cc-island/` 目录
- 生成 SessionStart 脚本
- 配置 Claude Code hooks

### 2. 启动 Claude Code

启动任意 Claude Code 实例，CC-Island 会自动检测并显示。

### 3. 配置 Cloud Relay（可选）

如需手机远程监控：
1. 启动云服务器
2. Desktop Settings → Cloud → 填写服务器地址并复制 Token
3. Mobile Settings → 添加服务器地址 + Token

---

## 编译

### 环境要求

- Node.js >= 18
- pnpm >= 8
- Rust >= 1.70
- PostgreSQL >= 14（Cloud Server）

### 编译步骤

```bash
# 克隆仓库
git clone https://github.com/your-repo/cc-island.git
cd cc-island

# 安装依赖
pnpm install

# 开发模式运行
pnpm tauri dev

# 构建生产版本
pnpm tauri build

# 编译云服务器
cd cloud-server
cargo build --release
```

---

## 项目结构

```
cc-island/
├── src/                    # React 前端（桌面）
│   ├── components/         # UI 组件
│   ├── stores/             # Zustand 状态管理
│   └── App.tsx             # 主应用
│
├── src-tauri/              # Rust 后端
│   └── src/
│       ├── lib.rs          # 主入口
│       ├── http_server.rs  # HTTP API + Hook 处理
│       ├── cloud_client.rs # WebSocket 云客户端
│       ├── instance_manager.rs
│       ├── popup_queue.rs
│       ├── chat_messages.rs
│       ├── conversation_parser.rs
│       └── platform/       # 平台特定实现
│
├── mobile-app/             # 手机端应用
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── hooks/          # WebSocket hooks
│   │   └── App.tsx
│   ├── android/
│   └── ios/
│
├── cloud-server/           # 云服务器
│   └── src/
│       ├── ws/             # WebSocket 处理
│       ├── db/             # 数据库操作
│       └── cache/          # 内存缓存
│
├── hooks/                  # Claude Code Hook 配置
└ docs/                    # 文档
```

---

## 技术栈

| 平台 | 技术 |
|------|------|
| Desktop Frontend | React 18 + TypeScript + Tailwind CSS + Framer Motion |
| Desktop Backend | Rust + Tauri 2.x + Axum + tokio-tungstenite |
| Mobile Frontend | React 18 + TypeScript + Tailwind CSS + Capacitor |
| Cloud Server | Rust + Tokio + Axum + PostgreSQL + SQLx |
| 状态管理 | Zustand |
| 实时通信 | WebSocket |

---

## 支持的 Hook 事件

### 阻塞型事件

| 事件 | 超时 | 说明 |
|------|------|------|
| PermissionRequest | 300s | 权限请求 |
| Elicitation | 120s | MCP 请求用户输入 |
| Notification (Ask) | 120s | 提问 |

### 非阻塞型事件

| 事件 | 说明 |
|------|------|
| SessionStart | 会话启动 |
| SessionEnd | 会话结束 |
| Stop | 响应完成 |
| PreToolUse | 工具执行前 |
| PostToolUse | 工具执行后 |
| UserPromptSubmit | 用户提交输入 |
| PreCompact | 对话压缩前 |
| PostCompact | 对话压缩后 |

---

## 常见问题

### Q: 为什么灵动岛不显示实例？

确保 CC-Island 正在运行，Claude Code hooks 已配置，端口 17527 未被占用。

### Q: Desktop 和 Mobile 状态显示不一致？

Desktop 和 Mobile 的状态显示逻辑已完全统一，包括 Spinner 动画、文案、颜色。如有问题请检查版本是否一致。

### Q: Cloud Relay 如何配置？

1. 启动云服务器并配置 PostgreSQL
2. Desktop Settings → Cloud → 填写服务器地址
3. Mobile Settings → 添加服务器地址 + 设备 Token

### Q: 如何添加多设备？

Mobile 支持订阅多个 Desktop 设备：
1. Desktop Settings → Cloud → 点击"复制 Token"
2. Mobile Settings → 点击"+" → 输入 Token
3. 可添加多个设备，Mobile 会实时显示所有设备状态

---

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
