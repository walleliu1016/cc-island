# LLM Agent APM 公有云服务设计规范

## 设计概述

构建面向Claude Code和OpenClaw的公有云APM服务，继承tma1三通道数据逻辑，新增层级Trace可视化功能。

**支持范围**：Claude Code + OpenClaw（移除Codex/Copilot CLI）

**核心特性**：
- 层级Trace视图：展示Agent嵌套、Tool调用、LLM API调用的完整链路
- 三通道数据架构：OTel（性能层级）+ Hook（实时事件）+ JSONL（内容详情）
- 多租户支持：API Key认证 + tenant_id隔离
- 本地Rust Agent：监控JSONL文件并批量上传

---

## 1. 系统架构

### 1.1 整体架构

```
用户本地环境                      云端服务
┌─────────────────────┐         ┌─────────────────────┐
│ Claude Code         │         │ API Gateway         │
│ OpenClaw            │         │ • API Key认证       │
└─────────────────────┘         │ • tenant_id注入     │
        │                       └─────────────────────┘
        ▼                               │
┌─────────────────────┐         ┌───────┴───────────────┐
│ Hook实时通道         │         │                       │
│ POST → Cloud API    │         │  Hook Handler         │
│ SessionStart        │         │  Batch Handler        │
│ PreToolUse          │         │  SSE Server           │
│ PostToolUse         │         │                       │
│ SubagentStart/Stop  │         └───────┬───────────────┘
└─────────────────────┘                 │
                                        ▼
┌─────────────────────┐         ┌─────────────────────┐
│ Rust Agent批量通道  │         │ GreptimeDB          │
│ 监控JSONL文件       │         │ • hook_events       │
│ 解析 → 批量上传     │         │ • messages          │
└─────────────────────┘         │ • tenants           │
                                │ • api_keys          │
                                │ 按tenant_id分区     │
                                └─────────────────────┘
```

### 1.2 三通道数据流

**通道A - Hook实时通道**：
- Agent执行触发Hook事件
- POST到云端API写入hook_events
- SSE实时推送前端更新

**通道B - Rust Agent批量通道**：
- 监控本地JSONL文件
- 解析提取messages内容
- 批量POST到云端写入messages表

**通道C - OTel Trace数据**：
- Claude Code发送OTel traces到云端
- 提供parent_span_id层级结构
- 包含性能指标（duration、ttft、tokens）

---

## 2. 数据优先级策略（继承tma1）

### 2.1 层级显示数据源

**优先级顺序**：

```
OTel Trace（优先） → Hook Events（Fallback） → JSONL（补充）
```

| 数据通道 | 层级来源 | 提供内容 | 使用场景 |
|---------|---------|---------|---------|
| **OTel** | `parent_span_id`（原生树） | 层级 + 性能指标 | 有Trace数据时优先 |
| **Hook** | `agent_id`（SubagentStart/Stop） | 实时状态 + Subagent边界 | 无OTel时fallback |
| **JSONL** | `uuid→parentUuid`（需转换） | tool_input/result详情 | 点击展开详情面板 |

### 2.2 Span类型映射（继承tma1）

```javascript
const SPAN_TYPE_MAP = {
  'claude_code.interaction': 'agent',
  'claude_code.llm_request': 'llm',
  'claude_code.tool': 'tool',
  'claude_code.tool.blocked_on_user': 'wait',
  'claude_code.tool.execution': 'exec',
};
```

### 2.3 渲染逻辑（继承tma1 sess_renderWaterfall）

```javascript
function renderTraceTree(sessionData) {
  // 1. 优先OTel
  const traceResult = buildCCTraceSpans(sessionData.ccTraceSpans);
  if (traceResult) return renderFromOTelSpans(traceResult.spans);

  // 2. Fallback Hook
  if (sessionData.hookEvents && sessionData.hookEvents.length > 0) {
    return renderFromHookEvents(sessionData.hookEvents);
  }

  // 3. JSONL仅用于内容补充
}
```

---

## 3. Claude Code数据结构评估

### 3.1 JSONL链式结构

**特点**：链式结构（uuid → parentUuid），无原生树结构

**层级推断**：
- `sourceToolAssistantUUID` 识别Subagent归属
- Agent工具调用通过name==="Agent"判断
- Hook事件SubagentStart/Stop提供agent_id

