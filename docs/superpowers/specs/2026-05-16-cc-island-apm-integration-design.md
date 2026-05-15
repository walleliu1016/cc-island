# CC-Island APM Integration Design

## Overview

将 CC-Island Desktop 作为本地 Agent，集成层级 Trace APM 功能，复用 Cloud Server 去掉独立 APM Server。

**核心定位**：
- Desktop = 本地 Agent（监控 JSONL + 配置 OTel）
- Cloud Server = 数据汇聚（OTLP 接收 + GreptimeDB 写入 + Query API）
- ApmView = 层级 Trace 可视化（独立窗口 800x600px）

---

## 1. Architecture

### 1.1 Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Local Environment                       │
│                                                                      │
│  ┌─────────────────┐                                                │
│  │ Claude Code     │ ──Hook realtime──→ Desktop HTTP Server (17527) │
│  │                 │ ──OTel──────────→ Cloud Server (17528/17529)   │
│  └─────────────────┘                                                │
│         │                                                            │
│         ▼ JSONL files                                                │
│  ~/.claude/projects/                                                 │
│         │                                                            │
│         ▼                                                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ cc-island Desktop                                              │  │
│  │                                                                │  │
│  │  • HTTP Server (Hook receiver)                                 │  │
│  │  • JSONL Watcher (parse messages)                              │  │
│  │  • Cloud Client (WebSocket: Hook + JSONL)                      │  │
│  │  • OTel Config UI (write Claude settings.json)                  │  │
│  │  • ApmView (independent window 800x600px)                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ WebSocket (Hook + JSONL)
                              │ HTTP POST (OTel from Claude)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Cloud Server (17528/17529)                   │
│                                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │
│  │ WS Handler  │ │ OTLP Handler│ │ Query API   │                   │
│  │ (Hook/JSONL)│ │ (NEW)       │ │ (NEW)       │                   │
│  └─────────────┘ └─────────────┘ └─────────────┘                   │
│         │              │              │                              │
│         └──────────────┴──────────────┘                              │
│                        │                                             │
│                        ▼ Async write                                  │
│              ┌─────────────────┐                                    │
│              │ GreptimeDB      │                                    │
│              │ hook_events     │                                    │
│              │ messages        │                                    │
│              │ traces          │                                    │
│              └─────────────────┘                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │ HTTP Query
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (ApmView)                           │
│                                                                      │
│  • Tab switch: Trace view / Insights view                           │
│  • Hierarchical Trace (tree render, default fold Level 2+)          │
│  • Insights (API Calls, Files Heatmap, Context, Agent Tree)         │
│  • Query: Cloud Server HTTP API → GreptimeDB                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Changes

| Module | Change |
|--------|--------|
| **Cloud Server** | Add OTLP Handler + GreptimeDB Writer + Query API |
| **Desktop** | Add OTel Config UI + ApmView independent window |
| **Frontend** | Rewrite ApmView (Tab layout + Hierarchical Trace) |
| **APM Server** | **Removed** (merge into Cloud Server) |

---

## 2. Three-Channel Data Flow

| Channel | Source | Content | Usage |
|---------|--------|---------|-------|
| **A - Hook** | Claude Code Hook | PreToolUse/PostToolUse/SubagentStart | Realtime status + hierarchy boundary |
| **B - JSONL** | Local file watcher | messages content + tool_input/result | Detail supplement |
| **C - OTel** | Claude Code OTel export | parent_span_id + performance metrics | Hierarchy priority |

**Data Priority**:
```
OTel Trace (priority) → Hook Events (fallback) → JSONL (supplement)
```

---

## 3. Cloud Server Changes

### 3.1 New Modules

| Module | Function |
|--------|----------|
| `OTLP Handler` | HTTP POST `/v1/otlp` receive Claude OTel export |
| `GreptimeDB Writer` | Async batch write to hook_events, messages, traces |
| `Query API` | HTTP GET `/api/apm/query` proxy GreptimeDB queries |

### 3.2 New Endpoints

