# CC-Island OpenTelemetry Tracing 设计文档

> **日期**: 2026-04-22
> **目标**: 实现跨 Desktop → Cloud Server → Mobile 的分布式追踪链路，支持 OpenTelemetry OTLP 导出

---

## 架构概述

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Desktop       │     │  Cloud Server   │     │   Mobile App    │
│  (Rust/Tauri)   │────▶│    (Rust)       │────▶│  (TypeScript)   │
│                 │     │                 │     │                 │
│ OTEL SDK        │     │ OTEL SDK        │     │ OTEL SDK        │
│ tracing-otlp    │     │ tracing-otlp    │     │ @opentelemetry  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                        ┌───────▼───────┐
                        │ OTLP Collector│
                        │ (用户已有)    │
                        └───────────────┘
```

---

## 配置方式

### 统一配置命名

| 配置项 | 环境变量 | 配置文件字段 |
|--------|---------|-------------|
| 开关 | `CC_ISLAND_TRACING_ENABLED` | `enable_tracing` |
| Endpoint | `CC_ISLAND_OTEL_ENDPOINT` | `otel_endpoint` |

**优先级**: 环境变量 > 配置文件 > 默认值(false)

### Service Name

| 组件 | Service Name |
|------|-------------|
| Desktop | `cc-island-desktop` |
| Cloud Server | `cc-island-cloud` |
| Mobile | `cc-island-mobile` |

---

## Desktop (Rust) 实现

### 依赖新增

```toml
# src-tauri/Cargo.toml
opentelemetry = { version = "0.27", features = ["trace"] }
opentelemetry_sdk = { version = "0.27", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.27", features = ["grpc-tonic"] }
tracing-opentelemetry = "0.28"
```

### 配置结构扩展

```rust
// src-tauri/src/config.rs
pub struct AppSettings {
    // 现有字段...
    pub enable_tracing: bool,              // 默认 false
    pub otel_endpoint: Option<String>,     // 如 "http://localhost:4317"
}
```

### 初始化逻辑

```rust
// src-tauri/src/lib.rs
fn init_tracing(settings: &AppSettings) {
    // 环境变量优先
    let enabled = std::env::var("CC_ISLAND_TRACING_ENABLED")
        .map(|v| v == "true")
        .unwrap_or(settings.enable_tracing);
    
    let endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT")
        .ok()
        .or(settings.otel_endpoint.clone());
    
    if !enabled || endpoint.is_none() {
        tracing_subscriber::fmt::init();
        return;
    }
    
    // 创建 OTLP exporter + tracing layer
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(endpoint.unwrap())
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .expect("Failed to install tracer");
    
    tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .with(tracing_subscriber::fmt::layer())
        .init();
}
```

### Span 定义

| Span Name | 属性 | 触发点 |
|-----------|------|-------|
| `http.hook.receive` | `session_id`, `hook_type` | HTTP `/hook` 接收 |
| `ws.message.send` | `device_token`, `msg_type` | WebSocket 发送到 Cloud |
| `heartbeat.ping` | 无 | 心跳 Ping 发送 |
| `popup.response` | `session_id`, `decision` | 用户响应 Popup |

---

## Cloud Server (Rust) 实现

### 依赖新增

```toml
# cloud-server/Cargo.toml
opentelemetry = { version = "0.27", features = ["trace"] }
opentelemetry_sdk = { version = "0.27", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.27", features = ["grpc-tonic"] }
tracing-opentelemetry = "0.28"
```

### 配置结构扩展

```rust
// cloud-server/src/config.rs
pub struct Config {
    // 现有字段...
    pub enable_tracing: bool,
    pub otel_endpoint: Option<String>,
}
```

### 初始化逻辑

```rust
// cloud-server/src/main.rs
fn init_tracing(config: &Config) {
    let enabled = std::env::var("CC_ISLAND_TRACING_ENABLED")
        .map(|v| v == "true")
        .unwrap_or(config.enable_tracing);
    
    let endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT")
        .ok()
        .or(config.otel_endpoint.clone());
    
    if !enabled || endpoint.is_none() {
        tracing_subscriber::fmt::init();
        return;
    }
    
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(endpoint.unwrap())
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .expect("Failed to install tracer");
    
    tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .with(tracing_subscriber::fmt::layer())
        .init();
}
```

### Span 定义

| Span Name | 属性 | 触发点 |
|-----------|------|-------|
| `ws.connection.handle` | `conn_type`, `device_token` | WebSocket 连接处理 |
| `ws.message.route` | `msg_type`, `device_token` | 消息路由 |
| `db.device.upsert` | `device_token`, `hostname` | 设备注册 |
| `db.message.store` | `session_id`, `msg_count` | 聊天消息存储 |
| `broadcast.mobile` | `device_token`, `subscriber_count` | 广播到 Mobile |

---

## Mobile App (TypeScript) 实现

### 依赖新增

```json
// mobile-app/package.json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9",
    "@opentelemetry/sdk-trace-web": "^1.29",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57",
    "@opentelemetry/resources": "^1.29"
  }
}
```

### 初始化逻辑

```typescript
// mobile-app/src/tracing.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'

const TRACING_ENABLED = import.meta.env.VITE_TRACING_ENABLED === 'true'
const OTEL_ENDPOINT = import.meta.env.VITE_OTEL_ENDPOINT

export function initTracing() {
  if (!TRACING_ENABLED || !OTEL_ENDPOINT) return null
  
  const provider = new WebTracerProvider({
    resource: new Resource({
      'service.name': 'cc-island-mobile',
    }),
  })
  
  const exporter = new OTLPTraceExporter({
    url: `${OTEL_ENDPOINT}/v1/traces`,
  })
  
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  provider.register()
  
  return provider.getTracer('cc-island-mobile')
}

