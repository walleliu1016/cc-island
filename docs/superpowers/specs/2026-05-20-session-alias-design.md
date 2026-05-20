# Session Alias 设计文档

## 问题背景

CC-Island 目前显示 project_name 作为 session 标识，存在两种重名场景：

| 场景 | 示例 | 问题 |
|------|------|------|
| 不同目录同名项目 | `~/work/my-project` vs `~/personal/my-project` | 都显示 `my-project`，无法区分 |
| 同目录多 session | 同一目录启动 2 个 Claude | 名称完全相同，只有 session_id 不同 |

## 设计方案

### 1. 显示名称规则

优先级从高到低：

| 优先级 | 条件 | 显示内容 | 示例 |
|--------|------|---------|------|
| 1 | 有用户自定义别名 | 别名 | `调试分支` |
| 2 | 无别名，无重名 | project_name | `my-project` |
| 3 | 无别名，有重名 | project_name + 自动编号 + [尾号] | `my-project #2 [a3f]` |

**自动编号规则：**
- 按 cwd 分组，同 cwd 的 session 按启动时间排序编号
- 第一个不加编号，第二个显示 `#2`，第三个显示 `#3`
- 尾号取 session_id 后 4 位

**悬停 Tooltip：**
- 显示完整 cwd 路径（如 `~/work/my-project`）

### 2. 右键菜单

- 仅"重命名"选项
- 长按或右键触发
- 弹出小型输入框编辑别名

### 3. 自动折叠机制

**折叠条件：**
- 10分钟（600秒）无活动 → 自动折叠
- 有新活动（任何 hook 事件） → 自动展开

**折叠区 UI：**
- 底部显示"已折叠 (N)"可点击区域
- 点击后展开显示折叠的 session 列表
- 折叠的 session 仍可点击查看 ChatView

**活跃判定：**
- `last_activity_at` 字段追踪
- 任何 hook 事件都更新此字段

### 4. 持久化

**存储位置：**
- `~/.cc-island/aliases.json`

**存储格式：**
```json
{
  "aliases": {
    "/home/user/work/my-project": "工作项目",
    "/home/user/personal/my-project": "个人项目"
  }
}
```

**匹配规则：**
- 按 cwd 匹配
- 同 cwd 再次启动 Claude 时自动应用之前设置的别名

### 5. 额外信息显示

悬停 Tooltip 内容：

| 信息 | 来源字段 | 格式 |
|------|---------|------|
| 完整路径 | session_cwd | `~/work/my-project` |
| 运行时长 | started_at | `运行 15分钟` |
| 最后活动 | last_activity_at | `5分钟前活动` |
| 终端类型 | process_info.terminal_type | `iTerm2` |

## 技术实现要点

### 前端改动

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | ClaudeInstance 添加 alias 字段（可选） |
| `src/components/InstanceList.tsx` | 显示名称逻辑 + 右键菜单 + 折叠区 |
| `src/stores/appStore.ts` | 添加 aliases 状态管理 |
| `src/services/aliasService.ts` | 新增：别名持久化服务 |

### 后端改动

| 文件 | 改动 |
|------|------|
| `src-tauri/src/instance_manager.rs` | 无需改动（已有 last_activity_at） |
| `src-tauri/src/lib.rs` | 新增 aliases 相关 Tauri command |
| `src-tauri/src/http_server.rs` | hook 处理时更新 last_activity_at（已有） |

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/services/aliasService.ts` | 前端别名持久化服务 |
| `src/components/FoldedSessions.tsx` | 折叠区 UI 组件 |
| `src/components/ContextMenu.tsx` | 右键菜单组件 |

## 数据流

```
SessionStart → 读取 aliases.json → 匹配 cwd → 设置 alias
用户重命名 → 更新 alias → 保存到 aliases.json
hook 事件 → 更新 last_activity_at → 前端判断折叠状态
前端轮询 → 获取 instances → 计算 10分钟阈值 → 分组活跃/折叠
```

## 界面草图

```
┌─────────────────────────────────────┐
│  ○ my-project          [Chat] [Jump]│  ← 活跃 session
│    Bash · npm test                   │
│  ○ work/my-project #2 [a3f]         │  ← 有别名/重名
│    Thinking                          │
├─────────────────────────────────────┤
│  已折叠 (3) ▼                        │  ← 折叠区入口
├─────────────────────────────────────┤
│  ○ personal/my-project              │  ← 点击展开后显示
│    Idle · 5分钟前                    │
│  ○ my-project #3 [f2c]              │
│    Idle · 12分钟前                   │
└─────────────────────────────────────┘
```

右键菜单：

```
┌──────────────────┐
│ 📝 重命名         │
└──────────────────┘
```

重命名弹窗：

```
┌─────────────────────────────┐
│ 重命名 session              │
│ ┌─────────────────────────┐ │
│ │ 调试分支                 │ │
│ └─────────────────────────┘ │
│        [取消] [保存]        │
└─────────────────────────────┘
```