| Endpoint | Function |
|----------|----------|
| `POST /v1/otlp` | Unified OTLP receiver (traces + metrics + logs) |
| `GET /api/apm/query` | Proxy GreptimeDB SQL query with tenant filter |

### 3.3 Database Tables

```sql
-- hook_events (Hook realtime events)
CREATE TABLE hook_events (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,  -- tenant isolation
    session_id STRING SKIPPING INDEX,
    event_type STRING INVERTED INDEX, -- PreToolUse/PostToolUse/SubagentStart/Stop
    tool_name STRING,
    tool_input STRING,                -- truncate 2048
    tool_result STRING,               -- truncate 4096
    tool_use_id STRING,
    agent_id STRING,                  -- Subagent ID
    parent_agent_id STRING,           -- Parent Agent ID (hierarchy)
    duration_ms BIGINT,
    success BOOLEAN
);

-- messages (JSONL parsed content)
CREATE TABLE messages (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,
    session_id STRING SKIPPING INDEX,
    message_type STRING,              -- user/assistant/thinking/tool_use/tool_result
    role STRING,
    content STRING,                   -- truncate 32768
    model STRING,
    input_tokens BIGINT,
    output_tokens BIGINT,
    cache_read_tokens BIGINT,
    cache_creation_tokens BIGINT,
    cost_usd DOUBLE
);

-- traces (OTel spans)
CREATE TABLE traces (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,
    session_id STRING SKIPPING INDEX,
    span_id STRING PRIMARY KEY,
    parent_span_id STRING,            -- hierarchy
    span_type STRING,                 -- agent/llm/tool/wait/exec
    name STRING,
    duration_ms BIGINT,
    attributes STRING                 -- JSON storage
);
```

### 3.4 Tenant Isolation

- All queries inject `tenant_id = X-User-ID` filter
- tenant_id source: WebSocket auth device_token association

---

## 4. Desktop Changes

### 4.1 New Modules

| Module | Function |
|--------|----------|
| **OTel Config UI** | Settings new "Observability" Tab |
| **Claude settings writer** | Write OTel env to `~/.claude/settings.json` |
| **ApmView independent window** | 800x600px, Tab switch (Trace / Insights) |

### 4.2 OTel Environment Variables

Write to Claude `settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://cloud-server:17529/v1/otlp"
  }
}
```

### 4.3 Settings UI Design

```
┌─────────────────────────────────────┐
│ Observability                       │
├─────────────────────────────────────┤
│                                     │
│ [✓] Enable OpenTelemetry            │
│                                     │
│ OTel Endpoint                       │
│ [http://cloud-server:17529/v1/otlp] │
│                                     │
│ Note:                               │
│ Claude Code will export telemetry   │
│ (traces, metrics, logs) to this URL │
│ Restart Claude Code to apply        │
│                                     │
│ [Apply to Claude Settings]          │
│                                     │
└─────────────────────────────────────┘
```

---

## 5. Frontend ApmView Changes

### 5.1 Overall Layout (800x600px)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Back                Session: cc-island                🔄 Refresh   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌─ Tab Bar ───────────────────────────────────────────────────────┐ │
│ │ [Trace View]  [Insights]                                         │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ Content Area ──────────────────────────────────────────────────┐ │
│ │                                                                  │ │
│ │  (Trace or Insights content, switch by Tab)                      │ │
│ │                                                                  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Trace View

