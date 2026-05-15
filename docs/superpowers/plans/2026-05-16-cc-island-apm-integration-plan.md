# CC-Island APM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate hierarchical Trace APM into cc-island by extending Cloud Server with OTLP/GreptimeDB support and rewriting ApmView with Tab layout.

**Architecture:** Cloud Server adds OTLP Handler + GreptimeDB Writer + Query API. Desktop adds OTel Config UI. Frontend rewrites ApmView with Trace/Insights Tabs and hierarchical tree rendering.

**Tech Stack:** Rust (axum, reqwest), TypeScript (React, react-window), GreptimeDB HTTP API, OTLP protobuf

---

## File Structure

### Phase 1: Cloud Server Backend (Hooks → GreptimeDB)

**Create:**
- `cloud-server/src/greptime/mod.rs` - GreptimeDB module root
- `cloud-server/src/greptime/client.rs` - HTTP SQL API client
- `cloud-server/src/greptime/schema.rs` - Table DDL definitions
- `cloud-server/src/apm/mod.rs` - APM module root
- `cloud-server/src/apm/handler.rs` - Hook event → GreptimeDB writer
- `cloud-server/src/apm/query.rs` - Query API proxy

**Modify:**
- `cloud-server/src/http.rs` - Add `/api/apm/query` route
- `cloud-server/src/ws/handler.rs` - Trigger GreptimeDB write on Hook events
- `cloud-server/src/db/mod.rs` - Export greptime module
- `cloud-server/Cargo.toml` - Add reqwest dependency

### Phase 2: Desktop OTel Config UI

**Modify:**
- `src-tauri/src/config.rs` - Add `otel_enabled`, `otel_endpoint` fields
- `src-tauri/src/lib.rs` - Add `apply_otel_config` command
- `src/components/Settings.tsx` - Add "Observability" tab

### Phase 3: Frontend ApmView Rewrite

**Create:**
- `src/components/ApmView/TraceTab.tsx` - Trace view Tab container
- `src/components/ApmView/InsightsTab.tsx` - Insights view Tab container
- `src/components/ApmView/TraceTree.tsx` - Hierarchical tree render
- `src/components/ApmView/TraceNode.tsx` - Single node component
- `src/components/ApmView/ApiCalls.tsx` - API Calls table
- `src/components/ApmView/FilesHeatmap.tsx` - File activity chart
- `src/components/ApmView/ContextBreakdown.tsx` - Context ratio bar
- `src/components/ApmView/AgentTree.tsx` - Agent hierarchy tree
- `src/hooks/useTraceData.ts` - Query hooks/events data
- `src/hooks/useInsights.ts` - Query insights data

**Modify:**
- `src/components/ApmView/index.tsx` - Rewrite with Tab layout
- `src/services/apmApi.ts` - Add query methods for Cloud Server API

### Phase 4: OTLP Handler (Optional)

**Create:**
- `cloud-server/src/apm/otlp.rs` - OTLP protobuf parser

**Modify:**
- `cloud-server/src/http.rs` - Add `/v1/otlp` route

---

## Phase 1: Cloud Server Backend

### Task 1.1: Add GreptimeDB Dependencies

**Files:**
- Modify: `cloud-server/Cargo.toml`

- [ ] **Step 1: Add reqwest dependency**

```toml
# In cloud-server/Cargo.toml, add to existing dependencies:
reqwest = { version = "0.12", features = ["json"] }
```

- [ ] **Step 2: Verify dependency added**

Run: `cd cloud-server && cargo check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add cloud-server/Cargo.toml
git commit -m "feat(cloud): add reqwest for GreptimeDB HTTP API"
```

---

### Task 1.2: Create GreptimeDB Module Structure

**Files:**
- Create: `cloud-server/src/greptime/mod.rs`
- Create: `cloud-server/src/greptime/client.rs`
- Create: `cloud-server/src/greptime/schema.rs`
- Modify: `cloud-server/src/db/mod.rs`

- [ ] **Step 1: Create module root**

```rust
// cloud-server/src/greptime/mod.rs
pub mod client;
pub mod schema;

pub use client::GreptimeClient;
pub use schema::SCHEMA;
```

- [ ] **Step 2: Create client.rs with HTTP SQL API**

