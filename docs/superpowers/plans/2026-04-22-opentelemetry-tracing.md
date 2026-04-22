# OpenTelemetry Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现跨 Desktop → Cloud Server → Mobile 的分布式追踪链路，支持 OpenTelemetry OTLP 导出

**Architecture:** 使用 W3C TraceContext 标准在消息中传递 traceparent，Desktop/Cloud 使用 Rust opentelemetry-otlp crate，Mobile 使用 @opentelemetry SDK，统一环境变量配置 CC_ISLAND_TRACING_ENABLED / CC_ISLAND_OTEL_ENDPOINT

**Tech Stack:** Rust (opentelemetry-otlp, tracing-opentelemetry), TypeScript (@opentelemetry/api, @opentelemetry/sdk-trace-web)

---

## Phase 1: 基础设施 (Desktop + Cloud)

### Task 1: Desktop Cargo.toml 添加 OTEL 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 添加 opentelemetry 相关依赖到 Cargo.toml**

在 `[dependencies]` 部分末尾添加：

```toml
# OpenTelemetry tracing
opentelemetry = { version = "0.27", features = ["trace"] }
opentelemetry_sdk = { version = "0.27", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.27", features = ["grpc-tonic"] }
tracing-opentelemetry = "0.28"
```

- [ ] **Step 2: 运行 cargo check 验证依赖添加成功**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 无错误，依赖下载成功

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(desktop): Add OpenTelemetry dependencies"
```

---

### Task 2: Desktop config.rs 扩展配置结构

**Files:**
- Modify: `src-tauri/src/config.rs`

- [ ] **Step 1: 在 AppSettings struct 添加 tracing 配置字段**

在 `device_name: Option<String>` 后添加：

```rust
    // OpenTelemetry tracing configuration
    pub enable_tracing: bool,             // enable distributed tracing
    pub otel_endpoint: Option<String>,    // e.g., "http://localhost:4317"
```

- [ ] **Step 2: 在 Default implementation 添加默认值**

在 `device_name: None,` 后添加：

```rust
            enable_tracing: false,
            otel_endpoint: None,
```

- [ ] **Step 3: 运行 cargo check 验证**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "feat(desktop): Add tracing config fields to AppSettings"
```

---

### Task 3: Desktop lib.rs tracing 初始化

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建 init_tracing 函数**

在文件顶部 imports 后添加新函数：

```rust
/// Initialize OpenTelemetry tracing if enabled
fn init_tracing(settings: &config::AppSettings) {
    // Environment variables override config file
    let enabled = std::env::var("CC_ISLAND_TRACING_ENABLED")
        .map(|v| v == "true")
        .unwrap_or(settings.enable_tracing);
    
    let endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT")
        .ok()
        .or(settings.otel_endpoint.clone());
    
    if !enabled || endpoint.is_none() {
        // Default: only console logging
        tracing_subscriber::fmt::init();
        tracing::info!("Tracing disabled or no endpoint configured");
        return;
    }
    
    tracing::info!("Initializing OpenTelemetry tracing with endpoint: {}", endpoint.unwrap());
    
    // Create OTLP exporter
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_service_name("cc-island-desktop")
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(endpoint.unwrap())
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .expect("Failed to install OpenTelemetry tracer");
    
    // Register tracing layer with fmt layer
    tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    tracing::info!("OpenTelemetry tracing initialized successfully");
}
```

- [ ] **Step 2: 替换原有的 tracing_subscriber::fmt::init()**

将 `run()` 函数中的：
```rust
tracing_subscriber::fmt::init();
```

替换为：
```rust
// Load settings and initialize tracing
let settings = config::load_settings();
init_tracing(&settings);
```

注意：需要先加载 settings，所以需要调整代码顺序，让 settings 在 tracing init 之前加载。

