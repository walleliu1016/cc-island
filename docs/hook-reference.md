# Claude Code Hook 请求体与响应体参考

## 通用说明

### Hook 输入（stdin / HTTP body）

所有 Hook 都会收到 JSON 输入，包含以下通用字段：

```json
{
  "hook_event_name": "PreToolUse",  // 事件名称
  "session_id": "abc123",           // 会话 ID
  "tool_name": "Write",             // 工具名称（仅工具相关事件）
  "tool_input": {},                 // 工具输入参数（仅工具相关事件）
  "tool_response": {}               // 工具响应（仅 PostToolUse）
}
```

### Hook 输出（stdout / HTTP response）

```json
{
  "continue": true,                 // true=继续执行, false=阻止
  "decision": "allow|deny|block",   // 决策类型
  "reason": "说明原因",              // 决策原因
  "systemMessage": "给用户显示",     // UI 显示的消息
  "suppressOutput": false,          // 是否隐藏 hook 输出
  "hookSpecificOutput": {           // 事件特定输出
    "hookEventName": "PreToolUse",
    "additionalContext": "注入到模型上下文的文本",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "权限决策原因",
    "updatedInput": {}              // 修改后的工具输入（PreToolUse only）
  }
}
```

---

## 1. PreToolUse

**触发时机：** 工具执行前

### 请求体

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "session-abc123",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/Users/example/project/src/main.ts",
    "content": "// file content here"
  }
}
```

### 响应体 - 允许执行

```json
{
  "continue": true,
  "decision": "allow",
  "reason": "文件写入操作安全"
}
```

### 响应体 - 阻止执行

```json
{
  "continue": false,
  "decision": "block",
  "reason": "禁止写入系统目录",
  "systemMessage": "⚠️ 该操作已被安全策略阻止",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "目标路径不在允许范围内"
  }
}
```

### 响应体 - 修改输入后执行

```json
{
  "continue": true,
  "decision": "allow",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "updatedInput": {
      "file_path": "/Users/example/project/src/main.ts",
      "content": "// modified content"
    }
  }
}
```

### 响应体 - AskUserQuestion 拦截（注入上下文）

```json
{
  "continue": false,
  "decision": "block",
  "reason": "由外部服务处理用户问答",
  "systemMessage": "✅ 已通过外部 UI 收集用户选择",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "用户回答摘要:\n- 问题1: Python, TypeScript\n- 问题2: VS Code",
    "permissionDecision": "deny"
  }
}
```

---

## 2. PostToolUse

**触发时机：** 工具成功执行后

### 请求体

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "session-abc123",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/Users/example/project/src/main.ts",
    "content": "// file content"
  },
  "tool_response": {
    "success": true,
    "filePath": "/Users/example/project/src/main.ts"
  }
}
```

### 响应体 - 成功通知

```json
{
  "continue": true,
  "systemMessage": "📝 文件已写入",
  "suppressOutput": true
}
```

### 响应体 - 注入后续上下文

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "文件写入完成，建议运行 prettier 格式化"
  }
}
```

---

## 3. PostToolUseFailure

**触发时机：** 工具执行失败后

### 请求体

```json
{
  "hook_event_name": "PostToolUseFailure",
  "session_id": "session-abc123",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test"
  },
  "tool_response": {
    "success": false,
    "error": "Test failed: 2 failures",
    "exitCode": 1
  }
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "❌ 测试失败，需要修复",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": "测试输出:\n- test A: failed\n- test B: failed\n建议检查相关代码"
  }
}
```

---

## 4. PermissionRequest

**触发时机：** 权限请求时（用户未预授权的操作）

### 请求体

```json
{
  "hook_event_name": "PermissionRequest",
  "session_id": "session-abc123",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /important/data"
  }
}
```

### 响应体 - 允许

```json
{
  "continue": true,
  "decision": "allow",
  "reason": "操作已审核通过",
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "permissionDecision": "allow"
  }
}
```

### 响应体 - 拒绝

```json
{
  "continue": false,
  "decision": "deny",
  "reason": "危险操作被拒绝",
  "systemMessage": "⛔ 该操作被安全策略拒绝",
  "hookSpecSpecOutput": {
    "hookEventName": "PermissionRequest",
    "permissionDecision": "deny",
    "permissionDecisionReason": "rm -rf 不允许作用于重要目录"
  }
}
```

### 响应体 - 询问用户

```json
{
  "continue": true,
  "decision": "ask",
  "systemMessage": "⚠️ 需要用户确认此操作",
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "permissionDecision": "ask",
    "permissionDecisionReason": "此操作可能影响重要数据"
  }
}
```

---

## 5. UserPromptSubmit

**触发时机：** 用户提交消息时

### 请求体

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "session-abc123",
  "prompt": "帮我重构这个模块",
  "cwd": "/Users/example/project"
}
```

### 响应体 - 允许

