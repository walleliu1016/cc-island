# PTY Wrapper 方案设计（完整版）

## 问题背景

当前 CC-Island 可以远程监控 Claude Code 状态和审批权限，但无法主动向 Claude 发送消息。

Roadmap 中的"双向交互"功能需要：
- 用户通过手机发送消息到 Desktop
- Desktop 将消息注入到正在运行的 Claude Code CLI

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据流向                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐                                                         │
│   │   Mobile App │                                                         │
│   │   ChatView   │                                                         │
│   │              │                                                         │
│   │ [输入框]      │  文字/语音 → 文字                                        │
│   │ [发送按钮]    │                                                         │
│   └──────┬───────┘                                                         │
│          │                                                                 │
│          │ WebSocket: InjectInput { session_id, content }                  │
│          ▼                                                                 │
│   ┌──────────────┐                                                         │
│   │ Cloud Server │  路由转发                                                │
│   │   Handler    │  device_token → desktop connection                      │
│   └──────┬───────┘                                                         │
│          │                                                                 │
│          │ WebSocket: InjectInput { session_id, content }                  │
│          ▼                                                                 │
│   ┌──────────────┐                                                         │
│   │   Desktop    │  CloudClient 接收                                       │
│   │   CC-Island  │  → InputInjector 转发                                   │
│   └──────┬───────┘                                                         │
│          │                                                                 │
│          │ TCP Socket: { type: "inject", content: "..." }                  │
│          ▼                                                                 │
│   ┌──────────────┐                                                         │
│   │ PTY Wrapper  │  接收 Socket 消息                                        │
│   │  (portable-  │  → 写入 PTY stdin                                        │
│   │   pty)       │  → Claude 接收用户输入                                   │
│   └──────┬───────┘                                                         │
│          │                                                                 │
│          │ PTY stdin 写入                                                   │
│          ▼                                                                 │
│   ┌──────────────┐                                                         │
│   │  Claude CLI  │  执行用户命令                                            │
│   │              │  → 输出结果到 PTY stdout                                 │
│   └──────────────┘                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 各模块改动详情

### 1. Mobile App (mobile-app)

#### 改动文件

| 文件 | 改动内容 |
|------|----------|
| `ChatView.tsx` | 添加输入框、发送按钮、语音按钮 |
| `hooks/useAllDevicesWebSocket.ts` | 新增 `sendInjectInput` 方法 |
| `types.ts` | 新增消息类型 |

#### ChatView 改动

**新增组件：**

```tsx
// 输入区域（底部）
<div className="border-t border-white/10 p-3">
  <div className="flex items-center gap-2">
    {/* 文字输入框 */}
    <input
      type="text"
      value={inputText}
      onChange={e => setInputText(e.target.value)}
      placeholder="输入消息..."
      className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-sm"
    />
    
    {/* 语音按钮 */}
    <button onClick={handleVoiceInput} className="p-2">
      <MicIcon />
    </button>
    
    {/* 发送按钮 */}
    <button onClick={handleSend} disabled={!inputText.trim()}>
      <SendIcon />
    </button>
  </div>
</div>
```

**语音输入实现：**

```tsx
// 使用 Web Speech API（浏览器原生，无需额外 API）
const handleVoiceInput = () => {
  const recognition = new webkitSpeechRecognition()
  recognition.lang = 'zh-CN'
  recognition.continuous = false
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript
    setInputText(transcript)
  }
  
  recognition.start()
}
```

#### WebSocket Hook 改动

```ts
// hooks/useAllDevicesWebSocket.ts
const sendInjectInput = (deviceToken: string, sessionId: string, content: string) => {
  const msg = {
    type: 'inject_input',
    device_token: deviceToken,
    session_id: sessionId,
    content: content,
  }
  ws.send(JSON.stringify(msg))
}
```

---

### 2. Cloud Server (cloud-server)

#### 改动文件

| 文件 | 改动内容 |
|------|----------|
| `messages.rs` | 新增 `InjectInput` 消息类型 |
| `ws/handler.rs` | 处理 `InjectInput` 转发给 Desktop |

#### messages.rs 改动