**符合程度**：✅ 可用，需要链→树转换算法

### 3.2 OTel Trace结构

**特点**：原生树结构（parent_span_id）

**优势**：
- 自然层级关系
- 完整性能指标
- 业界APM标准兼容

**符合程度**：✅ 完美匹配层级显示需求

---

## 4. OpenClaw数据结构评估

### 4.1 JSONL树状结构

**特点**：原生树结构（parentId字段）

**结构**：
```go
type openclawEntry struct {
    Type      string          `json:"type"`
    ID        string          `json:"id"`
    ParentID  *string         `json:"parentId"`  // 原生树！
    Timestamp string          `json:"timestamp"`
    Message   json.RawMessage `json:"message,omitempty"`
}
```

**Entry类型**：
- session（根节点）
- message（对话内容）
- compaction（压缩）
- model_change（模型切换）

**符合程度**：✅ 完全符合，直接树渲染

### 4.2 Hook事件合成

OpenClaw工具调用已合成为Hook事件：
- PreToolUse（工具开始）
- PostToolUse（工具结束）
- 包含完整usage数据（input/output/cacheRead/cacheWrite + cost）

---

## 5. 数据表设计

### 5.1 hook_events表（实时事件）

```sql
CREATE TABLE hook_events (
    ts TIMESTAMP,
    tenant_id STRING,        -- 分区键
    session_id STRING,
    event_type STRING,       -- SessionStart/PreToolUse/PostToolUse/SubagentStart/SubagentStop
    agent_source STRING,     -- claude_code/openclaw
    tool_name STRING,
    tool_input STRING,       -- 截断2048
    tool_result STRING,      -- 截断4096
    tool_use_id STRING,
    agent_id STRING,
    agent_type STRING,
    cwd STRING,
    transcript_path STRING
) PARTITION ON COLUMN (tenant_id);
```

### 5.2 messages表（对话内容）

```sql
CREATE TABLE messages (
    ts TIMESTAMP,
    tenant_id STRING,        -- 分区键
    session_id STRING,
    message_type STRING,     -- user/assistant/thinking/tool_use/tool_result
    role STRING,
    content STRING,          -- 截断32768
    model STRING,
    tool_name STRING,
    tool_use_id STRING,
    input_tokens INT,
    output_tokens INT,
    cache_read_tokens INT,
    cache_creation_tokens INT
) PARTITION ON COLUMN (tenant_id);
```

### 5.3 tenants表（租户信息）

```sql
CREATE TABLE tenants (
    tenant_id STRING,
    name STRING,
    email STRING,
    created_at TIMESTAMP,
    plan STRING              -- free/pro/enterprise
);
```

### 5.4 api_keys表（密钥管理）

```sql
CREATE TABLE api_keys (
    key_id STRING,
    tenant_id STRING,
    key_hash STRING,         -- SHA256（不存原始key）
    name STRING,
    created_at TIMESTAMP,
    last_used_at TIMESTAMP,
    is_active BOOLEAN
);
```

---

## 6. 租户认证系统

### 6.1 API Key格式

格式：`apm_<32字符随机字符串>`（类似Stripe）

### 6.2 认证流程

1. 请求携带Header: `X-API-Key: apm_xxx`
2. SHA256哈希查询api_keys表
3. 验证：key_hash匹配 + is_active=true + 未过期
4. tenant_id注入请求上下文

### 6.3 租户隔离

所有查询必须带tenant_id过滤：
```sql
SELECT * FROM hook_events 
WHERE tenant_id = '<tenant_id>' AND session_id = '<session_id>';
```

---

## 7. Rust Agent设计

### 7.1 Agent架构

```
File Watcher → Parser Layer → Batch Uploader
    │              │               │
    │              │               │
监控JSONL文件    解析提取        POST到云端
    │              │               │
~/.claude/      Claude Code     /api/batch
~/.openclaw/    OpenClaw        增量上传
```

### 7.2 Claude Code Parser

**特点**：Hook实时通道已覆盖事件，Agent只解析messages

**解析内容**：
- user/assistant/thinking消息
- tool_use/tool_result详情
- token统计（input/output/cache）

### 7.3 OpenClaw Parser

**特点**：树状结构，完整usage数据

**解析内容**：
- session/message/compaction entry
- parentId层级关系
- 工具调用合成Hook事件