```rust
// cloud-server/src/greptime/client.rs
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEFAULT_HOST: &str = "localhost";
const DEFAULT_PORT: u16 = 4000;

#[derive(Debug, Clone)]
pub struct GreptimeClient {
    client: Client,
    host: String,
    port: u16,
    database: String,
}

impl GreptimeClient {
    pub fn new(host: Option<String>, port: Option<u16>, database: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap(),
            host: host.unwrap_or(DEFAULT_HOST.to_string()),
            port: port.unwrap_or(DEFAULT_PORT),
            database: database.unwrap_or("public".to_string()),
        }
    }

    /// Execute SQL query via HTTP API
    pub async fn query(&self, sql: &str) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let url = format!("http://{}:{}/v1/sql?db={}&sql={}",
            self.host, self.port, self.database, urlencoding::encode(sql));
        
        let resp = self.client.get(&url).send().await?;
        let result: QueryResult = resp.json().await?;
        Ok(result)
    }

    /// Insert rows into table
    pub async fn insert(&self, table: &str, rows: Vec<Vec<Value>>) -> Result<(), Box<dyn std::error::Error>> {
        // GreptimeDB uses SQL INSERT syntax via HTTP
        let sql = self.build_insert_sql(table, rows);
        self.query(&sql).await?;
        Ok(())
    }

    fn build_insert_sql(&self, table: &str, rows: Vec<Vec<Value>>) -> String {
        // Build INSERT statement from rows
        let values_str = rows.iter()
            .map(|row| {
                let vals = row.iter()
                    .map(|v| v.to_sql_literal())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("({})", vals)
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!("INSERT INTO {} VALUES {}", table, values_str)
    }
}

#[derive(Debug, Deserialize)]
pub struct QueryResult {
    output: Vec<OutputBlock>,
}

#[derive(Debug, Deserialize)]
pub struct OutputBlock {
    records: Records,
}

#[derive(Debug, Deserialize)]
pub struct Records {
    rows: Vec<Vec<Value>>,
    schema: Schema,
}

#[derive(Debug, Deserialize)]
pub struct Schema {
    column_schemas: Vec<ColumnSchema>,
}

#[derive(Debug, Deserialize)]
pub struct ColumnSchema {
    name: String,
    data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    String(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
}

impl Value {
    pub fn to_sql_literal(&self) -> String {
        match self {
            Value::String(s) => format!("'{}'", s.replace("'", "''")),
            Value::Int(i) => i.to_string(),
            Value::Float(f) => f.to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Null => "NULL".to_string(),
        }
    }
}
```

- [ ] **Step 3: Create schema.rs with table DDL**

```rust
// cloud-server/src/greptime/schema.rs
pub const SCHEMA: &str = r#"
-- hook_events table
CREATE TABLE IF NOT EXISTS hook_events (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,
    session_id STRING SKIPPING INDEX,
    event_type STRING INVERTED INDEX,
    tool_name STRING NULL,
    tool_input STRING NULL,
    tool_result STRING NULL,
    tool_use_id STRING NULL,
    agent_id STRING NULL,
    parent_agent_id STRING NULL,
    duration_ms BIGINT NULL,
    success BOOLEAN NULL
);

-- messages table
CREATE TABLE IF NOT EXISTS messages (
    ts TIMESTAMP TIME INDEX,
    tenant_id STRING SKIPPING INDEX,
    session_id STRING SKIPPING INDEX,
    message_type STRING,
    role STRING,
    content STRING NULL,
    model STRING NULL,
    input_tokens BIGINT NULL,
    output_tokens BIGINT NULL,
    cache_read_tokens BIGINT NULL,
    cache_creation_tokens BIGINT NULL,
    cost_usd DOUBLE NULL
);
"#;

pub async fn init_schema(client: &super::GreptimeClient) -> Result<(), Box<dyn std::error::Error>> {
    // Split by semicolon and execute each statement
    for stmt in SCHEMA.split(';').filter(|s| !s.trim().is_empty()) {
        client.query(stmt.trim()).await?;
    }
    Ok(())
}
```

- [ ] **Step 4: Export module in db/mod.rs**

```rust
// cloud-server/src/db/mod.rs (add line)
pub mod greptime;
```

- [ ] **Step 5: Verify compilation**

Run: `cd cloud-server && cargo check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add cloud-server/src/greptime/ cloud-server/src/db/mod.rs
git commit -m "feat(cloud): add GreptimeDB HTTP client and schema"
```

---

### Task 1.3: Create APM Handler for Hook Events

**Files:**
- Create: `cloud-server/src/apm/mod.rs`
- Create: `cloud-server/src/apm/handler.rs`
- Create: `cloud-server/src/apm/query.rs`
- Modify: `cloud-server/src/db/mod.rs`

- [ ] **Step 1: Create module root**

```rust
// cloud-server/src/apm/mod.rs
pub mod handler;
pub mod query;

pub use handler::ApmHandler;
pub use query::QueryApi;
```

- [ ] **Step 2: Create handler.rs for Hook → GreptimeDB**

```rust
// cloud-server/src/apm/handler.rs
use crate::greptime::{GreptimeClient, Value};
use crate::ws::handler::HookMessage;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

pub struct ApmHandler {
    client: Arc<RwLock<GreptimeClient>>,
}

impl ApmHandler {
    pub fn new(client: GreptimeClient) -> Self {
        Self {
            client: Arc::new(RwLock::new(client)),
        }
    }

    /// Write Hook event to hook_events table
    pub async fn write_hook_event(&self, msg: &HookMessage, tenant_id: &str) {
        let client = self.client.read().await;
        
        let ts = Utc::now().timestamp_millis();
        let event_type = msg.hook_event_name.clone();
        
        // Truncate tool_input/result to avoid large data
        let tool_input = msg.tool_input.as_ref()
            .and_then(|v| serde_json::to_string(v).ok())
            .map(|s| s.chars().take(2048).collect());
        let tool_result = msg.tool_result.as_ref()
            .and_then(|v| serde_json::to_string(v).ok())
            .map(|s| s.chars().take(4096).collect());

        let row = vec![
            Value::Int(ts),
            Value::String(tenant_id.to_string()),
            Value::String(msg.session_id.clone()),
            Value::String(event_type),
            Value::String(msg.tool_name.clone().unwrap_or_default()),
            Value::String(tool_input.unwrap_or_default()),
            Value::String(tool_result.unwrap_or_default()),
            Value::String(msg.tool_use_id.clone().unwrap_or_default()),
            Value::String(msg.agent_id.clone().unwrap_or_default()),
            Value::String(msg.parent_agent_id.clone().unwrap_or_default()),
            Value::Int(msg.duration_ms.unwrap_or(0)),
            Value::Bool(msg.success.unwrap_or(true)),
        ];

        if let Err(e) = client.insert("hook_events", vec![row]).await {
            tracing::warn!("Failed to write hook_event: {}", e);
        }
    }
}
```