**Layout**:
```
┌─ Trace View ──────────────────────────────────────────────────────┐
│                                                                    │
│ Time range: [1h] [6h] [24h] [All]                                  │
│                                                                    │
│ ┌─ Hierarchical Trace Tree ──────────────────────────────────────┐│
│ │                                                                ││
│ │ ┌─ Main Agent ───────────────────────────────────────────────  ││
│ │ │ [purple bar] LLM Request ──────────────────── 3.2s          ││
│ │ │   ├─ [green bar] Tool: Read ──────────────── 0.5s  (folded) ││
│ │ │   ├─ [green bar] Tool: Bash ──────────────── 1.2s  (folded) ││
│ │ │   └─ [blue bar] Thinking ────────────────── 0.8s            ││
│ │ │                                                             ││
│ │ │ ┌─ Subagent (Agent Tool) ────────────────────────────────── ││
│ │ │ │ [purple bar] LLM Request ──────────────────── 2.1s       ││
│ │ │ │   ├─ [green bar] Tool: Grep ──────────────── 0.3s (fold) ││
│ │ │ │   └─ [green bar] Tool: Write ──────────────── 0.4s (fold)││
│ │ │ └───────────────────────────────────────────────────────── ││
│ │ │                                                             ││
│ │ └─ [orange bar] Permission Wait ────────────────── 15s        ││
│ │                                                             ││
│ └────────────────────────────────────────────────────────────────││
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Interaction**:
- Default fold Level 2+ (Tool calls)
- Click node row → unfold children
- Hover node → show detail float (tool_input preview)
- Double click → fullscreen detail panel

### 5.3 Insights View

**Layout**:
```
┌─ Insights View ───────────────────────────────────────────────────┐
│                                                                    │
│ ┌─ API Calls ─────────────────────────────────────────────────────┐│
│ │ Model          Input  Output  Cache   Cost   Duration          ││
│ │ claude-sonnet  12k    8k      5k     $0.15  3.2s              ││
│ │ claude-sonnet  8k     5k      2k     $0.10  2.1s              ││
│ └─────────────────────────────────────────────────────────────────││
│                                                                    │
│ ┌─ Files Heatmap ────────────────────────────────────────────────┐│
│ │ File                  Reads       Writes                       ││
│ │ src/App.tsx           ████████ 12 ████ 4                      ││
│ │ src/lib.rs            ██████   8  ██   2                      ││
│ │ Cargo.toml            ████     4  █    1                      ││
│ └─────────────────────────────────────────────────────────────────││
│                                                                    │
│ ┌─ Context Window ───────────────────────────────────────────────┐│
│ │ system (15%)   ████████                                        ││
│ │ user (40%)     ████████████                                    ││
│ │ tools (30%)    ████████                                        ││
│ │ reasoning (15%)████████                                        ││
│ └─────────────────────────────────────────────────────────────────││
│                                                                    │
│ ┌─ Agent Tree ───────────────────────────────────────────────────┐│
│ │ ● Main Agent (8 tools)                                          ││
│ │   ├─ ● Subagent #1 (3 tools)                                    ││
│ │   └─ ● Subagent #2 (5 tools)                                    ││
│ └─────────────────────────────────────────────────────────────────││
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 5.4 Component Structure

```
src/components/ApmView/
├── index.tsx          # Main container + Tab switch
├── TraceTab.tsx       # Trace view Tab
├── InsightsTab.tsx    # Insights view Tab
├── TraceTree.tsx      # Hierarchical Trace tree render
├── TraceNode.tsx      # Single Trace node
├── ApiCalls.tsx       # API Calls table
├── FilesHeatmap.tsx   # File activity bar chart
├── ContextBreakdown.tsx # Context Window ratio bar
├── AgentTree.tsx      # Agent hierarchy tree
└── hooks/
    ├── useTraceData.ts  # Query traces data
    └── useInsights.ts   # Query insights data
```

---

## 6. Data Priority and Render Logic

### 6.1 Span Type Mapping

```typescript
const SPAN_TYPE_MAP = {
  'claude_code.interaction': 'agent',
  'claude_code.llm_request': 'llm',
  'claude_code.tool': 'tool',
  'claude_code.tool.blocked_on_user': 'wait',
  'claude_code.tool.execution': 'exec',
};

const TYPE_COLORS = {
  agent: '#8b5cf6',   // Purple
  llm: '#3b82f6',     // Blue
  tool: '#22c55e',    // Green
  wait: '#f97316',    // Orange
  exec: '#22c55e',    // Green (same as tool)
  error: '#ef4444',   // Red
};
```

### 6.2 Render Logic

