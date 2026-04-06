---
name: CC-Island Dynamic Island for Claude Code
description: 跨平台灵动岛应用，用于监控和管理多个 Claude Code 终端实例
type: project
---

# CC-Island 设计文档

**日期**: 2026-04-04
**版本**: 1.0
**状态**: ✅ 已实现

## 概述

CC-Island 是一个类似 iOS 灵动岛的跨平台桌面应用，用于监控和管理多个 Claude Code 终端实例。它提供始终置顶的灵动岛 UI，实时显示所有 Claude 实例的状态，并支持权限请求和 Ask 问题的远程响应。

### 核心功能

1. **状态监控** - 实时显示所有 Claude 实例的运行状态
2. **权限响应** - 远程允许/拒绝 Claude 的权限请求
3. **Ask 响应** - 远程回答 Claude 的问题
4. **实例跳转** - 一键激活对应的终端窗口
5. **通知提示** - 显示 Claude 的通知信息

### 支持平台

- macOS 10.15+
- Windows 10/11
- Linux (主流发行版)

---

## 1. 技术栈

### 1.1 应用框架

- **Tauri 2.x** - Rust + WebView 的跨平台桌面应用框架
- **选择理由**：
  - 体积小（约 3-5MB）
  - 原生系统集成强
  - 跨平台一致性好
  - 性能优异

### 1.2 前端

- **React 18** + **TypeScript** - UI 框架
- **Framer Motion** - 动画库（iOS 弹性动画）
- **Zustand** - 状态管理
- **Tailwind CSS** - 样式方案

### 1.3 后端

- **Rust** - Tauri 后端
- **Axum** - 内嵌 HTTP Server
- **Tokio** - 异步运行时
- **sysinfo** - 进程信息获取

### 1.4 通信机制

- **HTTP Hook** - Claude Code 原生支持的 HTTP hooks
- 端口: `17527`（固定端口）

---

## 2. 系统架构

### 2.1 整体架构

```
┌───────────────────────────────────────────────────────┐
│                  CC-Island (Tauri 应用)                │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Rust 后端 (Core)                   │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  HTTP Server (端口 17527)                       │ │
│  │  ├─ POST /hook        接收 Claude Code Hook     │ │
│  │  ├─ POST /response    接收用户操作响应          │ │
│  │  ├─ POST /jump        跳转到指定终端            │ │
│  │  ├─ GET /instances    获取所有实例状态          │ │
│  │  ├─ GET /settings     获取应用设置              │ │
│  │  └─ PUT /settings     更新应用设置              │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  系统集成                                       │ │
│  │  ├─ 窗口管理 (始终置顶、无边框、透明背景)       │ │
│  │  ├─ 拖拽移动                                    │ │
│  │  ├─ 系统托盘                                    │ │
│  │  └─ 终端窗口激活 (Jump 功能)                    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │            React 前端 (WebView)                 │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  状态管理 (Zustand)                             │ │
│  │  UI 组件 (DynamicIsland, Popup, etc.)           │ │
│  │  动画系统 (Framer Motion)                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
└───────────────────────────────────────────────────────┘

         ▲
         │ HTTP POST (Hook JSON)
         │
┌────────┴────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Claude 终端 1   │  │ Claude 终端 2   │  │ Claude 终端 N   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 2.2 数据流

```
Hook 事件流程：

Claude 终端                    CC-Island                    用户
    │                              │                          │
    │ SessionStart Hook            │                          │
    │─────────────────────────────▶│                          │
    │                              │ 创建新实例记录            │
    │                              │ 触发启动动画              │
    │                              │                          │
    │ PermissionRequest Hook       │                          │
    │─────────────────────────────▶│                          │
    │                              │ 加入弹窗队列              │
    │                              │ 显示弹窗                  │
    │                              │─────────────────────────▶│
    │                              │                          │ 点击"允许"
    │                              │◀─────────────────────────│
    │◀─────────────────────────────│ 返回允许/拒绝决策        │
    │                              │                          │