- [ ] **Step 3: Create query.rs for Query API**

```rust
// cloud-server/src/apm/query.rs
use axum::{
    extract::Query,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::greptime::GreptimeClient;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct QueryParams {
    sql: String,
}

#[derive(Debug, Serialize)]
pub struct QueryResponse {
    rows: Vec<Vec<serde_json::Value>>,
    columns: Vec<String>,
}

pub struct QueryApi {
    client: Arc<GreptimeClient>,
}

impl QueryApi {
    pub fn new(client: GreptimeClient) -> Self {
        Self {
            client: Arc::new(client),
        }
    }

    /// Query with tenant filter injection
    pub async fn query(&self, params: QueryParams, tenant_id: &str) -> Json<QueryResponse> {
        let client = self.client.clone();
        
        // Inject tenant_id filter (safety: prepend WHERE clause)
        let sql = inject_tenant_filter(&params.sql, tenant_id);
        
        match client.query(&sql).await {
            Ok(result) => {
                let columns = result.output.first()
                    .map(|o| o.records.schema.column_schemas.iter()
                        .map(|c| c.name.clone())
                        .collect())
                    .unwrap_or_default();
                
                let rows = result.output.first()
                    .map(|o| o.records.rows.iter()
                        .map(|r| r.iter().map(|v| value_to_json(v)).collect())
                        .collect())
                    .unwrap_or_default();
                
                Json(QueryResponse { rows, columns })
            }
            Err(e) => {
                tracing::error!("Query failed: {}", e);
                Json(QueryResponse { rows: vec![], columns: vec![] })
            }
        }
    }
}

fn inject_tenant_filter(sql: &str, tenant_id: &str) -> String {
    // Simple injection: if WHERE exists, prepend tenant_id condition
    // For safety, should use proper SQL parser in production
    if sql.contains("WHERE") {
        sql.replace("WHERE", &format!("WHERE tenant_id = '{}' AND ", tenant_id))
    } else {
        format!("{} WHERE tenant_id = '{}'", sql, tenant_id)
    }
}

fn value_to_json(v: &crate::greptime::Value) -> serde_json::Value {
    match v {
        crate::greptime::Value::String(s) => serde_json::Value::String(s.clone()),
        crate::greptime::Value::Int(i) => serde_json::Value::Number(i.into()),
        crate::greptime::Value::Float(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        crate::greptime::Value::Bool(b) => serde_json::Value::Bool(*b),
        crate::greptime::Value::Null => serde_json::Value::Null,
    }
}
```

- [ ] **Step 4: Export module**

```rust
// cloud-server/src/db/mod.rs (add line)
pub mod apm;
```

- [ ] **Step 5: Verify compilation**

Run: `cd cloud-server && cargo check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add cloud-server/src/apm/ cloud-server/src/db/mod.rs
git commit -m "feat(cloud): add APM handler for Hook→GreptimeDB"
```

---

### Task 1.4: Add Query API Route

**Files:**
- Modify: `cloud-server/src/http.rs`
- Modify: `cloud-server/src/main.rs`

- [ ] **Step 1: Add route in http.rs**

```rust
// cloud-server/src/http.rs (add after existing routes)
use crate::apm::query::{QueryApi, QueryParams, QueryResponse};

/// Create HTTP router for API endpoints (modified)
pub fn create_http_router(
    repo: Repository,
    router: ConnectionRouter,
    query_api: QueryApi,
) -> Router {
    Router::new()
        .route("/api/devices", get(get_devices))
        .route("/api/sessions/:device_token", get(get_sessions))
        .route("/api/debug/sessions", get(get_all_sessions))
        .route("/api/apm/query", get(apm_query))  // NEW
        .with_state((repo, router, query_api))
}

/// APM query endpoint
async fn apm_query(
    axum::extract::State((_repo, _router, query_api)): 
        axum::extract::State<(Repository, ConnectionRouter, QueryApi)>,
    Query(params): Query<QueryParams>,
    headers: axum::http::HeaderMap,
) -> Json<QueryResponse> {
    // Get tenant_id from X-User-ID header (or use device_token)
    let tenant_id = headers.get("X-User-ID")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    
    query_api.query(params, tenant_id).await
}
```

- [ ] **Step 2: Initialize GreptimeDB client in main.rs**

```rust
// cloud-server/src/main.rs (add in main function, before router creation)
use crate::greptime::{GreptimeClient, init_schema};
use crate::apm::query::QueryApi;

// Initialize GreptimeDB client
let greptime_client = GreptimeClient::new(
    std::env::var("GREPTIMEDB_HOST").ok(),
    std::env::var("GREPTIMEDB_PORT").ok().and_then(|p| p.parse().ok()),
    std::env::var("GREPTIMEDB_DATABASE").ok(),
);

// Initialize schema (optional, GreptimeDB can auto-create)
if let Err(e) = init_schema(&greptime_client).await {
    tracing::warn!("Schema init failed (may already exist): {}", e);
}

let query_api = QueryApi::new(greptime_client.clone());

// Update router creation
let app = create_http_router(repo.clone(), connection_router.clone(), query_api);
```