```typescript
function buildTraceTree(sessionId: string): TraceNode[] {
  // 1. Priority: OTel traces
  const traces = await queryTraces(sessionId);
  if (traces.length > 0) {
    return buildFromOTelSpans(traces);
  }
  
  // 2. Fallback: Hook events
  const hooks = await queryHookEvents(sessionId);
  if (hooks.length > 0) {
    return buildFromHookEvents(hooks);
  }
  
  // 3. Lowest: JSONL messages
  const messages = await queryMessages(sessionId);
  return buildFromMessages(messages);
}

// OTel → Tree: parent_span_id direct hierarchy
function buildFromOTelSpans(spans: Span[]): TraceNode[] {
  const spanMap = new Map(spans.map(s => [s.span_id, s]));
  const roots: TraceNode[] = [];
  
  spans.forEach(span => {
    const node = spanToNode(span);
    if (span.parent_span_id) {
      const parent = spanMap.get(span.parent_span_id);
      parent?.children?.push(node);
    } else {
      roots.push(node);
    }
  });
  
  return roots;
}

// Hook → Tree: SubagentStart/Stop build agent_id hierarchy
function buildFromHookEvents(events: HookEvent[]): TraceNode[] {
  // agent_id → Subagent boundary
  // PreToolUse + PostToolUse → Tool duration
  // Need Hook pairs merge logic
}

// JSONL → Tree: uuid → parentUuid conversion (chain → tree)
function buildFromMessages(messages: Message[]): TraceNode[] {
  // Most complex, need chain to tree conversion
}
```

---

## 7. Implementation Priority

| Phase | Content | Time |
|-------|---------|------|
| **Phase 1** | Hierarchical Trace view (basic) + Hook data source | 2 weeks |
| **Phase 2** | SSE realtime push + Insights panel | 1 week |
| **Phase 3** | OTel Trace support (if data available) | 1 week |
| **Phase 4** | JSONL Watcher batch upload | 1 week |

---

## 8. Critical Files

| Operation | File Path |
|-----------|-----------|
| **Modify** | `cloud-server/src/ws/handler.rs` (add OTLP handler) |
| **Modify** | `cloud-server/src/db/mod.rs` (add GreptimeDB writer) |
| **Modify** | `cloud-server/src/http/router.rs` (add /api/apm/query) |
| **Modify** | `src-tauri/src/config.rs` (add OTel config) |
| **Modify** | `src/components/Settings.tsx` (add Observability tab) |
| **New** | `src/components/ApmView/TraceTab.tsx` |
| **New** | `src/components/ApmView/InsightsTab.tsx` |
| **New** | `src/components/ApmView/TraceTree.tsx` |
| **New** | `src/components/ApmView/TraceNode.tsx` |
| **New** | `src/components/ApmView/ApiCalls.tsx` |
| **New** | `src/components/ApmView/FilesHeatmap.tsx` |
| **New** | `src/components/ApmView/ContextBreakdown.tsx` |
| **New** | `src/components/ApmView/AgentTree.tsx` |
| **New** | `src/hooks/useTraceData.ts` |
| **New** | `src/hooks/useInsights.ts` |

---

## 9. Dependencies

**Cloud Server Cargo.toml**:
```toml
greptime = "0.7"  # GreptimeDB client
prost = "0.12"    # Protobuf for OTLP
```

**Frontend package.json**:
```json
"react-window": "^1.8"  # Virtual list for large Trace tree
```

---

## Appendix A: OTLP Protocol Reference

Claude Code OTel export format:
- Protocol: `http/protobuf`
- Endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT/v1/otlp`
- Data types: traces, metrics, logs (unified endpoint)

---

## Appendix B: Tenant Isolation Query Example

```sql
-- Query traces with tenant filter
SELECT * FROM traces 
WHERE tenant_id = '<tenant_id>' 
  AND session_id = '<session_id>'
ORDER BY ts ASC;

-- Query hook events with tenant filter
SELECT * FROM hook_events 
WHERE tenant_id = '<tenant_id>' 
  AND session_id = '<session_id>'
ORDER BY ts ASC;
```

---

*End of document.*