```rust
// 新增消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CloudMessage {
    // ... 现有类型 ...
    
    /// Mobile -> Cloud -> Desktop: 注入用户输入到 Claude
    #[serde(rename = "inject_input")]
    InjectInput {
        /// Device token
        device_token: String,
        /// Session ID
        session_id: String,
        /// 用户输入内容（文字）
        content: String,
        /// 输入类型（可选：text/voice）
        input_type: Option<String>,
    },
    
    /// Desktop -> Cloud -> Mobile: 注入结果反馈
    #[serde(rename = "inject_result")]
    InjectResult {
        /// Device token
        device_token: String,
        /// Session ID
        session_id: String,
        /// 是否成功
        success: bool,
        /// 错误信息（可选）
        error: Option<String>,
    },
}
```

#### handler.rs 改动

```rust
// 在 handle() 方法中新增处理
CloudMessage::InjectInput { device_token, session_id, content, input_type } => {
    tracing::info!("InjectInput from mobile: device={}, session={}, content_len={}",
        device_token, session_id, content.len());
    
    // 转发给 Desktop
    let inject_msg = CloudMessage::InjectInput {
        device_token: device_token.clone(),
        session_id,
        content,
        input_type,
    };
    let json = serde_json::to_string(&inject_msg).unwrap();
    self.router.send_to_desktop(&device_token, Message::text(json));
}

CloudMessage::InjectResult { device_token, session_id, success, error } => {
    tracing::info!("InjectResult from desktop: device={}, session={}, success={}",
        device_token, session_id, success);
    
    // 转发给 Mobile
    let result_msg = CloudMessage::InjectResult {
        device_token: device_token.clone(),
        session_id,
        success,
        error,
    };
    let json = serde_json::to_string(&result_msg).unwrap();
    self.router.broadcast_to_mobiles(&device_token, Message::text(json));
}
```

---

### 3. Desktop (src-tauri)

#### 改动文件

| 文件 | 改动内容 |
|------|----------|
| `cloud_client.rs` | 处理 `InjectInput` 消息 |
| `input_injector.rs` | **新增**：管理 PTY Wrapper 连接 |
| `http_server.rs` | 新增 `/inject` API（可选，用于本地测试） |
| `lib.rs` | 集成 InputInjector |

#### cloud_client.rs 改动

```rust
// 在 receive task 中新增处理
if json["type"] == "inject_input" {
    handle_inject_input(&app_state, &json);
}

fn handle_inject_input(app_state: &Arc<RwLock<AppState>>, json: &serde_json::Value) {
    let session_id = json["session_id"].as_str().unwrap_or("");
    let content = json["content"].as_str().unwrap_or("");
    
    tracing::info!("Received inject_input: session={}, content={}", session_id, content);
    
    // 获取 InputInjector 并发送
    let state = app_state.read();
    if let Some(ref injector) = state.input_injector {
        injector.inject(session_id, content);
    } else {
        tracing::warn!("InputInjector not initialized");
    }
}
```

#### input_injector.rs（新增）

```rust
// src-tauri/src/input_injector.rs

use tokio::net::TcpStream;
use tokio::sync::mpsc::{Sender, channel};
use serde::{Serialize, Deserialize};

/// InputInjector 管理 PTY Wrapper 连接
pub struct InputInjector {
    /// Session -> Wrapper Port 映射
    session_ports: std::collections::HashMap<String, u16>,
    /// 发送通道
    tx: Sender<InjectRequest>,
}

#[derive(Serialize, Deserialize)]
struct InjectRequest {
    #[serde(rename = "type")]
    msg_type: String,
    session_id: String,
    content: String,
}

impl InputInjector {
    pub fn new() -> Self {
        let (tx, mut rx) = channel(64);
        
        // 启动发送任务
        tokio::spawn(async move {
            while let Some(req) = rx.recv().await {
                // 根据 session_id 查找对应的 Wrapper 端口
                // 连接并发送
                if let Ok(stream) = TcpStream::connect(("127.0.0.1", 17528)).await {
                    // 发送 JSON 消息
                }
            }
        });
        
        Self {
            session_ports: std::collections::HashMap::new(),
            tx,
        }
    }
    
    /// 注册 session 与 Wrapper 端口映射
    pub fn register_session(&mut self, session_id: &str, port: u16) {
        self.session_ports.insert(session_id.to_string(), port);
    }
    
    /// 注入输入
    pub fn inject(&self, session_id: &str, content: &str) {
        let req = InjectRequest {
            msg_type: "inject_input".to_string(),
            session_id: session_id.to_string(),
            content: content.to_string(),
        };
        let _ = self.tx.try_send(req);
    }
}
```