- [ ] **Step 3: Verify compilation**

Run: `cd cloud-server && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/http.rs cloud-server/src/main.rs
git commit -m "feat(cloud): add /api/apm/query route"
```

---

### Task 1.5: Hook Handler Integration

**Files:**
- Modify: `cloud-server/src/ws/handler.rs`

- [ ] **Step 1: Add ApmHandler to handler state**

```rust
// cloud-server/src/ws/handler.rs (add import)
use crate::apm::handler::ApmHandler;

// Add to WsHandler struct
pub struct WsHandler {
    // existing fields...
    apm_handler: Option<ApmHandler>,
}

// Add constructor parameter
impl WsHandler {
    pub fn new(apm_handler: Option<ApmHandler>) -> Self {
        Self {
            // existing initialization...
            apm_handler,
        }
    }
}
```

- [ ] **Step 2: Call ApmHandler on Hook message**

```rust
// cloud-server/src/ws/handler.rs (in handle_message function, after processing HookMessage)
// Add async write (non-blocking)
if let Some(apm) = &self.apm_handler {
    let tenant_id = connection.device_token(); // or user_id
    let msg_clone = msg.clone();
    tokio::spawn(async move {
        apm.write_hook_event(&msg_clone, tenant_id).await;
    });
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd cloud-server && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/ws/handler.rs
git commit -m "feat(cloud): integrate ApmHandler with Hook events"
```

---

## Phase 2: Desktop OTel Config UI

### Task 2.1: Add OTel Config Fields

**Files:**
- Modify: `src-tauri/src/config.rs`

- [ ] **Step 1: Add OTel fields to AppSettings**

```rust
// src-tauri/src/config.rs (add to AppSettings struct)
pub struct AppSettings {
    // existing fields...
    
    // OTel config
    pub otel_enabled: bool,
    pub otel_endpoint: Option<String>,
}

// Update Default implementation
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            // existing defaults...
            otel_enabled: false,
            otel_endpoint: None,
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "feat(desktop): add OTel config fields"
```

---

### Task 2.2: Add apply_otel_config Command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Tauri command**

```rust
// src-tauri/src/lib.rs (add new command)
#[tauri::command]
async fn apply_otel_config(otel_enabled: bool, otel_endpoint: String) -> Result<(), String> {
    use std::fs;
    use std::path::PathBuf;
    
    // Get Claude settings path
    let claude_dir = dirs::home_dir()
        .map(|h| h.join(".claude"))
        .ok_or("Cannot find home directory")?;
    
    let settings_path = claude_dir.join("settings.json");
    
    // Read existing settings or create new
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    // Update env section
    if otel_enabled {
        settings["env"] = serde_json::json!({
            "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
            "OTEL_METRICS_EXPORTER": "otlp",
            "OTEL_LOGS_EXPORTER": "otlp",
            "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
            "OTEL_EXPORTER_OTLP_ENDPOINT": otel_endpoint,
        });
    } else {
        // Remove OTel env if disabled
        if let Some(env) = settings.get_mut("env") {
            if let Some(env_obj) = env.as_object_mut() {
                env_obj.remove("CLAUDE_CODE_ENABLE_TELEMETRY");
                env_obj.remove("OTEL_METRICS_EXPORTER");
                env_obj.remove("OTEL_LOGS_EXPORTER");
                env_obj.remove("OTEL_EXPORTER_OTLP_PROTOCOL");
                env_obj.remove("OTEL_EXPORTER_OTLP_ENDPOINT");
            }
        }
    }
    
    // Write back
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| e.to_string())?;
    fs::write(&settings_path, content)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}
```

- [ ] **Step 2: Register command in invoke_handler**

```rust
// src-tauri/src/lib.rs (in run function, update invoke_handler)
.invoke_handler(tauri::generate_handler![
    // existing commands...
    apply_otel_config,
])
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(desktop): add apply_otel_config command"
```

---

### Task 2.3: Add Observability Tab in Settings

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add types for OTel config**

```typescript
// src/types/index.ts (add to AppSettings interface)
export interface AppSettings {
  // existing fields...
  
  otel_enabled: boolean;
  otel_endpoint: string | null;
}
```

- [ ] **Step 2: Add Observability tab in Settings.tsx**

```typescript
// src/components/Settings.tsx (add new tab option)
const TABS = ['hooks', 'general', 'remote', 'apm', 'observability'] as const;

// Add Observability tab content (after APM tab)
{activeTab === 'observability' && (
  <ObservabilityTab
    settings={settings}
    onSettingsChange={handleSettingsChange}
  />
)}
```

- [ ] **Step 3: Create ObservabilityTab component (inline)**