```

---

## 3. 数据模型

### 3.1 Claude 实例

```typescript
interface ClaudeInstance {
  // 基础信息
  sessionId: string;           // Claude Code 会话 ID（UUID）
  projectName: string;         // 项目目录名（自动识别）
  customName?: string;         // 用户自定义名称

  // 进程信息（用于 Jump 功能）
  processInfo: {
    pid: number;               // Claude 进程 ID
    ppid: number;              // 父进程 ID（终端 shell）
    terminalPid: number;       // 终端进程 ID
    terminalType: TerminalType; // 终端类型
    workingDirectory: string;  // 工作目录
  };

  // 状态信息
  status: InstanceStatus;      // 当前状态
  currentTool?: string;        // 正在执行的工具
  toolInput?: ToolInput;       // 工具输入详情

  // 时间戳
  startedAt: number;           // 启动时间
  lastActivityAt: number;      // 最后活动时间
}

enum InstanceStatus {
  IDLE = 'idle',               // 空闲
  WORKING = 'working',         // 正在执行工具
  WAITING = 'waiting',         // 等待用户响应
  ERROR = 'error',             // 错误状态
  COMPACTING = 'compacting',   // 正在压缩对话
  ENDED = 'ended',             // 已结束
}

enum TerminalType {
  // macOS
  MACOS_TERMINAL = 'macos_terminal',
  MACOS_ITERM2 = 'macos_iterm2',
  MACOS_ALACRITTY = 'macos_alacritty',
  MACOS_VSCODE = 'macos_vscode',
  // Windows
  WINDOWS_TERMINAL = 'windows_terminal',
  WINDOWS_CMD = 'windows_cmd',
  WINDOWS_POWERSHELL = 'windows_powershell',
  // Linux
  LINUX_GNOME = 'linux_gnome',
  LINUX_KONSOLE = 'linux_konsole',
  LINUX_ALACRITTY = 'linux_alacritty',
  // 未知
  UNKNOWN = 'unknown',
}
```

### 3.2 弹窗队列

```typescript
interface PopupItem {
  id: string;                  // 弹窗唯一 ID
  sessionId: string;           // 所属实例
  projectName: string;         // 项目名
  type: 'permission' | 'ask' | 'notification';

  // 权限请求数据
  permissionData?: {
    toolName: string;
    action: string;
    details: string;
  };

  // Ask 数据
  askData?: {
    question: string;
    options?: string[];        // 有选项时显示按钮
  };

  // 通知数据
  notificationData?: {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  };

  // 状态
  status: 'pending' | 'processing' | 'resolved' | 'auto_close';
  createdAt: number;
  autoCloseAt?: number;        // 自动关闭时间（通知类型）

  // 超时追踪
  timeoutAt?: number;          // HTTP 超时时间
}
```

### 3.3 全局状态

```typescript
interface AppState {
  // 实例管理
  instances: ClaudeInstance[];
  maxInstances: number;        // 默认 10

  // 弹窗队列
  popupQueue: PopupItem[];
  maxDisplayed: number;        // 默认 5，同时显示的最大弹窗数

  // UI 状态
  islandPosition: { x: number; y: number };
  isExpanded: boolean;

  // 设置
  settings: AppSettings;
}

interface AppSettings {
  port: number;                // HTTP 端口，默认 17527
  maxInstances: number;        // 最大实例数，默认 10
  maxPopupQueue: number;       // 最大弹窗显示数，默认 5