---

### 4. PTY Wrapper (pty-wrapper)

#### 新增目录结构

```
cc-island/
├── pty-wrapper/               # 新增
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # 主入口：PTY + Socket + 输入合并
│       ├── pty.rs             # PTY 管理：创建、resize、信号
│       ├── socket.rs          # Socket 服务：监听、接收注入
│       ├── session.rs         # Session 监听：JSONL 文件检测
│       ├── register.rs        # 注册：向 CC-Island 注册/注销
│       └── terminal.rs        # 终端：大小检测、stdin 监听
│   └── tests/
│       └── integration_test.rs
```

#### Cargo.toml

```toml
[package]
name = "pty-wrapper"
version = "0.1.0"
edition = "2021"

[dependencies]
portable-pty = "0.9"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uuid = { version = "1", features = ["v4"] }
notify = "6"              # 文件监听
signal-hook = "0.3"       # Unix 信号 (macOS/Linux)
ctrlc = "3"               # Windows Ctrl+C
reqwest = { version = "0.12", features = ["blocking", "json"] }
dirs = "5"                # 获取 home 目录

[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = ["consoleapi", "wincon"] }

[dev-dependencies]
tempfile = "3"
```

#### main.rs 完整逻辑

```rust
// pty-wrapper/src/main.rs

mod pty;
mod socket;
mod session;
mod register;
mod terminal;

use std::sync::Arc;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    // 初始化日志
    tracing_subscriber::fmt::init();
    
    let cwd = std::env::current_dir().unwrap();
    tracing::info!("PTY Wrapper starting in: {}", cwd.display());
    
    // 1. 创建 PTY
    let pty_pair = pty::create_pty();
    let master = pty_pair.master.clone();
    
    // 2. 启动 Claude 子进程
    let child = pty::spawn_claude(&pty_pair.slave);
    let child_pid = child.pid();
    tracing::info!("Claude started with PID: {}", child_pid);
    
    // 3. 分配端口
    let port = socket::find_available_port(17528, 17600);
    tracing::info!("Wrapper listening on port: {}", port);
    
    // 4. 启动 Socket 服务
    let socket_listener = socket::start_listener(port);
    
    // 5. 监听 JSONL 文件获取 session_id
    let session_id = session::wait_for_session_id(&cwd);
    tracing::info!("Session ID detected: {}", session_id);
    
    // 6. 向 CC-Island 注册
    register::register_session(&session_id, port, &cwd, child_pid);
    tracing::info!("Registered with CC-Island");
    
    // 7. 设置 resize 处理
    terminal::setup_resize_handler(master.clone());
    
    // 8. 设置信号处理 (Ctrl+C 转发给 Claude)
    setup_signal_handler(child_pid);
    
    // 9. 启动输入合并循环
    let (stdin_tx, input_rx) = mpsc::channel::<String>(64);
    
    // 终端输入任务
    tokio::spawn(terminal::read_stdin(stdin_tx));
    
    // Socket 输入任务
    let socket_tx = input_rx.clone();
    tokio::spawn(socket::handle_connections(socket_listener, socket_tx));
    
    // 主循环: 合并输入写入 PTY
    pty::write_inputs(master, input_rx);
    
    // 10. 等待 Claude 退出
    let exit_status = child.wait();
    
    // 11. 清理: 向 CC-Island 注销
    register::unregister_session(&session_id);
    
    match exit_status {
        Ok(status) => tracing::info!("Claude exited: {}", status),
        Err(e) => tracing::error!("Claude exit error: {}", e),
    }
}

fn setup_signal_handler(child_pid: u32) {
    #[cfg(unix)]
    {
        use signal_hook::consts::SIGINT;
        signal_hook::register(SIGINT, || {
            tracing::info!("SIGINT received, forwarding to Claude");
            // 转发信号给子进程
        }).ok();
    }
    
    #[cfg(windows)]
    {
        ctrlc::set_handler(|| {
            tracing::info!("Ctrl+C received, forwarding to Claude");
        }).ok();
    }
}
```

#### session.rs - JSONL 文件监听

