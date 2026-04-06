# CC-Island

<p align="center">
  <img src="docs/assets/icon.png" alt="CC-Island Logo" width="128" height="128">
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

- **灵动岛设计** - 类似 iOS 灵动岛的弧形胶囊 UI
- **自动展开** - 收到权限请求或问题时自动展开
- **悬停展开** - 鼠标悬停显示所有实例详情
- **流畅动画** - iOS 风格的弹性动画效果

### 状态显示

| 状态 | 图标 | 显示文本 | 说明 |
|------|------|----------|------|
| 正在执行 | ⚡ | 正在执行 + 工具名 | Claude 正在执行工具 |
| 等待权限 | 🔐 | 等待权限审核 | 有待处理的权限请求 |
| 等待回答 | 💬 | 等待用户回答 | 有待回答的问题 |
| 等待输入 | 💭 | 等待输入 | 等待用户输入 prompt |
| 等待响应 | ⏳ | 等待响应 | 等待 LLM 返回 |
| 执行失败 | ❌ | 执行失败 | 工具执行出错 |
| 压缩对话 | 📦 | 压缩对话 | 正在压缩上下文 |
| 会话结束 | 🏁 | 会话结束 | 会话已终止 |

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

### 1. 安装 SessionStart 脚本

SessionStart 事件使用 command 类型（非 HTTP），需要先安装脚本：

```bash
# 复制脚本到 Claude 配置目录
mkdir -p ~/.claude
cp hooks/cc-island-session-start.sh ~/.claude/
chmod +x ~/.claude/cc-island-session-start.sh
```

### 2. 配置 Claude Code Hooks

将 hooks 配置添加到 Claude Code 设置文件：

```bash
# 方法一：直接复制（推荐）
cp hooks/hooks.json ~/.claude/settings.json

# 方法二：合并到现有配置
# 编辑 ~/.claude/settings.json，将 hooks/hooks.json 中的 hooks 字段合并进去
```

### 3. 启动 CC-Island

启动应用后，它会自动在端口 17527 启动 HTTP 服务器。

### 4. 启动 Claude Code

现在启动任意 Claude Code 实例，CC-Island 会自动检测并显示。

---

## 使用方式

### 基本界面

```
┌─────────────────────────────────────────┐
│  ●  3 Claude · 2 idle · 1 working       │  ← 胶囊形态（默认）
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  ●  3 Claude · 2 idle · 1 working    ▼  │
├─────────────────────────────────────────┤
│  🔐 Bash                         demo   │  ← 权限请求弹窗
│  删除测试目录                            │
│  $ rm -rf /tmp/test-folder              │
│  [Deny] [Allow]                         │
├─────────────────────────────────────────┤
│  APP: demo                              │  ← 实例列表
│  ⚡ 正在执行 Bash                       │
│  Write file...                 [Jump]   │
├─────────────────────────────────────────┤
│  APP: api-server                        │
│  💭 等待输入                    [Jump]  │
└─────────────────────────────────────────┘
```

### 操作说明

1. **查看状态** - 灵动岛默认显示实例数量和状态摘要
2. **响应权限** - 权限请求自动展开，点击 **Allow** 或 **Deny**
3. **回答问题** - 问题自动展开，选择选项或输入文本后提交
4. **查看详情** - 鼠标悬停展开完整实例列表
5. **跳转终端** - 点击实例卡片上的 **Jump** 按钮激活对应终端

### 权限请求显示

当 Claude 请求执行工具时，显示格式：

```
🔐 Bash                          demo
删除测试目录 - 可能触发危险操作确认
$ rm -rf /tmp/test-folder
[Deny] [Allow]
```

- 第一行：工具名 + 项目名
- 第二行：操作描述
- 第三行：命令/文件路径（代码块样式）

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
        "command": "~/.claude/cc-island-session-start.sh",
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
│   │   ├── PopupList.tsx       # 弹窗组件
│   │   └── Settings.tsx        # 设置组件
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
│       ├── instance_manager.rs # 实例管理
│       ├── popup_queue.rs      # 弹窗队列
│       ├── hook_handler.rs     # Hook 数据结构
│       └── platform/           # 平台特定实现
│           ├── mod.rs
│           └── macos.rs        # macOS Jump 实现
│
├── hooks/
│   ├── hooks.json              # Claude Code Hook 配置
│   └── cc-island-session-start.sh  # SessionStart 脚本
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
1. CC-Island 正在运行
2. Claude Code 已正确配置 hooks
3. SessionStart 脚本已安装并赋予执行权限
4. 检查端口 17527 是否被占用：`lsof -i :17527`

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