  // 超时配置
  timeout: {
    httpTimeout: number;       // HTTP 超时，默认 300秒
    warningTime: number;       // 警告时间，默认 30秒
    criticalTime: number;      // 紧急警告，默认 10秒
    defaultPermissionAction: 'deny' | 'allow';
    notificationAutoClose: number; // 通知自动关闭，默认 5000ms
  };
}
```

---

## 4. Hook 事件支持

### 4.1 支持的 Hook 事件

| Hook 事件 | 优先级 | 说明 | 灵动岛行为 |
|-----------|--------|------|-----------|
| **SessionStart** | P0 | Claude 启动 | 创建实例，显示启动动画 |
| **SessionEnd** | P0 | Claude 结束 | 标记结束，30秒后移除 |
| **Stop** | P0 | 响应完成 | 更新状态为 IDLE |
| **PreToolUse** | P0 | 执行工具前 | 显示"正在执行..." |
| **PostToolUse** | P0 | 执行工具后 | 更新状态 |
| **PermissionRequest** | P0 | 权限请求 | 弹窗让用户允许/拒绝 |
| **Notification** | P0 | Ask 问题 | 弹窗让用户回答 |
| **PostToolUseFailure** | P1 | 工具执行失败 | 显示错误状态 |
| **PreCompact** | P1 | 压缩对话前 | 显示压缩状态 |
| **PostCompact** | P1 | 压缩对话后 | 恢复状态 |
| **UserPromptSubmit** | P1 | 用户输入时 | 记录活动 |
| **SubagentStart** | P2 | 子代理启动 | 显示子代理状态 |
| **SubagentStop** | P2 | 子代理停止 | 更新状态 |

### 4.2 Hook 配置示例

完整配置见项目 `hooks/hooks.json` 文件。关键配置说明：

| Hook 类型 | timeout | 说明 |
|-----------|---------|------|
| SessionStart | 5s | 快速响应，无需用户交互 |
| SessionEnd | 5s | 快速响应，无需用户交互 |
| Stop | 5s | 快速响应，无需用户交互 |
| PreToolUse | 5s | 快速响应，无需用户交互 |
| PostToolUse | 5s | 快速响应，无需用户交互 |
| PostToolUseFailure | 5s | 快速响应，无需用户交互 |
| PreCompact | 5s | 快速响应，无需用户交互 |
| PostCompact | 5s | 快速响应，无需用户交互 |
| UserPromptSubmit | 5s | 快速响应，无需用户交互 |
| SubagentStart | 5s | 快速响应，无需用户交互 |
| SubagentStop | 5s | 快速响应，无需用户交互 |
| **PermissionRequest** | **300s** | 需要用户交互，给予足够时间 |
| **Notification** | **5s** | 通知类型立即返回，不阻塞 |

---

## 5. API 接口

### 5.1 接口列表

| 接口 | 方法 | 说明 |
|------|------|------|
| `/hook` | POST | 接收 Hook 事件 |
| `/response` | POST | 用户操作响应 |
| `/jump` | POST | 跳转到终端 |
| `/instances` | GET | 获取实例列表 |
| `/instance/:id` | GET/DELETE | 获取/删除实例 |
| `/settings` | GET/PUT | 获取/更新设置 |
| `/position` | PUT | 更新灵动岛位置 |

### 5.2 Hook 接口详情

```typescript
// POST /hook
// 请求体
interface HookInput {
  session_id: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: object;
  tool_response?: object;
}

// 响应体
interface HookResponse {
  success: boolean;
  decision?: 'allow' | 'deny';  // PermissionRequest
  answer?: string;               // Ask
}
```

### 5.3 权限请求阻塞机制

- HTTP 请求超时设置为 300 秒（5分钟）
- 用户响应后立即返回结果
- 超时前 30 秒开始警告提醒
- 超时前 10 秒紧急警告
- 超时后返回默认决策（deny）

---

## 6. UI 设计

### 6.1 灵动岛形态

#### 设计原则

采用 iOS 原生灵动岛的**弧形胶囊设计**：

- **圆角半径**: 胶囊高度的一半（如高度 44px，圆角 22px）
- **边缘**: 完全圆滑的弧形边缘，无直角
- **动态伸缩**: 宽度变化时保持弧形比例
- **背景**: 半透明黑色（rgba(0, 0, 0, 0.85)）配合模糊效果

#### 胶囊形态（默认）

```
    ╭──────────────────────────────────────────╮
    │  ●  │  3 Claude · 1 working              │
    │     │  ● Editing src/App.tsx             │
    ╰──────────────────────────────────────────╯

    高度: 44px
    圆角半径: 22px (完全圆滑胶囊)
    宽度: 动态 (200-400px)
    背景: rgba(0, 0, 0, 0.85) + backdrop-blur
