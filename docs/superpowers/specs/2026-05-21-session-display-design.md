# Session 显示改进设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 改进Claude session的显示，增加时间信息、状态颜色区分、历史活动展示、归档功能和布局模式切换

**Architecture:** 
- 保持现有InstanceList组件结构，增强单行卡片显示
- 新增归档Tab组件、滑动菜单组件、布局切换功能
- 扩展后端提供最近10条工具活动记录

**Tech Stack:** React + Zustand + Framer Motion + Tailwind CSS + Tauri IPC

---

## 1. Session卡片显示改进

### 1.1 两行布局结构

**第一行（固定）**：
| 项目名 + session编号 | 状态指示（颜色+文字） | 运行时长 | 起始时间 |

**第二行（动态）**：
| 当前命令（如有） | 分隔符 | 历史标签（最多3个） | 展开按钮 | 弹性空间 | 操作按钮 |

### 1.2 状态颜色映射

| 状态 | 左边框颜色 | 状态文字颜色 | 背景色 |
|------|-----------|-------------|--------|
| 运行中 | #4caf50 (绿色) | #4caf50 | rgba(76,175,80,0.08) |
| 思考中 | #ffb700 (琥珀) | #ffb700 | rgba(255,183,0,0.08) |
| 空闲 | #9e9e9e (灰色) | #9e9e9e | rgba(158,158,158,0.05) |
| 已结束 | #ff9800 (橙色) | #ff9800 | rgba(255,152,0,0.08) |
| 报错 | #f44336 (红色) | #f44336 | rgba(244,67,54,0.08) |

### 1.3 当前命令显示

- **运行中/思考中**：显示当前执行的工具和内容
  - 格式：⚡ 工具名: 内容（如 `Bash: cat demo.txt`）
  - 样式：高亮背景 + 状态对应颜色边框
- **空闲/已结束**：不显示当前命令

### 1.4 历史标签显示

- 最多显示3个工具标签
- 超过3个时显示展开按钮：`+N ▾`
- 标签样式：普通背景 rgba(255,255,255,0.08)

### 1.5 操作按钮

- **查看会话**：点击进入ChatView查看完整对话
  - Island模式：💬 emoji
  - 桌面模式：图标 + "会话"文字
- **跳转终端**：激活该session所在的终端窗口
  - Island模式：⌨️ emoji
  - 桌面模式：终端图标
- **已结束session**：只保留查看会话按钮（无跳转终端）
- 按钮位置：第二行最右侧

---

## 2. 展开详情弹窗

### 2.1 弹窗内容

点击展开按钮后显示最近10条活动：

| 时间 | 工具名 | 执行内容 | 结果摘要 |

### 2.2 结果摘要格式

| 工具 | 成功结果 | 失败结果 |
|------|---------|---------|
| Bash | ✓ 成功 | ✗ 错误信息 |
| Read | ✓ 读取 N 行 | ✗ 文件不存在 |
| Write | ✓ 写入 N 行 | ✗ 权限拒绝 |
| Edit | ✓ 替换 N 处 | ✗ 未找到匹配 |
| Ask | ✓ 已回答: 选择 | - |
| WebFetch | ✓ 获取成功 | ✗ 网络错误 |
| 执行中 | ● 执行中... | - |

### 2.3 弹窗样式

- 背景：rgba(0,0,0,0.4)
- 边框：rgba(255,255,255,0.1)
- 圆角：8px
- 每条活动行：padding 6px, 背景区分（运行中高亮）

---

## 3. 右侧滑动菜单

### 3.1 交互方式

- 向左滑动session卡片，露出右侧菜单
- 滑动距离：约80px显示完整菜单

### 3.2 菜单内容

| 按钮 | 图标 | 颜色 | 功能 |
|------|------|------|------|
| 删除 | ✗ | #f44336 | 从列表移除该session |
| 归档 | 归档图标 | #888 | 手动归档到归档tab |

### 3.3 菜单样式