```rust
// pty-wrapper/src/session.rs

use notify::{Watcher, RecursiveMode, EventKind};
use std::path::PathBuf;
use std::time::Duration;

/// 计算 cwd_hash (与 Claude Code 相同算法)
pub fn compute_cwd_hash(cwd: &PathBuf) -> String {
    let cwd_str = cwd.to_string_lossy();
    
    cwd_str
        .replace(':', '-')
        .replace('/', '-')
        .replace('\\', '-')
        .replace(' ', '-')
        .trim_start_matches('-')
        .to_string()
}

/// 监听 JSONL 文件创建，提取 session_id
pub fn wait_for_session_id(cwd: &PathBuf) -> String {
    let cwd_hash = compute_cwd_hash(cwd);
    let claude_dir = dirs::home_dir()
        .unwrap()
        .join(".claude")
        .join("projects")
        .join(&cwd_hash);
    
    // 确保 Claude 目录存在
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir).ok();
    }
    
    tracing::info!("Watching for JSONL in: {}", claude_dir.display());
    
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).unwrap();
    watcher.watch(&claude_dir, RecursiveMode::NonRecursive);
    
    // 超时: 30 秒内必须检测到 session
    let timeout = Duration::from_secs(30);
    let start = std::time::Instant::now();
    
    loop {
        if start.elapsed() > timeout {
            tracing::warn!("Timeout waiting for session_id");
            // 生成临时 ID
            return format!("wrapper-temp-{}", uuid::Uuid::new_v4());
        }
        
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(event) => {
                if let EventKind::Create(_) = event.kind {
                    for path in &event.paths {
                        if path.extension() == Some("jsonl".as_ref()) {
                            let session_id = path
                                .file_name()
                                .unwrap()
                                .to_string_lossy()
                                .replace(".jsonl", "");
                            
                            tracing::info!("Detected new session: {}", session_id);
                            return session_id;
                        }
                    }
                }
            }
            Err(_) => continue,
        }
    }
}
```

#### socket.rs - Socket 服务

```rust
// pty-wrapper/src/socket.rs

use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct InjectRequest {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub session_id: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct InjectResponse {
    pub success: bool,
    pub error: Option<String>,
}

/// 查找可用端口
pub fn find_available_port(base: u16, max: u16) -> u16 {
    for port in base..max {
        if TcpListener::bind(("127.0.0.1", port)).await.is_ok() {
            return port;
        }
    }
    panic!("No available ports");
}

/// 启动 Socket 监听
pub fn start_listener(port: u16) -> TcpListener {
    TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("Failed to bind socket")
}

/// 处理连接
pub async fn handle_connections(
    listener: TcpListener,
    input_tx: mpsc::Sender<String>,
) {
    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                tracing::debug!("Connection from: {}", addr);
                handle_client(stream, input_tx.clone());
            }
            Err(e) => {
                tracing::error!("Accept error: {}", e);
            }
        }
    }
}

async fn handle_client(stream: TcpStream, input_tx: mpsc::Sender<String>) {
    let mut reader = stream;
    let mut buf = vec![0u8; 8192];
    
    match reader.read(&mut buf).await {
        Ok(n) if n > 0 => {
            let json_str = String::from_utf8_lossy(&buf[..n]);
            match serde_json::from_str::<InjectRequest>(&json_str) {
                Ok(req) => {
                    tracing::info!("Inject request: {}", req.content);
                    
                    // 发送内容到 PTY (带换行)
                    input_tx.send(format!("{}\n", req.content)).await.ok();
                    
                    // 发送成功响应
                    let response = InjectResponse { success: true, error: None };
                    let response_json = serde_json::to_string(&response).unwrap();
                    // stream.write_all(response_json.as_bytes()).await.ok();
                }
                Err(e) => {
                    tracing::error!("Parse error: {}", e);
                }
            }
        }
        _ => {}
    }
}
```

#### register.rs - CC-Island 注册