```

#### 展开形态（Hover）

```
    ╭──────────────────────────────────────────────────╮
    │                                                  │
    │  ┌────────────────────────────────────────────┐ │
    │  │ ● cc-island          Editing file.ts       │ │
    │  │   [Jump]                                   │ │
    │  └────────────────────────────────────────────┘ │
    │  ┌────────────────────────────────────────────┐ │
    │  │ ● my-project          Idle                 │ │
    │  │   [Jump]                                   │ │
    │  └────────────────────────────────────────────┘ │
    │                         [⚙ Settings]            │
    │                                                  │
    ╰──────────────────────────────────────────────────╯

    展开时保持顶部弧形，底部同样圆滑
    动画过渡：弧形比例保持一致
```

#### 弹窗列表形态

```
    ╭──────────────────────────────────────────────────╮
    │  ⚠️  5 pending · Click to respond               │
    ├──────────────────────────────────────────────────┤
    │                                                  │
    │  ╭────────────────────────────────────────────╮ │
    │  │ 🔐 Permission · cc-island                  │ │
    │  │    Bash: npm run build                      │ │
    │  │    [Deny] [Allow]                           │ │
    │  ╰────────────────────────────────────────────╯ │
    │                                                  │
    │  ╭────────────────────────────────────────────╮ │
    │  │ 💬 Ask · my-project                        │ │
    │  │    Which file to modify?                    │ │
    │  │    [src/index.ts] [src/utils.ts] [...]      │ │
    │  ╰────────────────────────────────────────────╯ │
    │                                                  │
    │  Showing 5/7 pending · Scroll for more          │
    ╰──────────────────────────────────────────────────╯

    弹窗项也采用圆角卡片设计
    整体容器保持弧形胶囊外观
```

### 6.2 状态显示优先级

1. **WAITING** (等待用户) → 警告图标 ⚠️
2. **ERROR** (错误) → 错误图标 ❌
3. **WORKING** (工作中) → 工作状态 ●
4. **COMPACTING** (压缩中) → 压缩状态 ●
5. **IDLE** (空闲) → 空闲状态 ●

### 6.3 弹窗列表（最多 5 个）

```
    ╭──────────────────────────────────────────────────╮
    │  ⚠️  5 pending · Click to respond               │
    ├──────────────────────────────────────────────────┤
    │                                                  │
    │  ╭────────────────────────────────────────────╮ │
    │  │ 🔐 Permission · cc-island                  │ │
    │  │    Bash: npm run build                      │ │
    │  │    [Deny] [Allow]                           │ │
    │  ╰────────────────────────────────────────────╯ │
    │  ╭────────────────────────────────────────────╮ │
    │  │ 💬 Ask · my-project                        │ │
    │  │    Which file to modify?                    │ │
    │  │    [src/index.ts] [src/utils.ts] [...]      │ │
    │  ╰────────────────────────────────────────────╯ │
    │  ...                                             │
    │  Showing 5/7 pending · Scroll for more          │
    ╰──────────────────────────────────────────────────╯