```typescript
// src/components/Settings.tsx (add component)
function ObservabilityTab({ settings, onSettingsChange }: { 
  settings: AppSettings; 
  onSettingsChange: () => void;
}) {
  const [otelEnabled, setOtelEnabled] = useState(settings.otel_enabled);
  const [otelEndpoint, setOtelEndpoint] = useState(
    settings.otel_endpoint || 'http://localhost:17529/v1/otlp'
  );
  
  const handleApply = async () => {
    try {
      await invoke('apply_otel_config', {
        otelEnabled,
        otelEndpoint,
      });
      onSettingsChange();
    } catch (e) {
      console.error('Failed to apply OTel config:', e);
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={otelEnabled}
          onChange={(e) => setOtelEnabled(e.target.checked)}
          className="rounded"
        />
        <span className="text-sm">启用 OpenTelemetry</span>
      </div>
      
      <div>
        <label className="text-xs text-white/50 block mb-1">OTel Endpoint</label>
        <input
          type="text"
          value={otelEndpoint}
          onChange={(e) => setOtelEndpoint(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 rounded text-sm"
        />
      </div>
      
      <p className="text-xs text-white/40">
        Claude Code 将导出 telemetry 数据（traces, metrics, logs）到此地址。
        需要重启 Claude Code 生效。
      </p>
      
      <button
        onClick={handleApply}
        className="px-4 py-2 bg-white text-black text-sm rounded hover:bg-white/90"
      >
        应用到 Claude Settings
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings.tsx src/types/index.ts
git commit -m "feat(desktop): add Observability tab in Settings"
```

---

## Phase 3: Frontend ApmView Rewrite

### Task 3.1: Rewrite ApmView Index with Tab Layout

**Files:**
- Modify: `src/components/ApmView/index.tsx`

- [ ] **Step 1: Rewrite with Tab layout**

```typescript
// src/components/ApmView/index.tsx (complete rewrite)
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import TraceTab from './TraceTab';
import InsightsTab from './InsightsTab';

interface ApmViewProps {
  onClose?: () => void;
  sessionId: string;
}

type TabType = 'trace' | 'insights';

export default function ApmView({ onClose, sessionId }: ApmViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('trace');
  const [rangeHours, setRangeHours] = useState(24);

  return (
    <div className="flex flex-col h-full bg-black/90 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white/80 text-sm flex items-center gap-1"
        >
          ← 返回
        </button>
        <span className="text-white/70 text-sm font-medium">
          Session: {sessionId.slice(0, 8)}...
        </span>
        <select
          value={rangeHours}
          onChange={(e) => setRangeHours(Number(e.target.value))}
          className="bg-slate-800 text-white rounded px-2 py-1 text-xs"
        >
          <option value={1}>1h</option>
          <option value={6}>6h</option>
          <option value={24}>24h</option>
          <option value={168}>7d</option>
        </select>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-4 px-4 py-2 border-b border-white/10">
        <button
          onClick={() => setActiveTab('trace')}
          className={`text-sm px-3 py-1 rounded ${
            activeTab === 'trace'
              ? 'bg-white/20 text-white'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          Trace 视图
        </button>
        <button
          onClick={() => setActiveTab('insights')}
          className={`text-sm px-3 py-1 rounded ${
            activeTab === 'insights'
              ? 'bg-white/20 text-white'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          Insights
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'trace' && (
            <TraceTab sessionId={sessionId} rangeHours={rangeHours} />
          )}
          {activeTab === 'insights' && (
            <InsightsTab sessionId={sessionId} rangeHours={rangeHours} />
          )}
        </motion.div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `pnpm exec tsc --noEmit`
Expected: Errors for missing TraceTab/InsightsTab (expected)

- [ ] **Step 3: Commit**

```bash
git add src/components/ApmView/index.tsx
git commit -m "refactor(apm): rewrite ApmView with Tab layout"
```

---

### Task 3.2: Create TraceTab Component

**Files:**
- Create: `src/components/ApmView/TraceTab.tsx`
- Create: `src/hooks/useTraceData.ts`

- [ ] **Step 1: Create useTraceData hook**

```typescript
// src/hooks/useTraceData.ts
import { useState, useEffect } from 'react';

interface TraceNode {
  id: string;
  type: 'agent' | 'llm' | 'tool' | 'wait' | 'exec' | 'error';
  name: string;
  startTime: number;
  duration: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  children?: TraceNode[];
  details?: {
    tool_input?: string;
    tool_result?: string;
    model?: string;
    tokens?: { input: number; output: number };
    cost?: number;
  };
}

interface HookEvent {
  ts: number;
  event_type: string;
  tool_name: string;
  tool_use_id: string;
  agent_id: string;
  parent_agent_id: string;
  duration_ms: number;
  success: boolean;
}

const TYPE_COLORS: Record<TraceNode['type'], string> = {
  agent: '#8b5cf6',
  llm: '#3b82f6',
  tool: '#22c55e',
  wait: '#f97316',
  exec: '#22c55e',
  error: '#ef4444',
};

export function useTraceData(sessionId: string, rangeHours: number) {
  const [nodes, setNodes] = useState<TraceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTraceData();
  }, [sessionId, rangeHours]);

  const loadTraceData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Query hook_events from Cloud Server
      const response = await fetch(
        `${getCloudServerUrl()}/api/apm/query?sql=${encodeURIComponent(
          `SELECT * FROM hook_events WHERE session_id = '${sessionId}' ORDER BY ts ASC`
        )}`,
        { headers: { 'X-User-ID': getUserId() } }
      );
      
      const data = await response.json();
      const events: HookEvent[] = data.rows.map((row: any[]) => ({
        ts: row[0],
        event_type: row[3],
        tool_name: row[4],
        tool_use_id: row[7],
        agent_id: row[8],
        parent_agent_id: row[9],
        duration_ms: row[10],
        success: row[11],
      }));
      
      // Build tree from hook events
      const tree = buildFromHookEvents(events);
      setNodes(tree);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  return { nodes, loading, error, TYPE_COLORS };
}

