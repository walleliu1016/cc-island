# 历史会话功能设计

## 概述

新增「历史会话」tab，保存收到 SessionEnd 事件的会话，支持查看历史记录、重启会话。同时将现有「已折叠」重命名为「空闲会话」。

## 功能范围

- SessionEnd 时不再删除实例，标记为 Ended 并持久化到磁盘
- 灵动岛模式：三 tab（活动 / 空闲 / 历史），历史列表每项带「重启」按钮
- 桌面模式：ArchiveTab 拆分为（空闲 / 历史）两个独立 tab
- 重启弹窗：终端选择 + 参数 chips + 自定义参数 + 命令预览

## 后端设计

### 状态变更

**`instance_manager.rs`** — `ClaudeInstance`:
- 新增字段 `ended_at: Option<u64>` (Unix 秒), `#[serde(default)]`

**`http_server.rs`** — `SessionEnd` 处理:
- 改前: `state_guard.instances.remove_instance(...)` + 清理聊天记录
- 改后: 先 `instance.ended_at = Some(now)` + `state.history_store.add(instance)` 写入持久化 → 再从 `InstanceManager` 移除 + JSONL watcher unwatch
- 关键: 结束的实例从 InstanceManager 移除（不污染活跃列表），但完整保存到 HistoryStore
- `InstanceManager::cleanup_ended()` 方法可以直接移除（不再需要）

### 新增模块: `history_store.rs`

持久化路径: `~/.cc-island/history_sessions.json`

```rust
pub struct HistoryStore {
    path: PathBuf,
    sessions: HashMap<SessionId, ClaudeInstance>,
    max_age_days: u32, // 默认 30 天
}

impl HistoryStore {
    pub fn new() -> Self;
    pub fn load() -> Self;                     // 从文件加载
    pub fn save(&self);                        // 写入文件
    pub fn add(&mut self, instance: ClaudeInstance);
    pub fn remove(&mut self, session_id: &str);
    pub fn get_all(&self) -> Vec<ClaudeInstance>;
    pub fn cleanup(&mut self);                 // 清除超过 max_age_days 的记录
    pub fn get(&self, session_id: &str) -> Option<&ClaudeInstance>;
}
```

- `add()` 在 SessionEnd 时调用
- `cleanup()` 在启动时 + 定期（每小时）调用
- `remove()` 在用户手动删除时调用

### 新增 Tauri Commands

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `get_history_sessions` | - | `Vec<ClaudeInstance>` | 获取所有历史会话 |
| `remove_history_session` | `session_id: String` | `Result<()>` | 删除单个历史记录 |
| `get_available_terminals` | - | `Vec<TerminalInfo>` | 检测系统可用终端列表 |
| `restart_session` | `session_id, terminal_bundle_id, extra_args` | `Result<()>` | 在新终端中执行 `claude --resume` |

**`TerminalInfo` 结构:**

```rust
struct TerminalInfo {
    bundle_id: String,      // "com.apple.Terminal" / "com.googlecode.iterm2"
    display_name: String,   // "Terminal" / "iTerm2"
    launch_command: String, // AppleScript / shell command
}
```

**`restart_session` 实现:**
1. 从 `history_store` 获取会话的 `session_cwd`
2. 根据 `terminal_bundle_id` 选择对应的启动命令
3. 构造命令: `claude --resume {session_id} {extra_args}`
4. 在指定终端中执行（macOS 用 AppleScript，Linux 用 `-e` 参数）
5. 使用 `std::process::Command` 执行，不阻塞

**终端检测 (`get_available_terminals`):**

macOS: 扫描 `/Applications` 和 `~/Applications` 下的已知 `.app` 并验证存在:
- Terminal.app → `com.apple.Terminal`
- iTerm.app → `com.googlecode.iterm2`
- Warp.app → `dev.warp.Warp-Stable`
- Alacritty.app → `org.alacritty`
- Ghostty.app → `com.mitchellh.ghostty`

Linux: 检查 `which` 命令:
- gnome-terminal, konsole, alacritty, xterm, wezterm

Windows: 检查注册表和 PATH:
- Windows Terminal (`wt.exe`), cmd, powershell

### AppState 变更

```rust
pub struct AppState {
    // ...existing fields...
    pub history_store: HistoryStore,  // 新增
}
```

启动时调用 `HistoryStore::load()` + `cleanup()`。

## 前端设计

### 灵动岛模式

**`InstanceList.tsx`** — 拆分逻辑变更:

```typescript
function splitByState(instances: ClaudeInstance[]): {
  active: ClaudeInstance[]   // 非 ended、非折叠
  idle: ClaudeInstance[]     // 非 ended、超过 10min 无活动
  ended: ClaudeInstance[]    // status.type === 'ended'
}
```

当前 `splitByFoldState` 把 ended 也归入 folded，需要改为三路拆分。

**`InstanceList` 组件:**
- 顶部三个 tab: 活动(N) | 空闲(N) | 历史(N)
- 默认选中「活动」
- 「活动」tab → `SessionCard` 列表（当前逻辑）
- 「空闲」tab → `FoldedSessions`（改名 `IdleSessions`，收起/展开）
- 「历史」tab → `HistorySessions` 新组件

**新组件 `HistorySessions.tsx`:**
- 复用 `FoldedSessions` 的布局风格
- 每行: 状态点(灰色) | 项目名 | first_prompt | 时间范围 | 「↻ 重启」按钮
- 点击行 → 打开 ChatView（查看历史消息）
- 重启按钮 → 打开重启弹窗

### 桌面模式

**`DesktopMode.tsx`**:
- 当前 `ArchiveTab` 替换为三个独立 tab 按钮
- 「活动会话 (N)」「空闲会话 (N)」「历史会话 (N)」
- 历史和空闲 tab 用不同视觉样式区分

### 重启弹窗 `RestartDialog.tsx`

模态框组件，props:
```typescript
interface RestartDialogProps {
  sessionId: string;
  projectName: string;
  onClose: () => void;
}
```

内部状态:
- `selectedTerminal: string` — 终端 bundle_id
- `selectedArgs: string[]` — 选中的参数 chips
- `customArgs: string` — 自定义参数字符串
- `availableTerminals: TerminalInfo[]` — 从 `get_available_terminals` 获取

**布局:**
```
┌──────────────────────────────────┐
│  🔄 重启会话 — project-name      │
│                                  │
│  终端类型                        │
│  ┌──────────────────────────┐   │
│  │ Terminal            ▾    │   │
│  └──────────────────────────┘   │
│                                  │
│  Claude 参数（可选）             │
│  [--model sonnet] [--model opus] │
│  [--verbose] [--debug]           │
│                                  │
│  ┌──────────────────────────┐   │
│  │ 自定义参数...            │   │
│  └──────────────────────────┘   │
│                                  │
│  预览命令                        │
│  ┌──────────────────────────┐   │
│  │ claude --resume abc --   │   │
│  │ model sonnet --verbose   │   │
│  └──────────────────────────┘   │
│                                  │
│           [取消]    [启动]       │
└──────────────────────────────────┘
```

**启动流程:**
1. 用户点击「启动」
2. 前端调用 `invoke('restart_session', { sessionId, terminalBundleId, extraArgs })`
3. 后端构造命令并在新终端窗口中执行
4. 关闭弹窗

### appStore 变更

新增:
```typescript
historySessions: ClaudeInstance[]
setHistorySessions: (sessions: ClaudeInstance[]) => void
```

轮询中增加 `get_history_sessions` 调用。

## 数据流

```
SessionEnd Hook 到达
  → http_server.rs: set_status(Ended) + ended_at = now
  → history_store.add(instance)
  → history_store.save() → ~/.cc-island/history_sessions.json
  → JSONL watcher unwatch

用户点击「重启」
  → RestartDialog: get_available_terminals() → 渲染下拉
  → 用户选择终端 + 参数 → 点击启动
  → restart_session(id, terminal, args)
  → std::process::Command 打开新终端窗口
  → 新窗口中 Claude 执行 --resume

启动时
  → HistoryStore::load()
  → HistoryStore::cleanup() (删除 30 天前的)
  → 前端轮询 get_history_sessions()
```

## 错误处理

- 磁盘写入失败: tracing::error 记录，不影响主流程
- 终端检测失败: 返回默认的 Terminal 选项
- restart_session 失败: 返回 Err 给前端，显示 toast
- session_id 不存在于 history_store: 返回 `Err("Session not found")`
- 超过 max_age_days 清理失败: 记录 warn，下次再次尝试

## 测试策略

- 后端 `history_store` 单元测试: add/remove/save/load/cleanup
- 后端 `restart_session` 集成测试: macOS/Linux 下验证命令构造
- 前端 `HistorySessions` 组件测试: 渲染、点击重启、空状态
- 手动端到端测试: 启动一个 session → 结束 → 确认出现在历史 → 重启