- 背景：rgba(255,255,255,0.1)
- 宽度：80px
- 圆角：8px
- 按钮垂直排列

---

## 4. 顶部归档Tab

### 4.1 Tab切换

| Tab | 显示内容 |
|-----|---------|
| 活动会话 (N) | 正在运行/空闲/思考中的session |
| 归档 (N) ▾ | 已结束和空闲超过阈值的session |

### 4.2 归档规则

- 已结束session自动归档
- 空闲超过10分钟的session自动归档
- 可手动归档（通过滑动菜单）

### 4.3 归档列表样式

简洁单行显示：
| 状态点 | 项目名 | 时间范围 | 运行时长 | 状态/历史缩略 |

- 边框宽度：2px（比活动session更窄）
- padding更小（6px 10px）
- 只显示核心信息，无展开详情

---

## 5. 布局模式切换

### 5.1 Island模式（当前）

- 窗口：顶部悬浮，300x38px 收起 / 480x400px 展开
- 交互：hover展开，点击outside/ESC收起
- 按钮：使用emoji图标，紧凑样式
- 适用场景：轻度监控，不占用桌面空间

### 5.2 桌面模式（新增）

- 窗口：普通桌面窗口，类似微信
- 尺寸：可调整，默认 480x600px
- 交互：常驻显示，无需hover
- 按钮：SVG图标 + 文字，清晰样式
- 标题栏：图标 + 名称 + 状态统计 + 布局切换按钮
- 适用场景：深度工作，需要持续查看

### 5.3 切换入口

- 标题栏/设置中的"布局切换"按钮
- 切换后记住用户偏好（持久化）

---

## 6. 后端数据需求

### 6.1 新增字段

ClaudeInstance 需要增加：
- `recent_activities: ToolActivity[]` - 最近10条工具活动

ToolActivity 结构：
```typescript
interface ToolActivity {
  tool_name: string;      // 工具名：Bash, Read, Edit, etc.
  content: string;        // 执行内容：命令/文件路径/问题
  timestamp: number;      // 执行时间（Unix秒）
  result?: string;        // 结果摘要
  status: 'success' | 'error' | 'running'; // 执行状态
}
```

### 6.2 数据收集

- PreToolUse hook：记录工具开始执行
- PostToolUse hook：记录执行结果
- 维护每个session的活动队列（最多保留10条）
- 提供 `get_recent_activities` IPC命令

---

## 7. 前端组件改造

### 7.1 InstanceList.tsx 改动

- 增加两行布局渲染
- 增加状态颜色映射
- 增加当前命令显示逻辑
- 增加历史标签 + 展开按钮
- 增加操作按钮（第二行末尾）

### 7.2 新增组件

| 组件 | 功能 |
|------|------|
| ArchiveTab | 顶部Tab切换（活动/归档） |
| ArchivedSessionRow | 归档session简洁显示 |
| SlideMenu | 右侧滑动菜单 |
| ActivityPopup | 展开详情弹窗 |
| LayoutModeToggle | 布局模式切换按钮 |

### 7.3 App.tsx 改动

- 增加布局模式状态（island/desktop）
- Desktop模式：完整窗口渲染
- 布局切换逻辑

### 7.4 状态管理

displayStore 新增：
- `layoutMode: 'island' | 'desktop'`
- `archivedInstances: ClaudeInstance[]`
- `showArchiveTab: boolean`

---

## 8. 实施任务拆分

1. **后端数据层**：增加ToolActivity收集和IPC命令
2. **InstanceList改造**：两行布局 + 状态颜色 + 当前命令
3. **历史活动展示**：标签 + 展开弹窗
4. **操作按钮**：查看会话 + 跳转终端
5. **滑动菜单**：删除 + 归档操作
6. **归档Tab**：Tab切换 + 归档列表 + 自动归档逻辑
7. **布局模式**：Desktop模式窗口 + 切换功能
8. **测试验证**：功能测试 + UI测试