function buildFromHookEvents(events: HookEvent[]): TraceNode[] {
  // Simple implementation: group by agent_id, then by tool_use_id
  const agentMap = new Map<string, TraceNode>();
  const toolMap = new Map<string, TraceNode>();
  
  for (const event of events) {
    if (event.event_type === 'SubagentStart') {
      const node: TraceNode = {
        id: event.agent_id,
        type: 'agent',
        name: `Subagent ${event.agent_id.slice(0, 8)}`,
        startTime: event.ts,
        duration: 0,
        status: 'running',
        children: [],
      };
      agentMap.set(event.agent_id, node);
      
      // Link to parent
      if (event.parent_agent_id && agentMap.has(event.parent_agent_id)) {
        agentMap.get(event.parent_agent_id)?.children?.push(node);
      }
    }
    
    if (event.event_type === 'PreToolUse') {
      const node: TraceNode = {
        id: event.tool_use_id,
        type: event.tool_name === 'AskUserQuestion' ? 'wait' : 'tool',
        name: event.tool_name,
        startTime: event.ts,
        duration: 0,
        status: 'running',
      };
      toolMap.set(event.tool_use_id, node);
      
      // Link to agent
      if (event.agent_id && agentMap.has(event.agent_id)) {
        agentMap.get(event.agent_id)?.children?.push(node);
      }
    }
    
    if (event.event_type === 'PostToolUse' && toolMap.has(event.tool_use_id)) {
      const node = toolMap.get(event.tool_use_id)!;
      node.duration = event.duration_ms;
      node.status = event.success ? 'completed' : 'failed';
      if (!event.success) node.type = 'error';
    }
  }
  
  // Return root agents (no parent_agent_id)
  return events
    .filter(e => e.event_type === 'SubagentStart' && !e.parent_agent_id)
    .map(e => agentMap.get(e.agent_id)!)
    .filter(Boolean);
}

function getCloudServerUrl(): string {
  return localStorage.getItem('cloud_server_url') || 'http://localhost:17529';
}

function getUserId(): string {
  return localStorage.getItem('apm_user_id') || 'unknown';
}
```

- [ ] **Step 2: Create TraceTab component**

```typescript
// src/components/ApmView/TraceTab.tsx
import { useState } from 'react';
import { useTraceData } from '../../hooks/useTraceData';
import TraceTree from './TraceTree';

interface TraceTabProps {
  sessionId: string;
  rangeHours: number;
}

