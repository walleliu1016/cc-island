# CC-Island

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="CC-Island Logo" width="128" height="128">
</p>

<p align="center">
  <strong>iOS 灵动岛风格的 Claude Code 实例管理器</strong>
</p>

<p align="center">
  跨平台桌面应用，实时监控和管理多个 Claude Code 终端实例
</p>

<p align="center">
  <a href="#安装">安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#功能特性">功能特性</a> •
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

### 界面特点

- **灵动岛设计** - 类似 iOS 灵动岛的弧形胶囊 UI，底部大圆角设计
- **点击展开** - 点击灵动岛展开实例列表（不再是悬停展开）
- **自动展开** - 收到权限请求时自动展开
- **像素风格图标** - Claude 螃蟹图标和状态指示器
- **流畅动画** - iOS 风格的弹性动画效果
- **Tab 设置页** - Hooks 配置和通用设置通过 Tab 切换
- **内联权限** - 在实例行内直接显示 Allow/Deny 按钮
- **聊天视图** - 点击查看实例的完整消息历史

### 状态显示

| 状态 | 图标 | 说明 |
|------|------|------|
| 正在执行 | 🦀 + 旋转符号 | Claude 正在执行工具 |
| 等待权限 | 🦀 + 🔶 琥珀色 | 有待处理的权限请求 |
| 等待输入 | 🦀 + ✅ 绿色 | 等待用户输入 |
| 空闲 | 🦀 + ● 灰色 | 空闲状态 |

状态图标采用像素风格设计，处理时螃蟹腿部会有动画。

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

### 系统要求

- **macOS**: 10.15 (Catalina) 及以上
- **Windows**: Windows 10 及以上
- **Linux**: 主流发行版（需要 compositor 支持透明窗口）

---

## 快速开始

### 1. 启动 CC-Island

首次启动应用时，它会自动：
- 创建 `~/.cc-island/` 目录
- 生成 `session-start.sh` 或 `session-start.ps1` 脚本
- 配置 Claude Code hooks（更新 `~/.claude/settings.json`）

> **一键配置**: 不需要手动复制脚本或编辑配置文件！

### 2. 启动 Claude Code

启动任意 Claude Code 实例，CC-Island 会自动检测并显示。

---

## 使用方式

### 基本界面

```
┌─────────────────────────────────────────┐
│ 🦀  3 active · 1 pending            ⚙️  │  ← 胶囊形态（点击展开）
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🦀  3 active · 1 pending            ⚙️  │
├─────────────────────────────────────────┤
│ demo                             [👁][💬] │  ← 实例列表
│ 🔶 Bash: Edit file...    [Deny][Allow]  │
├─────────────────────────────────────────┤
│ api-server                       [👁][💬] │
│ ✅ 等待输入                               │
└─────────────────────────────────────────┘
```

### 聊天视图

```
┌─────────────────────────────────────────┐
│ ← Back  demo                            │  ← 顶部导航
├─────────────────────────────────────────┤
│ 你                                       │
│ npm test                                  │
├─────────────────────────────────────────┤
│ Bash                                      │
│ Waiting for approval...                   │
│ {                                         │
│   "command": "npm test"                   │
│ }                                         │
├─────────────────────────────────────────┤
│                        [Deny] [Allow]   │  ← 底部权限按钮
└─────────────────────────────────────────┘
```

### 操作说明

1. **查看状态** - 灵动岛默认显示实例数量和状态摘要
2. **展开列表** - 点击灵动岛展开完整实例列表
3. **响应权限** - 在实例行内直接点击 **Allow** 或 **Deny**
4. **查看聊天** - 点击实例行的 💬 图标查看消息历史
5. **跳转终端** - 点击实例行的 👁 图标激活对应终端
6. **设置** - 展开状态下点击右上角菜单图标 ⚙️ 进入设置
7. **关闭弹窗** - 点击外部区域或按 ESC 关闭展开状态

### 权限请求显示

当 Claude 请求执行工具时，在实例行内显示：

```
demo                              [👁][💬]
🔶 Bash: 删除测试目录    [Deny][Allow]
```

- 第一行：项目名 + 操作按钮（跳转/查看聊天）
- 第二行：状态图标 + 工具名 + 操作描述 + Allow/Deny 按钮

工具输入参数以代码块样式显示在聊天视图中。

### AskUserQuestion 显示

支持多问题分页显示：

```
💬 问题 1/2                      demo
框架
选择前端框架?
☐ React - Facebook出品
☑ Vue - 渐进式框架
     ← 上一个  ● ●  下一个 →
```

---

## 支持的 Hook 事件

### 阻塞型事件（需要用户响应）

| 事件 | 超时 | 说明 |
|------|------|------|
| PermissionRequest | 300s | 权限请求，用户允许/拒绝 |
| Notification (Ask) | 120s | 提问，用户回答 |
| Elicitation | 120s | MCP 服务器请求用户输入 |

### 非阻塞型事件（仅记录状态）

| 事件 | 超时 | 说明 |
|------|------|------|
| SessionStart | 5s | 会话启动（command 类型） |
| SessionEnd | 5s | 会话结束 |
| Stop | 5s | 响应完成 |
| PreToolUse | 5s | 工具执行前 |
| PostToolUse | 5s | 工具执行后 |
| PostToolUseFailure | 5s | 工具执行失败 |
| PreCompact | 5s | 对话压缩前 |
| PostCompact | 5s | 对话压缩后 |
| UserPromptSubmit | 5s | 用户提交输入 |
| SubagentStart | 5s | 子代理启动 |
| SubagentStop | 5s | 子代理停止 |