```rust
// pty-wrapper/src/register.rs

use serde_json::json;

pub fn register_session(
    session_id: &str,
    port: u16,
    cwd: &std::path::PathBuf,
    pid: u32,
) {
    let client = reqwest::blocking::Client::new();
    
    let payload = json!({
        "session_id": session_id,
        "port": port,
        "cwd": cwd.to_string_lossy(),
        "pid": pid,
    });
    
    match client
        .post("http://localhost:17527/wrapper_register")
        .json(&payload)
        .timeout(std::time::Duration::from_secs(5))
        .send()
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!("Registration successful");
        }
        Ok(resp) => {
            tracing::warn!("Registration failed: {}", resp.status());
        }
        Err(e) => {
            tracing::error!("Registration error: {}", e);
        }
    }
}

pub fn unregister_session(session_id: &str) {
    let client = reqwest::blocking::Client::new();
    
    let payload = json!({
        "session_id": session_id,
    });
    
    match client
        .post("http://localhost:17527/wrapper_unregister")
        .json(&payload)
        .timeout(std::time::Duration::from_secs(5))
        .send()
    {
        Ok(_) => tracing::info!("Unregistered successfully"),
        Err(e) => tracing::error!("Unregister error: {}", e),
    }
}
```

---

## 消息协议

### Mobile → Cloud

```json
{
  "type": "inject_input",
  "device_token": "abc123",
  "session_id": "uuid-session",
  "content": "帮我检查一下 git 状态",
  "input_type": "text"
}
```

### Cloud → Desktop

```json
{
  "type": "inject_input",
  "device_token": "abc123",
  "session_id": "uuid-session",
  "content": "帮我检查一下 git 状态",
  "input_type": "text"
}
```

### Desktop → PTY Wrapper

```json
{
  "type": "inject_input",
  "session_id": "uuid-session",
  "content": "帮我检查一下 git 状态\n"
}
```

### PTY Wrapper → Desktop（结果）

```json
{
  "type": "inject_result",
  "session_id": "uuid-session",
  "success": true
}
```

---

## 启动流程

### 用户启动 Claude 的方式改变

**原流程：**
```bash
claude
```

**新流程：**
```bash
pty-wrapper claude
```

或者使用 alias：
```bash
# ~/.bashrc 或 ~/.zshrc (macOS/Linux)
alias claude='pty-wrapper claude'

# Windows PowerShell profile
function claude { pty-wrapper.exe claude $args }
```

---

## Session 关联机制（核心）

### 问题

PTY Wrapper 启动 Claude 时，session_id 尚未生成。session_id 是 Claude Code 在 `SessionStart` hook 时生成的，需要建立 Wrapper 与 session_id 的映射。

### 解决方案：监听 JSONL 文件创建

Claude Code 会为每个 session 创建 JSONL 文件：
```
路径: ~/.claude/projects/<cwd-hash>/<session-id>.jsonl
例如: ~/.claude/projects/C--Users-bruceliu/0a3d8baa-3836-4c91-bcba-49c2f6c65c10.jsonl
```

**Wrapper 流程：**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  1. Wrapper 启动                                                          │
│     - 记录 cwd = 当前工作目录                                              │
│     - 计算 cwd_hash (与 Claude Code 相同算法)                             │
│     - 确定监听目录: ~/.claude/projects/<cwd-hash>/                        │
│     - 分配端口 (17528 或动态分配)                                          │
│                                                                          │
│  2. 启动 Claude 子进程                                                     │
│     - 使用 portable-pty 创建 PTY                                          │
│     - 启动 claude 命令                                                    │
│                                                                          │
│  3. 监听 JSONL 文件创建 (使用 notify crate)                               │
│     - 检测到新 .jsonl 文件                                                │
│     - 文件名即为 session_id                                               │
│                                                                          │
│  4. 向 CC-Island 注册                                                      │
│     POST http://localhost:17527/wrapper_register                         │
│     { session_id, port, cwd, pid }                                       │
│                                                                          │
│  5. CC-Island 收到注册请求                                                 │
│     - 建立 session_id → port 映射                                        │
│     - 存储在 InputInjector 中                                             │
│                                                                          │
│  6. 后续 InjectInput 请求                                                  │
│     - 根据 session_id 查找 port                                          │
│     - 连接 Wrapper Socket 并注入                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### cwd_hash 计算方法

与 Claude Code 相同的路径转换算法：