export default function TraceTab({ sessionId, rangeHours }: TraceTabProps) {
  const { nodes, loading, error, TYPE_COLORS } = useTraceData(sessionId, rangeHours);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        无 Trace 数据
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TraceTree nodes={nodes} colors={TYPE_COLORS} />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm exec tsc --noEmit`
Expected: Errors for missing TraceTree (expected)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTraceData.ts src/components/ApmView/TraceTab.tsx
git commit -m "feat(apm): add TraceTab and useTraceData hook"
```

---

### Task 3.3: Create TraceTree and TraceNode Components

**Files:**
- Create: `src/components/ApmView/TraceTree.tsx`
- Create: `src/components/ApmView/TraceNode.tsx`

- [ ] **Step 1: Create TraceNode component**

```typescript
// src/components/ApmView/TraceNode.tsx
import { useState } from 'react';

interface TraceNodeProps {
  node: {
    id: string;
    type: 'agent' | 'llm' | 'tool' | 'wait' | 'exec' | 'error';
    name: string;
    startTime: number;
    duration: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    children?: any[];
  };
  color: string;
  depth: number;
  colors: Record<string, string>;
}

export default function TraceNode({ node, color, depth, colors }: TraceNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const durationStr = node.duration > 0 
    ? `${(node.duration / 1000).toFixed(1)}s` 
    : '...';

  return (
    <div className="flex flex-col">
      {/* Node row */}
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/collapse indicator */}
        {hasChildren && (
          <span className="text-white/50 text-xs w-4">
            {expanded ? '▼' : '▶'}
          </span>
        )}
        
        {/* Color bar */}
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        
        {/* Name */}
        <span className="text-sm text-white/80 flex-1 truncate">
          {node.name}
        </span>
        
        {/* Duration */}
        <span className="text-xs text-white/50">
          {durationStr}
        </span>
        
        {/* Status indicator */}
        {node.status === 'running' && (
          <span className="text-xs text-amber-400 animate-pulse">●</span>
        )}
        {node.status === 'failed' && (
          <span className="text-xs text-red-400">✗</span>
        )}
      </div>

      {/* Children (if expanded) */}
      {expanded && hasChildren && (
        <div className="flex flex-col">
          {node.children!.map((child) => (
            <TraceNode
              key={child.id}
              node={child}
              color={colors[child.type] || color}
              depth={depth + 1}
              colors={colors}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TraceTree component**

```typescript
// src/components/ApmView/TraceTree.tsx
import TraceNode from './TraceNode';

interface TraceTreeProps {
  nodes: any[];
  colors: Record<string, string>;
}

export default function TraceTree({ nodes, colors }: TraceTreeProps) {
  return (
    <div className="flex flex-col gap-1">
      {nodes.map((node) => (
        <TraceNode
          key={node.id}
          node={node}
          color={colors[node.type] || '#666'}
          depth={0}
          colors={colors}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/ApmView/TraceTree.tsx src/components/ApmView/TraceNode.tsx
git commit -m "feat(apm): add TraceTree and TraceNode components"
```

---

### Task 3.4: Create InsightsTab Component

**Files:**
- Create: `src/components/ApmView/InsightsTab.tsx`
- Create: `src/hooks/useInsights.ts`
- Create: `src/components/ApmView/ApiCalls.tsx`

- [ ] **Step 1: Create useInsights hook**

```typescript
// src/hooks/useInsights.ts
import { useState, useEffect } from 'react';

interface ApiCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  duration_ms: number;
  ts: number;
}

interface FileActivity {
  path: string;
  reads: number;
  writes: number;
}

interface ContextBreakdown {
  system: number;
  user: number;
  tools: number;
  reasoning: number;
}

interface AgentInfo {
  id: string;
  tool_count: number;
  children: AgentInfo[];
}

export function useInsights(sessionId: string, rangeHours: number) {
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [files, setFiles] = useState<FileActivity[]>([]);
  const [context, setContext] = useState<ContextBreakdown | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInsights();
  }, [sessionId, rangeHours]);

  const loadInsights = async () => {
    setLoading(true);
    setError(null);

    try {
      const baseUrl = getCloudServerUrl();
      const userId = getUserId();

      // Load API calls
      const callsResp = await fetch(
        `${baseUrl}/api/apm/query?sql=${encodeURIComponent(
          `SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output, 
           SUM(cache_read_tokens) as cache, SUM(cost_usd) as cost, COUNT(*) as count
           FROM messages WHERE session_id = '${sessionId}' AND role = 'assistant'
           GROUP BY model ORDER BY cost DESC`
        )}`,
        { headers: { 'X-User-ID': userId } }
      );
      const callsData = await callsResp.json();
      setApiCalls(callsData.rows.map((r: any[]) => ({
        model: r[0],
        input_tokens: r[1],
        output_tokens: r[2],
        cache_read_tokens: r[3],
        cost_usd: r[4],
        duration_ms: 0,
        ts: 0,
      })));

      // Load file activity (from hook_events tool_name=Read/Write/Edit)
      const filesResp = await fetch(
        `${baseUrl}/api/apm/query?sql=${encodeURIComponent(
          `SELECT tool_name, COUNT(*) as count FROM hook_events 
           WHERE session_id = '${sessionId}' AND tool_name IN ('Read', 'Write', 'Edit')
           GROUP BY tool_name`
        )}`,
        { headers: { 'X-User-ID': userId } }
      );
      const filesData = await filesResp.json();
      const readCount = filesData.rows.find((r: any[]) => r[0] === 'Read')?.[1] || 0;
      const writeCount = filesData.rows.filter((r: any[]) => 
        r[0] === 'Write' || r[0] === 'Edit'
      ).reduce((sum: number, r: any[]) => sum + r[1], 0);
      setFiles([{ path: 'All files', reads: readCount, writes: writeCount }]);

      // Mock context breakdown (would need detailed token analysis)
      setContext({ system: 15, user: 40, tools: 30, reasoning: 15 });

      // Load agent tree from hook_events
      const agentsResp = await fetch(
        `${baseUrl}/api/apm/query?sql=${encodeURIComponent(
          `SELECT agent_id, COUNT(*) as tool_count FROM hook_events 
           WHERE session_id = '${sessionId}' AND tool_name IS NOT NULL
           GROUP BY agent_id`
        )}`,
        { headers: { 'X-User-ID': userId } }
      );
      const agentsData = await agentsResp.json();
      setAgents(agentsData.rows.map((r: any[]) => ({
        id: r[0] || 'main',
        tool_count: r[1],
        children: [],
      })));

    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  return { apiCalls, files, context, agents, loading, error };
}

function getCloudServerUrl(): string {
  return localStorage.getItem('cloud_server_url') || 'http://localhost:17529';
}

function getUserId(): string {
  return localStorage.getItem('apm_user_id') || 'unknown';
}
```

- [ ] **Step 2: Create ApiCalls component**

```typescript
// src/components/ApmView/ApiCalls.tsx
interface ApiCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

interface ApiCallsProps {
  calls: ApiCall[];
}

export default function ApiCalls({ calls }: ApiCallsProps) {
  if (calls.length === 0) {
    return <div className="text-white/50 text-xs">无 API 调用数据</div>;
  }

  return (
    <div className="bg-white/5 rounded p-3">
      <h3 className="text-xs text-white/70 mb-2">API Calls</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/50">
              <th className="py-1 px-2">Model</th>
              <th className="py-1 px-2">Input</th>
              <th className="py-1 px-2">Output</th>
              <th className="py-1 px-2">Cache</th>
              <th className="py-1 px-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, i) => (
              <tr key={i} className="text-white/80">
                <td className="py-1 px-2 truncate">{call.model}</td>
                <td className="py-1 px-2">{call.input_tokens?.toLocaleString()}</td>
                <td className="py-1 px-2">{call.output_tokens?.toLocaleString()}</td>
                <td className="py-1 px-2">{call.cache_read_tokens?.toLocaleString()}</td>
                <td className="py-1 px-2">${(call.cost_usd || 0).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create InsightsTab component**

```typescript
// src/components/ApmView/InsightsTab.tsx
import { useInsights } from '../../hooks/useInsights';
import ApiCalls from './ApiCalls';

interface InsightsTabProps {
  sessionId: string;
  rangeHours: number;
}

export default function InsightsTab({ sessionId, rangeHours }: InsightsTabProps) {
  const { apiCalls, files, context, agents, loading, error } = useInsights(sessionId, rangeHours);

  if (loading) {
    return <div className="text-white/50">加载中...</div>;
  }

  if (error) {
    return <div className="text-red-400">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {/* API Calls */}
      <ApiCalls calls={apiCalls} />

      {/* Files Heatmap (simple version) */}
      <div className="bg-white/5 rounded p-3">
        <h3 className="text-xs text-white/70 mb-2">Files Activity</h3>
        {files.map((f, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <span className="text-xs text-white/80 flex-1 truncate">{f.path}</span>
            <span className="text-xs text-blue-400">{f.reads} reads</span>
            <span className="text-xs text-orange-400">{f.writes} writes</span>
          </div>
        ))}
      </div>

      {/* Context Breakdown */}
      {context && (
        <div className="bg-white/5 rounded p-3">
          <h3 className="text-xs text-white/70 mb-2">Context Window</h3>
          <div className="space-y-1">
            {Object.entries(context).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-white/50 w-16">{key}</span>
                <div className="flex-1 bg-white/10 rounded h-2">
                  <div
                    className="bg-blue-400 h-2 rounded"
                    style={{ width: `${value}%` }}
                  />
                </div>
                <span className="text-xs text-white/50">{value}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Tree */}
      <div className="bg-white/5 rounded p-3">
        <h3 className="text-xs text-white/70 mb-2">Agent Tree</h3>
        {agents.map((agent, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <span className="text-xs text-white/80">● {agent.id.slice(0, 8)}</span>
            <span className="text-xs text-white/50">{agent.tool_count} tools</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useInsights.ts src/components/ApmView/InsightsTab.tsx src/components/ApmView/ApiCalls.tsx
git commit -m "feat(apm): add InsightsTab with API Calls and activity data"
```

---

### Task 3.5: Update App.tsx for Independent ApmView Window

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add ApmView window sizing logic**

```typescript
// src/App.tsx (update window dimensions)
const APM_WIDTH = 800;
const APM_HEIGHT = 600;

// Update resize_window effect to handle ApmView
useEffect(() => {
  const resizeWindow = async () => {
    if (showApmForSession) {
      try {
        await invoke('resize_window', { width: APM_WIDTH, height: APM_HEIGHT });
      } catch (e) {
        console.error('Failed to resize window:', e);
      }
      return;
    }
    // existing sizing logic...
  };
  resizeWindow();
}, [showApmForSession, /* other deps */]);
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(apm): add independent window sizing for ApmView"
```

---

## Phase 4: OTLP Handler (Optional)

### Task 4.1: Create OTLP Handler

**Files:**
- Create: `cloud-server/src/apm/otlp.rs`
- Modify: `cloud-server/src/http.rs`

- [ ] **Step 1: Create OTLP handler**

```rust
// cloud-server/src/apm/otlp.rs
use axum::{
    body::Body,
    http::StatusCode,
    response::IntoResponse,
};
use prost::Message;

// OTLP protobuf definitions (simplified)
// In production, use opentelemetry-proto crate

pub async fn handle_otlp(body: Body) -> impl IntoResponse {
    let bytes = axum::body::to_bytes(body, 1024 * 1024).await.unwrap_or_default();
    
    // Parse protobuf (traces/metrics/logs)
    // For now, just log and return success
    tracing::info!("OTLP data received: {} bytes", bytes.len());
    
    // TODO: Parse protobuf and write to traces/metrics/logs tables
    // This requires opentelemetry-proto crate
    
    (StatusCode::OK, "OK")
}
```

- [ ] **Step 2: Add route**

```rust
// cloud-server/src/http.rs (add route)
.route("/v1/otlp", post(handle_otlp))
```

- [ ] **Step 3: Add prost dependency (optional)**

```toml
# cloud-server/Cargo.toml
prost = "0.12"
```

- [ ] **Step 4: Verify compilation**

Run: `cd cloud-server && cargo check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add cloud-server/src/apm/otlp.rs cloud-server/src/http.rs cloud-server/Cargo.toml
git commit -m "feat(cloud): add OTLP handler endpoint (placeholder)"
```

---

## Summary

**Total Tasks:** 16 tasks
**Estimated Time:** 5 days

| Phase | Tasks | Time |
|-------|-------|------|
| Phase 1: Cloud Server Backend | 5 tasks | 2 days |
| Phase 2: Desktop OTel Config | 3 tasks | 0.5 days |
| Phase 3: Frontend ApmView | 5 tasks | 2 days |
| Phase 4: OTLP Handler | 3 tasks | 0.5 days (optional) |

---

*End of implementation plan.*