> **重要**: SessionStart 只支持 command 类型 hooks，因为 HTTP 服务可能尚未就绪。

---

## 配置文件

### hooks.json

完整的 Claude Code hooks 配置：

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "~/.cc-island/session-start.sh",
        "timeout": 5
      }]
    }],
    "SessionEnd": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "Stop": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "PreToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "PostToolUseFailure": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "PermissionRequest": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 300 }]
    }],
    "Notification": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "PreCompact": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "PostCompact": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "SubagentStart": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }],
    "SubagentStop": [{
      "hooks": [{ "type": "http", "url": "http://localhost:17527/hook", "timeout": 5 }]
    }]
  }
}
```

---

## 编译

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8 (或 npm/yarn)
- **Rust** >= 1.70
- **系统依赖**:
  - macOS: Xcode Command Line Tools
  - Windows: Microsoft Visual Studio C++ Build Tools
  - Linux: `build-essential`, `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`

### 编译步骤

```bash
# 1. 克隆仓库
git clone https://github.com/your-repo/cc-island.git
cd cc-island

# 2. 安装依赖
pnpm install

# 3. 开发模式运行
pnpm tauri dev

# 4. 构建生产版本
pnpm tauri build

# 5. 构建 debug 版本（测试用）
pnpm tauri build --debug
```

### 编译输出

| 平台 | 输出路径 |
|------|----------|
| macOS | `src-tauri/target/release/bundle/dmg/CC-Island.dmg` |
| macOS | `src-tauri/target/release/bundle/macos/CC-Island.app` |
| Windows | `src-tauri/target/release/bundle/msi/CC-Island_0.1.0_x64.msi` |
| Linux | `src-tauri/target/release/bundle/deb/cc-island_0.1.0_amd64.deb` |
| Linux | `src-tauri/target/release/bundle/appimage/cc-island_0.1.0_amd64.AppImage` |

---

## 项目结构

```
cc-island/
├── src/                        # React 前端
│   ├── components/
│   │   ├── InstanceList.tsx    # 实例列表组件
│   │   ├── ChatView.tsx        # 聊天视图组件
│   │   ├── Settings.tsx        # 设置组件（Tab 切换）
│   │   ├── StatusIcons.tsx     # 状态图标组件（螃蟹、旋转器等）
│   │   └── NotchShape.tsx      # 灵动岛形状生成
│   ├── stores/
│   │   └── appStore.ts         # Zustand 状态管理
│   ├── types/
│   │   └── index.ts            # TypeScript 类型定义
│   └── App.tsx                 # 主应用组件
│
├── src-tauri/                  # Rust 后端
│   └── src/
│       ├── lib.rs              # 主入口
│       ├── http_server.rs      # HTTP API 服务
│       ├── chat_messages.rs    # 聊天消息管理
│       ├── instance_manager.rs # 实例管理
│       ├── popup_queue.rs      # 弹窗队列
│       ├── hook_handler.rs     # Hook 数据结构
│       └── platform/           # 平台特定实现
│           ├── mod.rs
│           └── macos.rs        # macOS Jump 实现
│
├── hooks/
│   ├── hooks.json              # Claude Code Hook 配置（参考）
│   └── cc-island-session-start.sh  # SessionStart 脚本（参考）
│   # 注：实际配置由应用自动生成到 ~/.cc-island/
│
└── docs/
    ├── HOOKS.md                # Hooks 配置文档
    ├── hook-reference.md       # Hook 请求/响应参考
    └── hooks-claude.md         # Claude Code Hooks 官方文档
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 样式 | Tailwind CSS |
| 动画 | Framer Motion |
| 状态管理 | Zustand |
| 桌面框架 | Tauri 2.x |
| 后端 | Rust + Axum |
| HTTP 服务 | Axum (端口 17527) |

---

## API 接口

CC-Island 提供 HTTP API：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/hook` | POST | 接收 Claude Code Hook |
| `/response` | POST | 用户响应弹窗 |
| `/jump` | POST | 跳转到终端 |
| `/instances` | GET | 获取实例列表 |
| `/popups` | GET | 获取弹窗列表 |
| `/instance/:id` | GET/DELETE | 获取/删除实例 |
| `/settings` | GET/PUT | 获取/更新设置 |

### 测试命令

```bash
# 测试 SessionStart
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"SessionStart","session_id":"test-1","cwd":"/Users/you/project/demo"}'

# 测试 PermissionRequest
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"PermissionRequest","session_id":"test-1","tool_name":"Bash","tool_input":{"command":"ls -la"}}'

# 查看实例
curl http://localhost:17527/instances | jq

# 查看弹窗
curl http://localhost:17527/popups | jq
```

---

## 常见问题

### Q: 为什么灵动岛不显示实例？

确保：
1. CC-Island 正在运行（首次启动会自动配置 hooks）
2. Claude Code 已正确配置 hooks（检查 `~/.claude/settings.json`）
3. 检查端口 17527 是否被占用：`lsof -i :17527`

### Q: 如何重新配置 hooks？

删除初始化标记文件后重启应用：
```bash
rm ~/.cc-island/.initialized
# 然后重启 CC-Island
```

### Q: Jump 功能不起作用？

macOS 需要：
1. 授予 CC-Island 辅助功能权限（系统偏好设置 → 安全性与隐私 → 隐私 → 辅助功能）
2. 终端应用支持窗口激活

### Q: 权限请求超时怎么办？

- 默认超时 5 分钟
- 超时后自动拒绝
- 确保及时响应灵动岛上的弹窗

### Q: 项目名显示为 "unknown"？

确保 Hook 请求中包含 `cwd` 字段，CC-Island 从工作目录提取项目名。

---

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