---

## 8. 层级Trace前端设计

### 8.1 新增功能（tma1原有waterfall是扁平列表）

**新增**：
- 树形渲染（父子节点缩进）
- 展开/折叠交互
- 垂直连接线（视觉层级）
- 子节点数量显示

**继承tma1**：
- 数据优先级逻辑（OTel → Hook → JSONL）
- Span类型映射（agent/llm/tool/wait/exec）
- Badge、Bar渲染逻辑

### 8.2 层级结构

```
Level 0: Main Agent（Session层）
Level 1: LLM Calls、Tool调用、Permission Wait
Level 2: Subagent及其内部操作
Level 3: Subagent内部的Tool调用（嵌套）
```

### 8.3 视觉设计

**颜色编码**：
| 类型 | 颖色 | 说明 |
|------|------|------|
| Agent | 紫色 | Main/Sub Agent |
| LLM | 蓝色 | LLM API调用 |
| Tool | 绿色 | 工具执行 |
| Wait | 橙色 | Permission等待 |
| Error | 红色 | 失败/拒绝 |

**最小块标识**：短时间操作用最小块，hover显示详情浮层

---

## 9. Insights面板设计

### 9.1 API Calls Section

- 显示每次LLM调用：model、tokens、cache、cost、duration
- 点击跳转到对应Trace位置

### 9.2 Files Heatmap

- 文件读写频率排行
- 条形图：reads vs writes比例

### 9.3 Context Window Breakdown

- 比例条：system/user/tools/reasoning/subagent占比

### 9.4 Agent Tree

- Main Agent + Subagent层级树
- 显示每个Agent的tool调用数量

---

## 10. SSE实时推送

### 10.1 SSE Endpoint

```
GET /api/sse?session_id=<session_id>
Header: X-API-Key: apm_xxx
```

### 10.2 推送事件

- PreToolUse：添加pending状态trace行
- PostToolUse：补充result，变为完成态
- SubagentStart：添加子Agent节点

### 10.3 前端处理

```javascript
const es = new EventSource(`/api/sse?session_id=${sessionId}`);
es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.event_type === 'PreToolUse') addPendingTool(data);
  if (data.event_type === 'PostToolUse') completeTool(data);
  if (data.event_type === 'SubagentStart') addSubagentNode(data);
};
```

---

## 11. API接口设计

### 11.1 Hook接收

```
POST /api/hooks
Header: X-API-Key: apm_xxx
Body: {
  "hook_event_name": "PreToolUse",
  "session_id": "sess_xxx",
  "tool_name": "Read",
  "tool_input": "...",
  "tool_use_id": "tool_xxx"
}
```

### 11.2 批量上传

```
POST /api/batch
Header: X-API-Key: apm_xxx
Body: {
  "agent_source": "claude_code",
  "session_id": "sess_xxx",
  "messages": [...]
}
```

### 11.3 Sessions查询

```
GET /api/sessions?agent=claude_code&time=last24h&page=1
Response: {
  "sessions": [...],
  "total": 1234
}
```

---

## 12. 实现阶段

### Phase 1: MVP（4周）
1. API Key认证 + tenant_id隔离
2. Hook接收接口 + GreptimeDB写入
3. 层级Trace视图前端（继承tma1数据逻辑）
4. SSE实时推送
5. Rust Agent基础框架

### Phase 2: 完整功能（+4周）
1. Insights面板完整实现
2. Dashboard统计
3. Sessions列表筛选搜索
4. Rust Agent Claude Code Parser完整实现

### Phase 3: OpenClaw支持（+2周）
1. OpenClaw JSONL Parser
2. OpenClaw Hook事件合成
3. 多Agent支持完善

---

## 附录

### A. 数据关联关系

```
hook_events.tool_use_id ←关联→ messages.tool_use_id

Timeline构建：
1. PreToolUse + PostToolUse 组成 tool_pairs
2. tool_use + tool_result 补充内容详情
3. 通过 tool_use_id 关联合并
```

### B. 参考文档

- tma1架构：`g:/work/tma1/AGENTS.md`
- tma1 waterfall实现：`g:/work/tma1/server/web/js/sessions-waterfall.js`
- Claude Code Hook：https://docs.anthropic.com/claude-code/hooks
- GreptimeDB：https://greptime.com/docs