export const tracer = initTracing()
```

### Span 定义

| Span Name | 属性 | 触发点 |
|-----------|------|-------|
| `ws.connect` | `server_url` | WebSocket 连接 |
| `ws.message.receive` | `msg_type`, `session_id` | 消息接收 |
| `heartbeat.ping` | 无 | 心跳发送 |
| `hook.response` | `session_id`, `decision` | Hook 响应发送 |
| `chat.history.request` | `session_id` | 聊天历史请求 |

---

## Trace Context 传播

### 消息格式扩展

所有跨组件消息添加 `trace_context` 字段：

```typescript
interface MessageWithTraceContext {
  type: string
  // 业务字段...
  trace_context?: {
    traceparent: string  // W3C格式: "00-{trace-id}-{span-id}-{flags}"
  }
}
```

### Desktop 注入 Context

```rust
fn inject_trace_context(msg: &mut serde_json::Value) {
    let span = tracing::Span::current();
    if !span.is_none() {
        let context = span.context();
        let trace_id = context.span().trace_id();
        let span_id = context.span().span_id();
        
        msg["trace_context"] = serde_json::json!({
            "traceparent": format!("00-{:032x}-{:016x}-01", trace_id, span_id)
        });
    }
}
```

### Cloud Server 延续 Context

```rust
fn extract_and_continue_span(msg: &serde_json::Value) -> tracing::Span {
    if let Some(ctx) = msg.get("trace_context") {
        if let Some(traceparent) = ctx["traceparent"].as_str() {
            // 解析 traceparent: "00-{trace-id}-{span-id}-{flags}"
            let parts: Vec<&str> = traceparent.split('-').collect();
            if parts.len() == 4 && parts[0] == "00" {
                // 创建子 span 并设置 parent context
                return tracing::info_span!("handle_message");
            }
        }
    }
    tracing::info_span!("handle_message")
}
```

### Mobile 处理 Context

```typescript
function injectTraceContext(msg: object) {
  if (!tracer) return
  const activeSpan = tracer.getActiveSpan()
  if (activeSpan) {
    msg.trace_context = {
      traceparent: `00-${activeSpan.traceId}-${activeSpan.spanId}-01`
    }
  }
}

function extractAndContinueSpan(msg: object) {
  if (!tracer || !msg.trace_context?.traceparent) return null
  const parts = msg.trace_context.traceparent.split('-')
  if (parts.length === 4 && parts[0] === '00') {
    return tracer.startSpan('handle_message', {
      parent: { traceId: parts[1], spanId: parts[2] }
    })
  }
  return tracer.startSpan('handle_message')
}
```

---

## 实现顺序

### Phase 1: 基础设施
- Desktop: 依赖 + 配置 + 初始化
- Cloud Server: 依赖 + 配置 + 初始化
- 验证: 连接 OTLP Collector 成功

### Phase 2: Span 定义
- Desktop: HTTP hooks、WebSocket、heartbeat spans
- Cloud Server: connection、routing、DB spans
- 验证: Collector 中看到独立 traces

### Phase 3: Trace Context 传播
- 消息格式扩展 (`trace_context` 字段)
- Desktop → Cloud → Mobile context 传递
- 验证: 跨组件完整链路

### Phase 4: Mobile App
- 依赖 + 初始化 + spans
- 验证: Mobile trace 数据

### Phase 5: 配置 UI
- Desktop Settings 页面 tracing 配置
- Mobile Settings 页面 tracing 配置
- 验证: 用户可通过 UI 配置

---

## 关键文件修改清单

| 组件 | 文件 | 修改内容 |
|------|------|---------|
| Desktop | `src-tauri/Cargo.toml` | OTEL 依赖 |
| Desktop | `src-tauri/src/config.rs` | 配置结构 |
| Desktop | `src-tauri/src/lib.rs` | tracing 初始化 |
| Desktop | `src-tauri/src/http_server.rs` | spans |
| Desktop | `src-tauri/src/cloud_client.rs` | spans + context |
| Cloud | `cloud-server/Cargo.toml` | OTEL 依赖 |
| Cloud | `cloud-server/src/config.rs` | 配置结构 |
| Cloud | `cloud-server/src/main.rs` | tracing 初始化 |
| Cloud | `cloud-server/src/ws/connection.rs` | spans + context |
| Cloud | `cloud-server/src/ws/handler.rs` | spans |
| Cloud | `cloud-server/src/db/repository.rs` | DB spans |
| Mobile | `mobile-app/package.json` | OTEL 依赖 |
| Mobile | `mobile-app/src/tracing.ts` | 新文件：初始化 |
| Mobile | `mobile-app/src/hooks/useAllDevicesWebSocket.ts` | spans |

---

## 错误记录

所有 Span 自动附带错误信息：

```rust
// Rust
span.record_error(&err);
span.set_status(opentelemetry::trace::Status::Error { 
    description: err.to_string().into() 
});
```

```typescript
// TypeScript
span.recordException(err)
span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
```

---

## 测试验证

1. **启动 OTLP Collector** (如 Jaeger all-in-one)
2. **配置 tracing**: `CC_ISLAND_TRACING_ENABLED=true`, `CC_ISLAND_OTEL_ENDPOINT=http://localhost:4317`
3. **启动 Desktop + Cloud + Mobile**
4. **执行操作**: Claude Code hook → Desktop → Cloud → Mobile
5. **验证 Collector**: 查看完整 trace 链路