```json
{
  "continue": true,
  "decision": "allow"
}
```

### 响应体 - 阻止

```json
{
  "continue": false,
  "decision": "block",
  "reason": "提示词包含敏感内容",
  "systemMessage": "⚠️ 消息被过滤"
}
```

### 响应体 - 注入上下文

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "用户当前在重构模块上下文中，已完成 3 个文件"
  }
}
```

---

## 6. SessionStart

**触发时机：** 会话开始时

### 请求体

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "session-abc123",
  "cwd": "/Users/example/project",
  "timestamp": "2026-04-06T10:00:00Z"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "🚀 会话已启动",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "项目: demo\n上次活动: 2小时前\n待处理任务: 3"
  }
}
```

---

## 7. SessionEnd

**触发时机：** 会话结束时

### 请求体

```json
{
  "hook_event_name": "SessionEnd",
  "session_id": "session-abc123",
  "cwd": "/Users/example/project",
  "duration_seconds": 3600,
  "timestamp": "2026-04-06T11:00:00Z"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "📊 会话统计已保存"
}
```

---

## 8. Stop

**触发时机：** Claude 响应结束时

### 请求体

```json
{
  "hook_event_name": "Stop",
  "session_id": "session-abc123",
  "stop_reason": "end_turn",
  "message_count": 5
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "✅ 响应完成"
}
```

### 响应体 - 触发后续动作

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "响应结束，建议检查最近的代码变更"
  }
}
```

---

## 9. Notification

**触发时机：** 系统通知时

### 请求体

```json
{
  "hook_event_name": "Notification",
  "session_id": "session-abc123",
  "notification_type": "tool_error",
  "message": "Bash command failed",
  "details": {
    "tool": "Bash",
    "error": "Command not found"
  }
}
```

### 响应体

```json
{
  "continue": true,
  "suppressOutput": true
}
```

---

## 10. PreCompact

**触发时机：** 压缩对话前

### 请求体

```json
{
  "hook_event_name": "PreCompact",
  "session_id": "session-abc123",
  "compact_type": "manual",
  "message_count": 100,
  "tokens_used": 50000
}
```

### 响应体 - 允许压缩

```json
{
  "continue": true,
  "decision": "allow"
}
```

### 响应体 - 阻止压缩

```json
{
  "continue": false,
  "decision": "block",
  "reason": "用户要求保留完整上下文",
  "systemMessage": "⚠️ 压缩被取消"
}
```

---

## 11. PostCompact

**触发时机：** 压缩对话后

### 请求体

```json
{
  "hook_event_name": "PostCompact",
  "session_id": "session-abc123",
  "compact_type": "auto",
  "summary": "压缩后的对话摘要内容...",
  "tokens_saved": 30000
}
```

### 响应体

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PostCompact",
    "additionalContext": "对话已压缩，关键信息已保留"
  }
}
```

---

## 12. SubagentStart

**触发时机：** 子代理启动时

### 请求体

```json
{
  "hook_event_name": "SubagentStart",
  "session_id": "session-abc123",
  "subagent_id": "subagent-xyz",
  "subagent_type": "Explore",
  "prompt": "搜索代码库中的 API 端点"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "🔍 子代理已启动: Explore"
}
```

---

## 13. SubagentStop

**触发时机：** 子代理结束时

### 请求体

```json
{
  "hook_event_name": "SubagentStop",
  "session_id": "session-abc123",
  "subagent_id": "subagent-xyz",
  "subagent_type": "Explore",
  "result_summary": "找到 15 个 API 端点",
  "duration_ms": 5000
}
```

### 响应体

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "SubagentStop",
    "additionalContext": "子代理 Explore 完成: 找到 15 个 API 端点"
  }
}
```

---

## 14. TaskCreated

**触发时机：** 任务创建时

### 请求体

```json
{
  "hook_event_name": "TaskCreated",
  "session_id": "session-abc123",
  "task_id": "task-1",
  "subject": "运行测试",
  "description": "执行单元测试并验证结果",
  "status": "pending"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "📋 任务已创建: 运行测试"
}
```

---

## 15. TaskCompleted

**触发时机：** 任务完成时

### 请求体

```json
{
  "hook_event_name": "TaskCompleted",
  "session_id": "session-abc123",
  "task_id": "task-1",
  "subject": "运行测试",
  "status": "completed",
  "duration_ms": 30000
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "✅ 任务完成: 运行测试"
}
```

---

## 16. Elicitation

**触发时机：** 请求用户输入时

### 请求体

```json
{
  "hook_event_name": "Elicitation",
  "session_id": "session-abc123",
  "elicitation_type": "AskUserQuestion",
  "questions": [
    {
      "question": "你希望使用哪个框架?",
      "header": "框架",
      "multiSelect": false,
      "options": [
        {"label": "React", "description": "前端框架"},
        {"label": "Vue", "description": "前端框架"}
      ]
    }
  ]
}
```

### 响应体 - 拦截并处理

```json
{
  "continue": false,
  "decision": "block",
  "reason": "外部服务处理用户输入",
  "systemMessage": "✅ 问题已发送到外部 UI",
  "hookSpecificOutput": {
    "hookEventName": "Elicitation",
    "additionalContext": "用户选择: React"
  }
}
```

---

## 17. ElicitationResult

**触发时机：** 用户输入结果返回时

### 请求体

```json
{
  "hook_event_name": "ElicitationResult",
  "session_id": "session-abc123",
  "elicitation_id": "elicit-1",
  "result": {
    "answers": {
      "框架": "React"
    }
  }
}
```

### 响应体

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "ElicitationResult",
    "additionalContext": "用户确认选择 React 框架，开始配置"
  }
}
```

