# CC-Island Hooks 配置文档

本文档说明如何配置 Claude Code 的 HTTP Hooks 以与 CC-Island 集成。

## 快速配置

### 1. 安装 SessionStart 脚本

```bash
# 复制脚本到 Claude 配置目录
mkdir -p ~/.claude
cp hooks/cc-island-session-start.sh ~/.claude/
chmod +x ~/.claude/cc-island-session-start.sh
```

### 2. 配置 Hooks

```bash
# 方法一：直接复制（推荐）
cp hooks/hooks.json ~/.claude/settings.json

# 方法二：手动添加
# 编辑 ~/.claude/settings.json，将 hooks 字段添加进去
```

---

## Hook 类型说明

### 阻塞型事件

需要用户在 CC-Island UI 中响应，请求会等待直到用户操作或超时。

| 事件 | 超时 | 说明 |
|------|------|------|
| PermissionRequest | 300s | 权限请求，用户 Allow/Deny |
| Notification (type: ask) | 120s | 提问，用户回答 |
| Elicitation | 120s | MCP 服务器请求用户输入 |

### 非阻塞型事件

仅用于状态更新，立即返回，不需要用户响应。

| 事件 | 超时 | 说明 |
|------|------|------|
| SessionStart | 5s | 会话启动 |
| SessionEnd | 5s | 会话结束 |
| Stop | 5s | 响应完成，转为 idle |
| PreToolUse | 5s | 工具执行前 |
| PostToolUse | 5s | 工具执行后 |
| PostToolUseFailure | 5s | 工具执行失败 |
| PreCompact | 5s | 对话压缩前 |
| PostCompact | 5s | 对话压缩后 |
| UserPromptSubmit | 5s | 用户提交输入 |
| SubagentStart | 5s | 子代理启动 |
| SubagentStop | 5s | 子代理停止 |

---

## 完整配置

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

## 数据格式

### 请求格式 (Hook Input)

```typescript
interface HookInput {
  // 通用字段
  session_id: string;
  hook_event_name: string;
  cwd?: string;

  // 工具相关
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_response?: Record<string, any>;

  // PermissionRequest
  permission_data?: {
    tool_name: string;
    action: string;
    details?: string;
  };

  // Notification
  notification_data?: {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error' | 'ask';
    options?: string[];
  };

  // Elicitation
  questions?: Array<{
    question: string;
    header: string;
    multiSelect: boolean;
    options: Array<{ label: string; description?: string }>;
  }>;
}
```

### 响应格式 (Hook Output)

所有输出字段使用 camelCase：

```typescript
interface HookOutput {
  continue: boolean;  // 是否继续执行
  decision?: 'allow' | 'deny' | 'block';
  reason?: string;
  systemMessage?: string;
  suppressOutput?: boolean;

  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    updatedInput?: any;

    // PermissionRequest 专用
    decision?: {
      behavior: 'allow' | 'deny';
      updatedInput?: any;
      message?: string;
      interrupt?: boolean;
    };

    // Elicitation 专用
    action?: 'accept' | 'decline' | 'cancel';
    content?: any;
  };
}
```

### PermissionRequest 响应示例

**Allow:**
```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

**Deny:**
```json
{
  "continue": false,
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "权限被拒绝"
    }
  }
}
```

### AskUserQuestion 响应示例

AskUserQuestion 作为 PermissionRequest 发送，`tool_name` 为 `"AskUserQuestion"`：

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": {
        "questions": [...],
        "answers": {
          "选择前端框架?": "React"
        }
      }
    }
  }
}
```

---

## 事件处理流程

### SessionStart

```
收到 SessionStart (command 类型)
    │
    ├─ 从 cwd 提取项目名
    ├─ 查找 Claude 进程信息（用于 Jump）
    └─ 创建实例记录
```

### PermissionRequest

```
收到 PermissionRequest
    │
    ├─ 创建 Permission 弹窗
    ├─ 显示工具名、描述、命令/路径
    │
    ├─ 等待用户响应（最长 300s）
    │   │
    │   ├─ Allow → 返回 {behavior: "allow"}
    │   ├─ Deny → 返回 {behavior: "deny", message: "..."}
    │   └─ 超时 → 返回 {behavior: "deny"}
    │
    └─ Claude Code 继续执行
```

### AskUserQuestion

```
收到 PermissionRequest (tool_name: "AskUserQuestion")
    │
    ├─ 从 tool_input.questions 解析问题
    ├─ 创建 Ask 弹窗（支持多问题分页）
    │
    ├─ 等待用户回答
    │   │
    │   ├─ 用户选择/输入
    │   └─ 返回 {behavior: "allow", updatedInput: {questions, answers}}
    │
    └─ Claude Code 获取答案
```

### Elicitation

```
收到 Elicitation (MCP 服务器请求)
    │
    ├─ 从 questions 解析问题
    ├─ 创建 Ask 弹窗
    │
    ├─ 等待用户回答
    │   │
    │   └─ 返回 {additionalContext: "用户选择:\n- ..."}
    │
    └─ MCP 服务器获取答案
```

---

## 端口配置

默认端口：**17527**

如需修改，需要同时更新：
1. `src-tauri/src/http_server.rs` 中的 `port` 配置
2. `hooks/hooks.json` 中的所有 URL

---

## 测试

### 使用 curl 测试

```bash
# 测试 SessionStart
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{
    "hook_event_name": "SessionStart",
    "session_id": "test-123",
    "cwd": "/Users/you/project/demo"
  }'

# 测试 PermissionRequest
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{
    "hook_event_name": "PermissionRequest",
    "session_id": "test-123",
    "tool_name": "Bash",
    "tool_input": {
      "description": "删除测试目录",
      "command": "rm -rf /tmp/test"
    },
    "cwd": "/Users/you/project/demo"
  }'

# 测试 AskUserQuestion
curl -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d '{
    "hook_event_name": "PermissionRequest",
    "session_id": "test-123",
    "tool_name": "AskUserQuestion",
    "tool_input": {
      "questions": [{
        "header": "框架",
        "question": "选择前端框架?",
        "multiSelect": false,
        "options": [
          {"label": "React", "description": "Facebook出品"},
          {"label": "Vue", "description": "渐进式框架"}
        ]
      }]
    },
    "cwd": "/Users/you/project/demo"
  }'

# 查看实例列表
curl http://localhost:17527/instances | jq

# 查看弹窗列表
curl http://localhost:17527/popups | jq
```

### 调试日志

```bash
# Hook 输入日志
tail -f /tmp/cc-island.log

# Hook 响应日志
tail -f /tmp/cc-island-response.log

# 最新响应内容
cat /tmp/cc-response.json
```

---

## 故障排除

### Hook 无响应

1. 确认 CC-Island 正在运行
2. 检查端口：`lsof -i :17527`
3. 检查 SessionStart 脚本：`ls -la ~/.claude/cc-island-session-start.sh`
4. 查看日志文件

### 权限请求不显示

1. 检查 Claude Code settings.json 中 PermissionRequest hook 配置
2. 确认 timeout 设置为 300（不是 5）
3. 查看 `/tmp/cc-island.log` 是否收到请求

### 响应格式错误

1. 查看 `/tmp/cc-response.json` 确认输出格式
2. 所有字段名应为 camelCase（如 `hookSpecificOutput`）
3. PermissionRequest 使用 `decision: {behavior: ...}` 格式

### 项目名显示 unknown

确保请求包含 `cwd` 字段，CC-Island 从中提取项目名。