```

### 6.4 弧形设计规范

#### CSS 样式

```css
/* 灵动岛容器 - 弧形胶囊 */
.dynamic-island {
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 22px;           /* 圆角 = 高度的一半 */
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* 弹窗项卡片 - 圆角卡片 */
.popup-item {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;           /* 内部卡片圆角 */
  margin: 8px;
}

/* 按钮圆角 */
.button {
  border-radius: 8px;            /* 按钮圆角 */
}

/* 状态指示器 - 圆形 */
.status-indicator {
  border-radius: 50%;            /* 完全圆形 */
}
```

#### 尺寸规范

| 元素 | 高度 | 圆角半径 |
|------|------|----------|
| 胶囊（默认） | 44px | 22px |
| 胶囊（展开） | 动态 | 22px (顶部/底部) |
| 弹窗项卡片 | 动态 | 12px |
| 按钮 | 32px | 8px |
| 状态指示器 | 10px | 5px (50%) |

### 6.5 动画效果（iOS 风格）

使用 Framer Motion 实现：

- **弹性动画**: `type: 'spring', stiffness: 400, damping: 30`
- **挤压效果**: `scale: [0.8, 1.1, 1]`
- **平滑过渡**: `duration: 0.3, ease: 'easeOut'`
- **启动弹出**: 从胶囊展开的弹性效果

---

## 7. Jump 功能

### 7.1 实现原理

1. SessionStart Hook 时记录进程信息（pid, ppid, terminalPid, terminalType）
2. 用户点击 Jump 时，根据 terminalPid 和 terminalType 激活对应终端窗口

### 7.2 跨平台实现

| 平台 | 实现方式 |
|------|----------|
| **macOS** | AppleScript / osascript |
| **Windows** | PowerShell / Win32 API |
| **Linux** | wmctrl / xdotool |

### 7.3 终端类型识别

通过父进程链追溯，识别终端类型：

- macOS: Terminal.app, iTerm2, Alacritty, VSCode
- Windows: Windows Terminal, cmd, PowerShell
- Linux: gnome-terminal, konsole, alacritty

---

## 8. 超时处理

### 8.1 三层超时机制

1. **HTTP Hook 配置超时**: 300秒（5分钟）
2. **灵动岛超时提醒**: 超时前 30秒警告，10秒紧急警告
3. **超时默认行为**: PermissionRequest → deny, Ask → empty

### 8.2 超时警告 UI

```
超时前 30 秒：

┌─────────────────────────────────────────┐
│ ⚠️ Timeout in 30 seconds                │
│ ─────────────────█────────────          │
│                                         │
│    Tool: Bash                           │
│    [Deny] [Allow]                       │
└─────────────────────────────────────────┘
    边框黄色闪烁


超时前 10 秒：

┌─────────────────────────────────────────┐
│ 🔴 TIMEOUT IN 10 SECONDS                │
│ ───█─────────────────────────           │
│    Default action: DENY                 │
│    [Deny] [Allow]                       │
└─────────────────────────────────────────┘
    边框红色快速闪烁 + 轻微抖动
```

---

## 9. 项目结构

```
cc-island/
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   ├── hooks/              # React Hooks
│   ├── stores/             # Zustand 状态
│   ├── services/           # API 服务
│   ├── types/              # TypeScript 类型
│   └── utils/              # 工具函数
│
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── http_server.rs  # HTTP API
│   │   ├── hook_handler.rs # Hook 处理
│   │   ├── instance_manager.rs
│   │   ├── popup_queue.rs
│   │   ├── jump_handler.rs
│   │   └── platform/       # 平台特定实现
│   │       ├── macos.rs
│   │       ├── windows.rs
│   │       └── linux.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── hooks/                  # Claude Code Hook 配置示例
│   └── hooks.json
│
├── docs/                   # 文档
└── package.json
```

---

## 10. 发布计划

### 10.1 支持的安装包

| 平台 | 格式 |
|------|------|
| macOS | `.dmg`, `.app` |
| Windows | `.msi`, `.exe` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

### 10.2 系统要求

- **macOS**: 10.15 (Catalina) 及以上
- **Windows**: Windows 10 及以上
- **Linux**: 主流发行版，需要 compositor 支持透明窗口

---

## 附录 A: Hook 配置完整示例

完整配置文件位于项目 `hooks/hooks.json`，包含所有 13 种 Hook 事件的配置。

## 附录 B: API 接口详细文档

完整 API 规范将在实现阶段使用 OpenAPI 3.0 格式定义，核心接口已在第 5 节说明。

## 附录 C: 动画配置参数

Framer Motion 动画参数（第 6.5 节已定义核心参数）：

| 动画类型 | 参数 |
|----------|------|
| 弹性展开 | `type: 'spring', stiffness: 400, damping: 30` |
| 挤压效果 | `scale: [0.8, 1.1, 1]` |
| 平滑过渡 | `duration: 0.3, ease: 'easeOut'` |
| 弹窗出现 | `type: 'spring', stiffness: 300, damping: 25` |
| 弹窗消失 | `duration: 0.2` |

最终数值将在 UI 实现阶段根据实际效果微调。

---

## 11. 实现说明

### 11.1 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 灵动岛 UI | ✅ | 弧形胶囊设计，透明背景，始终置顶 |
| 窗口拖拽 | ✅ | 支持拖拽移动灵动岛位置 |
| Hover 展开 | ✅ | 鼠标悬停展开显示所有实例 |
| 自动展开 | ✅ | 收到 pending 弹窗自动展开 |
| 弹窗队列 | ✅ | 支持多个 pending 排队处理 |
| Permission 响应 | ✅ | Allow/Deny 按钮 |
| Ask 响应 | ✅ | 选项按钮和文本输入 |
| 实例状态 | ✅ | idle/working/waiting/error/compacting/ended |
| 状态通知 | ✅ | 新会话、状态变化、会话结束通知 |
| SessionEnd 清理 | ✅ | 会话结束时取消 pending 弹窗 |
| Jump 功能 | ✅ | macOS AppleScript 激活终端 |
| 项目名识别 | ✅ | 从 cwd 路径提取 |

### 11.2 状态显示格式

```
{count} Claude · {idle} idle · {working} working · {pending} pending
```

示例：
- `3 Claude · 2 idle · 1 working`
- `2 Claude · 1 working · 1 pending`

### 11.3 自动展开逻辑

1. 收到 PermissionRequest 或 Ask 类型 Hook
2. 灵动岛自动展开显示弹窗
3. 用户响应后自动收起
4. 如有下一个 pending，自动展开下一个

### 11.4 文件结构

```
cc-island/
├── src/
│   ├── App.tsx              # 主组件，包含自动展开逻辑
│   ├── components/
│   │   ├── InstanceList.tsx # 实例列表
│   │   └── PopupList.tsx    # 弹窗组件
│   ├── stores/
│   │   └── appStore.ts      # Zustand 状态
│   └── types/
│       └── index.ts         # TypeScript 类型
│
├── src-tauri/
│   └── src/
│       ├── lib.rs           # Tauri 命令
│       ├── http_server.rs   # HTTP API (Axum)
│       ├── instance_manager.rs
│       ├── popup_queue.rs   # 弹窗队列，含超时处理
│       ├── hook_handler.rs  # Hook 数据类型
│       └── platform/
│           ├── mod.rs
│           └── macos.rs     # Jump 功能实现
│
├── hooks/
│   └── hooks.json           # Claude Code Hook 配置
│
├── docs/
│   ├── HOOKS.md             # Hook 配置文档
│   └── superpowers/specs/
│       └── 2026-04-04-cc-island-design.md
│
└── README.md
```

### 11.5 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/hook` | POST | 接收 Claude Code Hook |
| `/instances` | GET | 获取实例列表 |
| `/popups` | GET | 获取弹窗列表 |
| `/response` | POST | 用户响应弹窗 |

### 11.6 Tauri IPC 命令

| 命令 | 说明 |
|------|------|
| `start_drag` | 开始拖拽窗口 |
| `get_instances` | 获取实例列表 |
| `get_popups` | 获取弹窗列表 |
| `respond_popup` | 响应弹窗 |
| `jump_to_instance` | 跳转到终端 |

### 11.7 测试方法

```bash
# 发送 SessionStart
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"SessionStart","session_id":"test-1","cwd":"/Users/akke/project/test"}'

# 发送 PermissionRequest
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{
    "hook_event_name": "PermissionRequest",
    "session_id": "test-1",
    "cwd": "/Users/akke/project/test",
    "permission_data": {"tool_name": "Bash", "action": "npm test"}
  }'

# 发送 Ask
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{
    "hook_event_name": "Notification",
    "session_id": "test-1",
    "cwd": "/Users/akke/project/test",
    "notification_data": {"message": "选择框架?", "type": "ask", "options": ["React", "Vue"]}
  }'
```