- [ ] **Step 3: 运行 cargo check 验证**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(desktop): Implement OpenTelemetry tracing initialization"
```

---

### Task 4: Cloud Server Cargo.toml 添加 OTEL 依赖

**Files:**
- Modify: `cloud-server/Cargo.toml`

- [ ] **Step 1: 添加 opentelemetry 相关依赖到 Cargo.toml**

在 `[dependencies]` 部分末尾添加：

```toml
# OpenTelemetry tracing
opentelemetry = { version = "0.27", features = ["trace"] }
opentelemetry_sdk = { version = "0.27", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.27", features = ["grpc-tonic"] }
tracing-opentelemetry = "0.28"
```

- [ ] **Step 2: 运行 cargo check 验证依赖添加成功**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误，依赖下载成功

- [ ] **Step 3: Commit**

```bash
git add cloud-server/Cargo.toml
git commit -m "feat(cloud): Add OpenTelemetry dependencies"
```

---

### Task 5: Cloud Server config.rs 扩展配置结构

**Files:**
- Modify: `cloud-server/src/config.rs`

- [ ] **Step 1: 在 Config struct 添加 tracing 配置字段**

在 `http_port: u16,` 后添加：

```rust
    /// OpenTelemetry tracing enabled
    pub enable_tracing: bool,
    /// OpenTelemetry OTLP endpoint (e.g., "http://localhost:4317")
    pub otel_endpoint: Option<String>,
```

- [ ] **Step 2: 在 from_env implementation 添加解析逻辑**

在 `Ok(Self { ... })` 之前添加：

```rust
        let enable_tracing = std::env::var("CC_ISLAND_TRACING_ENABLED")
            .map(|v| v == "true")
            .unwrap_or(false);
        
        let otel_endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT").ok();
```

在 `Ok(Self {` 中添加：

```rust
            enable_tracing,
            otel_endpoint,
```

- [ ] **Step 3: 运行 cargo check 验证**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/config.rs
git commit -m "feat(cloud): Add tracing config fields to Config"
```

---

### Task 6: Cloud Server main.rs tracing 初始化

**Files:**
- Modify: `cloud-server/src/main.rs`

- [ ] **Step 1: 创建 init_tracing 函数**

在 `main` 函数之前添加：

```rust
/// Initialize OpenTelemetry tracing if enabled
fn init_tracing(config: &Config) {
    // Environment variables override config
    let enabled = std::env::var("CC_ISLAND_TRACING_ENABLED")
        .map(|v| v == "true")
        .unwrap_or(config.enable_tracing);
    
    let endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT")
        .ok()
        .or(config.otel_endpoint.clone());
    
    if !enabled || endpoint.is_none() {
        tracing_subscriber::fmt::init();
        tracing::info!("Tracing disabled or no endpoint configured");
        return;
    }
    
    tracing::info!("Initializing OpenTelemetry tracing with endpoint: {}", endpoint.unwrap());
    
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_service_name("cc-island-cloud")
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(endpoint.unwrap())
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .expect("Failed to install OpenTelemetry tracer");
    
    tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    tracing::info!("OpenTelemetry tracing initialized successfully");
}
```

- [ ] **Step 2: 替换原有的 tracing_subscriber::fmt::init()**

将 `main` 函数中的：
```rust
tracing_subscriber::fmt::init();
```

替换为：
```rust
init_tracing(&config);
```

- [ ] **Step 3: 运行 cargo check 验证**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/main.rs
git commit -m "feat(cloud): Implement OpenTelemetry tracing initialization"
```

---

## Phase 2: Span 定义 (Desktop)

### Task 7: Desktop http_server.rs 添加 spans

**Files:**
- Modify: `src-tauri/src/http_server.rs`

- [ ] **Step 1: 在 handle_hook 函数入口创建 span**

在 `handle_hook` 函数开头添加：

```rust
pub async fn handle_hook(
    body: HookBody,
    state: Arc<RwLock<AppState>>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    // Create span for hook receive
    let span = tracing::info_span!(
        "http.hook.receive",
        session_id = %body.session_id,
        hook_type = %body.hook_event_name,
    );
    let _enter = span.enter();
    
    // ... rest of existing code
```

- [ ] **Step 2: 在关键处理分支添加 span attributes**

在 PermissionRequest 处理部分添加：

```rust
            tracing::info!("PermissionRequest received");
            span.record("tool_name", &tool_name);
            span.record("action", &action);
```

- [ ] **Step 3: 在错误处理时设置 span status**

在错误返回处添加：

```rust
                tracing::error!("Hook error: {}", e);
                span.record_error(&e);
                span.set_status(opentelemetry::trace::Status::Error {
                    description: e.to_string().into()
                });
```

- [ ] **Step 4: 运行 cargo check 验证**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server.rs
git commit -m "feat(desktop): Add spans to HTTP hook handler"
```

---

### Task 8: Desktop cloud_client.rs 添加 spans + context 注入

**Files:**
- Modify: `src-tauri/src/cloud_client.rs`

- [ ] **Step 1: 创建 inject_trace_context helper 函数**

在文件顶部添加：

```rust
/// Inject trace context into outgoing WebSocket message
fn inject_trace_context(msg: &mut serde_json::Value) {
    let span = tracing::Span::current();
    if span.is_none() {
        return;
    }
    
    let context = span.context();
    let span_context = context.span().span_context();
    if !span_context.is_valid() {
        return;
    }
    
    let trace_id = span_context.trace_id();
    let span_id = span_context.span_id();
    let trace_flags = span_context.trace_flags();
    
    msg["trace_context"] = serde_json::json!({
        "traceparent": format!("00-{:032x}-{:016x}-{:02x}", 
            u128::from_be_bytes(trace_id.to_bytes()),
            u64::from_be_bytes(span_id.to_bytes()),
            u8::from(trace_flags)
        )
    });
}
```

- [ ] **Step 2: 在 push_hook_message 函数添加 span 和 inject context**

修改 `push_hook_message` 函数：

```rust
pub fn push_hook_message(&self, session_id: &str, hook_type: &str, hook_body: serde_json::Value) {
    if !self.is_connected() {
        return;
    }

    let span = tracing::info_span!(
        "ws.message.send",
        device_token = %self.device_token,
        msg_type = hook_type,
    );
    let _enter = span.enter();

    if let Some(tx) = &self.out_tx {
        let mut msg = serde_json::json!({
            "type": "hook_message",
            "device_token": self.device_token,
            "session_id": session_id,
            "hook_type": hook_type,
            "hook_body": hook_body,
        });
        
        inject_trace_context(&mut msg);
        
        if let Err(e) = tx.try_send(Message::text(msg.to_string())) {
            tracing::warn!("Failed to push hook message: {}", e);
            span.record_error(&e);
        }
    }
}
```

- [ ] **Step 3: 在 heartbeat 发送处添加 span**

在 heartbeat_task 的 Ping 发送处添加：

```rust
            tracing::debug!("Heartbeat: sending Ping");
            let span = tracing::info_span!("heartbeat.ping");
            let _enter = span.enter();
            if let Err(e) = out_tx.try_send(Message::Ping(Bytes::new())) {
```

- [ ] **Step 4: 运行 cargo check 验证**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cloud_client.rs
git commit -m "feat(desktop): Add spans and trace context injection to cloud client"
```

---

## Phase 3: Span 定义 (Cloud Server)

### Task 9: Cloud connection.rs 添加 spans + context 提取

**Files:**
- Modify: `cloud-server/src/ws/connection.rs`

- [ ] **Step 1: 创建 extract_trace_context helper 函数**

在文件顶部添加：

```rust
/// Extract trace context from incoming message and create child span
fn extract_trace_context(msg: &serde_json::Value, span_name: &str) -> tracing::Span {
    if let Some(ctx) = msg.get("trace_context") {
        if let Some(traceparent) = ctx["traceparent"].as_str() {
            // Parse W3C traceparent: "00-{trace-id}-{span-id}-{flags}"
            let parts: Vec<&str> = traceparent.split('-').collect();
            if parts.len() == 4 && parts[0] == "00" {
                tracing::info!(
                    trace_id = parts[1],
                    parent_span_id = parts[2],
                    "Received trace context from client"
                );
                // Note: In Rust tracing, we can't directly set parent from parsed traceparent
                // We create a new span and link it via attributes
                return tracing::info_span!(
                    span_name,
                    parent_trace_id = parts[1],
                    parent_span_id = parts[2],
                );
            }
        }
    }
    tracing::info_span!(span_name)
}
```

- [ ] **Step 2: 在 handle_connection 函数添加 connection span**

在 connection 注册成功后添加：

```rust
        match auth_result {
            Ok((conn_type, device_token, hostname, mobile_device_tokens)) => {
                // Create connection span
                let conn_span = tracing::info_span!(
                    "ws.connection.handle",
                    conn_type = match conn_type {
                        ConnectionType::Desktop => "desktop",
                        ConnectionType::Mobile => "mobile",
                    },
                    device_token = %device_token,
                );
                let _conn_enter = conn_span.enter();
```

- [ ] **Step 3: 在消息接收处提取 context 并创建 span**

在 recv_task 的 Text 消息处理处修改：

```rust
                        Ok(Message::Text(text)) => {
                            let text_preview = text.chars().take(300).collect::<String>();
                            tracing::info!("Recv task: received text message: {}", text_preview);
                            
                            if let Ok(cloud_msg) = serde_json::from_str::<CloudMessage>(&text) {
                                // Extract trace context and create span
                                let json_value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({}));
                                let msg_span = extract_trace_context(&json_value, "ws.message.receive");
                                let _msg_enter = msg_span.enter();
                                
                                tracing::info!("Recv task: parsed CloudMessage type: {:?}", cloud_msg);
                                handler.handle(cloud_msg, &out_tx, &device_token).await;
                            }
```

- [ ] **Step 4: 运行 cargo check 验证**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add cloud-server/src/ws/connection.rs
git commit -m "feat(cloud): Add spans and trace context extraction to connection handler"
```

---

### Task 10: Cloud handler.rs 添加 spans

**Files:**
- Modify: `cloud-server/src/ws/handler.rs`

- [ ] **Step 1: 在 handle 函数入口添加 span**

修改 `handle` 函数，在每个 CloudMessage 类型处理处添加 span：

```rust
    pub async fn handle(&self, msg: CloudMessage, tx: &Sender<Message>, device_token: &str) {
        match msg {
            CloudMessage::HookMessage { device_token: msg_device_token, session_id, hook_type, hook_body } => {
                let span = tracing::info_span!(
                    "ws.message.route",
                    msg_type = "hook_message",
                    device_token = %msg_device_token,
                    session_id = %session_id,
                    hook_type = %hook_type,
                );
                let _enter = span.enter();
                
                tracing::info!("HookMessage from desktop: device={}, session={}, hook_type={}",
                    msg_device_token, session_id, hook_type);
                // ... existing code
```

- [ ] **Step 2: 在 broadcast_to_mobiles 处添加 span**

在 `broadcast_to_mobiles` 调用前后添加：

```rust
                let subscriber_count = self.router.get_subscriber_count(&msg_device_token);
                span.record("subscriber_count", subscriber_count as i64);
                
                self.router.broadcast_to_mobiles(&msg_device_token, Message::text(json));
                
                tracing::info!("Broadcasted hook to {} mobile subscribers", subscriber_count);
```

- [ ] **Step 3: 运行 cargo check 验证**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/ws/handler.rs
git commit -m "feat(cloud): Add spans to message handler"
```

---

### Task 11: Cloud repository.rs 添加 DB spans

**Files:**
- Modify: `cloud-server/src/db/repository.rs`

- [ ] **Step 1: 在 upsert_device 函数添加 span**

修改 `upsert_device` 函数：

```rust
    pub async fn upsert_device(&self, device_token: &str, hostname: Option<&str>, device_name: Option<&str>) -> Result<(), sqlx::Error> {
        let span = tracing::info_span!(
            "db.device.upsert",
            device_token = %device_token,
            hostname = hostname.unwrap_or("unknown"),
        );
        let _enter = span.enter();
        
        tracing::info!("Upserting device in database");
        // ... existing code
```

- [ ] **Step 2: 在其他 DB 函数添加 span（可选，示例）**

为 `set_device_offline` 添加 span：

```rust
    pub async fn set_device_offline(&self, device_token: &str) -> Result<(), sqlx::Error> {
        let span = tracing::info_span!(
            "db.device.offline",
            device_token = %device_token,
        );
        let _enter = span.enter();
        
        // ... existing code
```

- [ ] **Step 3: 运行 cargo check 验证**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add cloud-server/src/db/repository.rs
git commit -m "feat(cloud): Add spans to database operations"
```

---

### Task 12: Cloud router.rs 添加 broadcast span

**Files:**
- Modify: `cloud-server/src/ws/router.rs`

- [ ] **Step 1: 在 broadcast_to_mobiles 函数添加 span**

修改 `broadcast_to_mobiles` 函数：

```rust
    pub fn broadcast_to_mobiles(&self, device_token: &str, msg: Message) {
        let span = tracing::info_span!(
            "broadcast.mobile",
            device_token = %device_token,
        );
        let _enter = span.enter();
        
        // ... existing code
        
        span.record("subscriber_count", subscribers.len() as i64);
        tracing::info!("Broadcasting to {} mobile subscribers", subscribers.len());
```

- [ ] **Step 2: 运行 cargo check 验证**

Run: `cargo check --manifest-path cloud-server/Cargo.toml`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add cloud-server/src/ws/router.rs
git commit -m "feat(cloud): Add spans to broadcast operations"
```

---

## Phase 4: Mobile App

### Task 13: Mobile package.json 添加 OTEL 依赖

**Files:**
- Modify: `mobile-app/package.json`

- [ ] **Step 1: 在 dependencies 添加 OpenTelemetry 相关依赖**

在 `dependencies` 部分添加：

```json
    "@opentelemetry/api": "^1.9",
    "@opentelemetry/sdk-trace-web": "^1.29",
    "@opentelemetry/sdk-trace-base": "^1.29",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57",
    "@opentelemetry/resources": "^1.29"
```

- [ ] **Step 2: 运行 npm install 安装依赖**

Run: `cd mobile-app && npm install`
Expected: 依赖安装成功，无错误

- [ ] **Step 3: Commit**

```bash
git add mobile-app/package.json mobile-app/package-lock.json
git commit -m "feat(mobile): Add OpenTelemetry dependencies"
```

---

### Task 14: Mobile 创建 tracing.ts 初始化文件

**Files:**
- Create: `mobile-app/src/tracing.ts`

- [ ] **Step 1: 创建 tracing.ts 文件**

创建新文件 `mobile-app/src/tracing.ts`：

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { trace } from '@opentelemetry/api'

// Environment variables (Vite supports import.meta.env)
const TRACING_ENABLED = import.meta.env.VITE_TRACING_ENABLED === 'true'
const OTEL_ENDPOINT = import.meta.env.VITE_OTEL_ENDPOINT || ''

let tracerProvider: WebTracerProvider | null = null
let tracer: ReturnType<typeof trace.getTracer> | null = null

/**
 * Initialize OpenTelemetry tracing
 * Returns tracer instance if enabled, null otherwise
 */
export function initTracing(): ReturnType<typeof trace.getTracer> | null {
  if (!TRACING_ENABLED || !OTEL_ENDPOINT) {
    console.log('[Tracing] Disabled or no endpoint configured')
    return null
  }

  console.log('[Tracing] Initializing with endpoint:', OTEL_ENDPOINT)

  // Create resource with service name
  const resource = new Resource({
    'service.name': 'cc-island-mobile',
  })

  // Create provider
  tracerProvider = new WebTracerProvider({
    resource,
  })

  // Create OTLP exporter (HTTP)
  const exporter = new OTLPTraceExporter({
    url: `${OTEL_ENDPOINT}/v1/traces`,
  })

  // Add span processor (batch for efficiency)
  tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter))

  // Register provider
  tracerProvider.register()

  // Get tracer
  tracer = trace.getTracer('cc-island-mobile')

  console.log('[Tracing] Initialized successfully')
  return tracer
}

/**
 * Get the tracer instance
 */
export function getTracer(): ReturnType<typeof trace.getTracer> | null {
  return tracer
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  return TRACING_ENABLED && !!tracer
}

/**
 * Inject trace context into outgoing message
 * Returns traceparent string in W3C format
 */
export function injectTraceContext(): { traceparent: string } | null {
  if (!tracer) return null
  
  const activeSpan = tracer.getActiveSpan?.()
  if (!activeSpan) return null
  
  const spanContext = activeSpan.spanContext()
  if (!spanContext.isValid()) return null
  
  const traceId = spanContext.traceId
  const spanId = spanContext.spanId
  const traceFlags = spanContext.traceFlags
  
  return {
    traceparent: `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`
  }
}

/**
 * Extract trace context from incoming message
 * Returns null if no valid context found
 */
export function extractTraceContext(msg: { trace_context?: { traceparent?: string } }): {
  traceId: string
  spanId: string
} | null {
  if (!msg.trace_context?.traceparent) return null
  
  const parts = msg.trace_context.traceparent.split('-')
  if (parts.length !== 4 || parts[0] !== '00') return null
  
  return {
    traceId: parts[1],
    spanId: parts[2],
  }
}

// Initialize on module load
tracer = initTracing()
```

- [ ] **Step 2: 运行 TypeScript check 验证**

Run: `cd mobile-app && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add mobile-app/src/tracing.ts
git commit -m "feat(mobile): Create tracing initialization module"
```

---

### Task 15: Mobile useAllDevicesWebSocket.ts 添加 spans

**Files:**
- Modify: `mobile-app/src/hooks/useAllDevicesWebSocket.ts`

- [ ] **Step 1: 导入 tracing utilities**

在文件顶部添加 import：

```typescript
import { getTracer, isTracingEnabled, injectTraceContext, extractTraceContext } from '../tracing'
```

- [ ] **Step 2: 在 connect 函数添加 ws.connect span**

在 `connect` 函数的 WebSocket 创建处添加：

```typescript
  const connect = useCallback(() => {
    const tracer = getTracer()
    const connectSpan = tracer?.startSpan('ws.connect', {
      attributes: { server_url: serverUrl }
    })
    
    console.log('[WebSocket] connect() called, serverUrl:', serverUrl, 'devices:', devices.length)
    
    // ... existing WebSocket creation code
    
    ws.onopen = () => {
      connectSpan?.end()
      // ... existing code
    }
```

- [ ] **Step 3: 在消息接收处添加 span**

在消息处理的 switch case 处添加：

```typescript
        case 'hook_message':
          const msgSpan = tracer?.startSpan('ws.message.receive', {
            attributes: {
              msg_type: 'hook_message',
              session_id: data.session_id,
            }
          })
          
          // Extract trace context if present
          const extractedCtx = extractTraceContext(data)
          if (extractedCtx && tracer) {
            msgSpan?.setAttribute('parent_trace_id', extractedCtx.traceId)
            msgSpan?.setAttribute('parent_span_id', extractedCtx.spanId)
          }
          
          // ... existing processing code
          
          msgSpan?.end()
          break
```

- [ ] **Step 4: 在 heartbeat 发送处添加 span**

在 `startHeartbeat` 的 Ping 发送处添加：

```typescript
        const pingSpan = tracer?.startSpan('heartbeat.ping')
        ws.send(JSON.stringify({ type: 'ping' }))
        pingSpan?.end()
```

- [ ] **Step 5: 在 sendHookResponse 处添加 span 和 inject context**

在发送 hook_response 处添加：

```typescript
      const responseSpan = tracer?.startSpan('hook.response', {
        attributes: {
          session_id: sessionId,
          decision: decision || 'none',
        }
      })
      
      const response = {
        type: 'hook_response',
        session_id: sessionId,
        decision,
        answers,
      }
      
      const traceCtx = injectTraceContext()
      if (traceCtx) {
        response.trace_context = traceCtx
      }
      
      ws.send(JSON.stringify(response))
      responseSpan?.end()
```

- [ ] **Step 6: 运行 TypeScript check 验证**

Run: `cd mobile-app && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add mobile-app/src/hooks/useAllDevicesWebSocket.ts
git commit -m "feat(mobile): Add spans to WebSocket hook"
```

---

### Task 16: Mobile 环境变量配置文件

**Files:**
- Create: `mobile-app/.env.example`

- [ ] **Step 1: 创建 .env.example 文件**

```bash
# OpenTelemetry Tracing Configuration
# Uncomment and set values to enable tracing

# VITE_TRACING_ENABLED=true
# VITE_OTEL_ENDPOINT=http://localhost:4318
```

- [ ] **Step 2: Commit**

```bash
git add mobile-app/.env.example
git commit -m "docs(mobile): Add .env.example for tracing configuration"
```

---

## Phase 5: 配置 UI (可选，后续)

### Task 17: Desktop Settings 页面添加 tracing 配置 (可选)

**Files:**
- Modify: `src/components/Settings.tsx`

此任务为可选，用户可通过环境变量或配置文件配置 tracing。如需 UI 配置，后续添加。

---

## 验证步骤

### 测试 Phase 1-3

1. 启动 OTLP Collector (如 Jaeger):
   ```bash
   docker run -d --name jaeger \
     -e COLLECTOR_OTLP_ENABLED=true \
     -p 16686:16686 \
     -p 4317:4317 \
     -p 4318:4318 \
     jaegertracing/all-in-one:latest
   ```

2. 配置环境变量:
   ```bash
   export CC_ISLAND_TRACING_ENABLED=true
   export CC_ISLAND_OTEL_ENDPOINT=http://localhost:4317
   ```

3. 启动 Desktop 和 Cloud Server

4. 触发 Claude Code hook

5. 打开 Jaeger UI (http://localhost:16686)，查看:
   - `cc-island-desktop` service
   - `cc-island-cloud` service
   - 完整 trace 链路

### 测试 Phase 4

1. 配置 Mobile 环境变量:
   ```bash
   VITE_TRACING_ENABLED=true
   VITE_OTEL_ENDPOINT=http://localhost:4318
   ```

2. 启动 Mobile App

3. 在 Jaeger 查看 `cc-island-mobile` service

---

## 实现完成 Checklist

- [ ] Phase 1: Desktop + Cloud 基础设施 (Tasks 1-6)
- [ ] Phase 2: Desktop spans (Tasks 7-8)
- [ ] Phase 3: Cloud spans (Tasks 9-12)
- [ ] Phase 4: Mobile App (Tasks 13-16)
- [ ] 验证: Jaeger UI 看到完整 trace 链路
- [ ] Push feature/trace 分支到 remote