```rust
fn compute_cwd_hash(cwd: &str) -> String {
    // Claude Code 的路径转换规则:
    // - 绝对路径转为项目目录名
    // - 特殊字符替换
    // 示例: "/Users/bruceliu" → "C--Users-bruceliu"
    // 示例: "G:/work/cc-island" → "G--work-cc-island"
    
    let normalized = cwd
        .replace(':', '-')      // Windows 驱动器号
        .replace('/', '-')      // 路径分隔符
        .replace('\\', '-')     // Windows 反斜杠
        .replace(' ', '-');     // 空格
    
    // 移除开头的分隔符
    normalized.trim_start_matches('-').to_string()
}
```

---

## 多实例端口管理

### 端口分配策略

```rust
// Wrapper 启动时动态分配端口
const BASE_PORT: u16 = 17528;
const MAX_PORT: u16 = 17600;  // 允许最多 72 个实例

fn find_available_port() -> u16 {
    for port in BASE_PORT..MAX_PORT {
        if !is_port_in_use(port) {
            return port;
        }
    }
    panic!("No available ports for PTY Wrapper");
}

fn is_port_in_use(port: u16) -> bool {
    // 尝试 bind 端口，失败则表示被占用
    TcpListener::bind(("127.0.0.1", port)).is_err()
}
```

### CC-Island 存储映射

```rust
// src-tauri/src/input_injector.rs
pub struct InputInjector {
    /// session_id → Wrapper 端口
    session_ports: HashMap<String, u16>,
    /// session_id → Claude PID (用于进程状态检测)
    session_pids: HashMap<String, u32>,
}
```

---

## 终端本地输入支持

Wrapper 需同时处理两个输入源：

```rust
// 同时监听终端 stdin 和 Socket
use tokio::io::{AsyncReadExt, AsyncBufReadExt};

async fn handle_inputs(master: PtyMaster, socket_listener: TcpListener) {
    let (stdin_tx, stdin_rx) = mpsc::channel(64);
    
    // 任务1: 监听终端键盘输入
    tokio::spawn(async move {
        let stdin = tokio::io::stdin();
        let mut reader = BufReader::new(stdin);
        let mut line = String::new();
        
        loop {
            reader.read_line(&mut line).await.unwrap();
            stdin_tx.send(line.clone()).await;
            line.clear();
        }
    });
    
    // 任务2: 监听 Socket 注入输入
    tokio::spawn(async move {
        while let Ok((stream, _)) = socket_listener.accept().await {
            // 处理远程注入...
        }
    });
    
    // 主循环: 合并输入写入 PTY
    loop {
        tokio::select! {
            // 终端输入
            input = stdin_rx.recv() => {
                master.write_all(input.unwrap().as_bytes());
            }
            // Socket 注入
            inject = socket_rx.recv() => {
                master.write_all(inject.unwrap().content.as_bytes());
                master.write_all(b"\n");
            }
        }
    }
}
```

---

## 终端 Resize 支持

用户调整终端窗口时，Wrapper 需同步 PTY 大小：

```rust
use portable_pty::{PtySize};

// 监听终端 resize 信号
fn setup_resize_handler(master: PtyMaster) {
    // Unix: SIGWINCH 信号
    #[cfg(unix)]
    {
        signal_hook::register(signal_hook::consts::SIGWINCH, || {
            let (cols, rows) = get_terminal_size();
            master.resize(PtySize { rows, cols });
        });
    }
    
    // Windows: 需要定期检查终端大小
    #[cfg(windows)]
    {
        tokio::spawn(async move {
            let mut last_size = get_terminal_size();
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let new_size = get_terminal_size();
                if new_size != last_size {
                    master.resize(PtySize { 
                        rows: new_size.1, 
                        cols: new_size.0 
                    });
                    last_size = new_size;
                }
            }
        });
    }
}
```

---

## 进程生命周期管理

### Wrapper 与 Claude 同步退出

```rust
// Wrapper 等待 Claude 子进程结束
fn main() {
    // ...启动 PTY、Socket 等...
    
    // 等待 Claude 子进程
    let exit_status = child.wait();
    
    // Claude 退出后，清理资源
    cleanup();
    
    // Wrapper 也退出
    match exit_status {
        Ok(status) => {
            if status.success() {
                tracing::info!("Claude exited normally");
            } else {
                tracing::warn!("Claude exited with error: {}", status);
            }
        }
        Err(e) => {
            tracing::error!("Failed to wait for Claude: {}", e);
        }
    }
}
```

### 异常退出处理