---

## 18. ConfigChange

**触发时机：** 配置变更时

### 请求体

```json
{
  "hook_event_name": "ConfigChange",
  "session_id": "session-abc123",
  "config_file": "~/.claude/settings.json",
  "change_type": "modified",
  "changes": {
    "model": "sonnet"
  }
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "⚙️ 配置已更新"
}
```

---

## 19. WorktreeCreate

**触发时机：** 创建 worktree 时

### 请求体

```json
{
  "hook_event_name": "WorktreeCreate",
  "session_id": "session-abc123",
  "worktree_name": "feature-x",
  "worktree_path": "/Users/example/project/.claude/worktrees/feature-x",
  "branch": "feature-x"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "🌳 Worktree 已创建: feature-x"
}
```

---

## 20. WorktreeRemove

**触发时机：** 移除 worktree 时

### 请求体

```json
{
  "hook_event_name": "WorktreeRemove",
  "session_id": "session-abc123",
  "worktree_name": "feature-x",
  "worktree_path": "/Users/example/project/.claude/worktrees/feature-x"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "🗑️ Worktree 已移除"
}
```

---

## 21. InstructionsLoaded

**触发时机：** 指令加载完成时

### 请求体

```json
{
  "hook_event_name": "InstructionsLoaded",
  "session_id": "session-abc123",
  "instructions_sources": [
    "CLAUDE.md",
    "GEMINI.md",
    "settings.json"
  ]
}
```

### 响应体

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "InstructionsLoaded",
    "additionalContext": "已加载项目指令: CLAUDE.md, GEMINI.md"
  }
}
```

---

## 22. CwdChanged

**触发时机：** 工作目录变更时

### 请求体

```json
{
  "hook_event_name": "CwdChanged",
  "session_id": "session-abc123",
  "old_cwd": "/Users/example/old-project",
  "new_cwd": "/Users/example/new-project"
}
```

### 响应体

```json
{
  "continue": true,
  "systemMessage": "📁 工作目录已切换",
  "hookSpecificOutput": {
    "hookEventName": "CwdChanged",
    "additionalContext": "新项目: new-project，需要重新加载上下文"
  }
}
```

---

## 23. FileChanged

**触发时机：** 文件变更时（外部编辑器修改）

### 请求体

```json
{
  "hook_event_name": "FileChanged",
  "session_id": "session-abc123",
  "file_path": "/Users/example/project/src/main.ts",
  "change_type": "modified"
}
```

### 响应体

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "FileChanged",
    "additionalContext": "文件 src/main.ts 已被外部修改"
  }
}
```

---

## 常见 matcher 模式

| Matcher | 匹配的工具 |
|---------|-----------|
| `Bash` | Bash 命令执行 |
| `Write` | 文件写入 |
| `Edit` | 文件编辑 |
| `Read` | 文件读取 |
| `Glob` | 文件模式搜索 |
| `Grep` | 内容搜索 |
| `AskUserQuestion` | 用户问答 |
| `WebFetch` | 网络请求 |
| `WebSearch` | 网络搜索 |
| `Skill` | 技能调用 |
| `Agent` | 代理启动 |
| `Write\|Edit` | 写入或编辑（多个工具） |
| `*` | 所有工具 |

---

## 响应决策类型说明

| Decision | 含义 | 适用场景 |
|----------|------|----------|
| `allow` | 允许执行 | 安全操作 |
| `deny` | 拒绝执行（工具不执行） | 不安全操作 |
| `block` | 阻止执行（会话停止） | 严重违规 |
| `ask` | 询问用户 | 需要人工决策 |

---

## HTTP Hook 特殊字段

```json
{
  "url": "http://localhost:17527/hook",
  "timeout": 30,
  "headers": {
    "Authorization": "Bearer $MY_TOKEN"
  },
  "allowedEnvVars": ["MY_TOKEN"]
}
```

- `headers` 中可使用 `$VAR_NAME` 或 `${VAR_NAME}` 引用环境变量
- `allowedEnvVars` 必须声明才能解析环境变量