```rust
// Claude 异常退出时通知 CC-Island
fn cleanup_before_exit(session_id: &str) {
    // 通知 CC-Island 注销 session
    let client = reqwest::blocking::Client::new();
    let _ = client.post("http://localhost:17527/wrapper_unregister")
        .json(&serde_json::json!({ "session_id": session_id }))
        .send();
}
```

---

## Wrapper 注册 API

### CC-Island 新增 HTTP Endpoint

```
POST /wrapper_register
Body: { session_id: string, port: u16, cwd: string, pid: u32 }
Response: { success: boolean }

POST /wrapper_unregister  
Body: { session_id: string }
Response: { success: boolean }
```

### http_server.rs 改动

```rust
// 新增路由
.route("/wrapper_register", post(handle_wrapper_register))
.route("/wrapper_unregister", post(handle_wrapper_unregister))

async fn handle_wrapper_register(
    State(state): State<Arc<RwLock<AppState>>,
    Json(payload): Json<WrapperRegisterRequest>,
) -> Json<serde_json::Value> {
    tracing::info!("Wrapper register: session={}, port={}, pid={}",
        payload.session_id, payload.port, payload.pid);
    
    let mut state_guard = state.write();
    if let Some(ref injector) = state_guard.input_injector {
        injector.register_session(&payload.session_id, payload.port, payload.pid);
    }
    
    Json(serde_json::json!({ "success": true }))
}
```

---

## 信号处理

用户 Ctrl+C 时，转发给 Claude 子进程，而不是 Wrapper 自己退出：

```rust
#[cfg(unix)]
fn setup_signal_handler(child_pid: u32) {
    use signal_hook::consts::SIGINT;
    
    signal_hook::register(SIGINT, || {
        // 转发 SIGINT 给 Claude 子进程
        kill(child_pid, SIGINT);
    });
}

#[cfg(windows)]
fn setup_signal_handler(child: &mut Child) {
    // Windows 使用 ctrlc crate
    ctrlc::set_handler(move || {
        // 不退出 Wrapper，只记录
        tracing::info!("Ctrl+C received, forwarding to Claude...");
    });
}
```

---

## 语音输入方案

### 方案 A：Web Speech API（推荐）

**优点：**
- 浏览器原生，无需额外 API
- 免费使用
- 支持 iOS Safari 和 Android Chrome

**实现：**
```tsx
const recognition = new webkitSpeechRecognition()
recognition.lang = 'zh-CN'  // 中文
recognition.onresult = (e) => {
  setInputText(e.results[0][0].transcript)
}
recognition.start()
```

**兼容性：**
- iOS Safari 14.5+ ✅
- Android Chrome ✅
- iOS App (Capacitor) 需要额外插件

### 方案 B：Capacitor Speech Recognition Plugin

如果 Web Speech API 在 Capacitor App 中不工作：

```bash
npm install capacitor-speech-recognition
```

---

## 实现步骤

### Phase 1: PTY Wrapper 核心

**目标：**
- 实现 `pty-wrapper` 二进制文件
- PTY 创建 + 子进程启动
- Socket 服务监听
- 输入注入 + 输出透传

**预计工作量：** 2-3 天

### Phase 2: Desktop 集成

**目标：**
- 新增 `input_injector.rs`
- Cloud Client 处理 `InjectInput`
- Session 注册机制

**预计工作量：** 1 天

### Phase 3: Cloud Server 改动

**目标：**
- 新增 `InjectInput` / `InjectResult` 消息类型
- Handler 转发逻辑

**预计工作量：** 0.5 天

### Phase 4: Mobile App 改动

**目标：**
- ChatView 添加输入框
- WebSocket Hook 新增方法
- 语音输入集成

**预计工作量：** 1-2 天

---

## 安全考虑

1. **Wrapper 仅监听 localhost**：外部无法直接访问
2. **可选 Token 认证**：Desktop 与 Wrapper 通信时验证
3. **内容限制**：限制单次输入长度（如 1000 字符）
4. **频率限制**：防止频繁注入造成 Claude 过载

---

## 下一步

确认方案后，按以下顺序实现：

1. ✅ 创建 `pty-wrapper/` 目录
2. ✅ 实现 PTY 核心功能
3. ✅ 实现 Socket 服务
4. ✅ Desktop 集成 InputInjector
5. ✅ Cloud Server 消息处理
6. ✅ Mobile App 输入框