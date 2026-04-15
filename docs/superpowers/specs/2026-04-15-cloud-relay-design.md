# CC-Island 云转发架构设计文档

> 日期：2026-04-15
> 状态：设计完成，待用户确认

## 一、项目背景

### 现有架构问题

当前CC-Island采用**局域网直连模式**：
- 桌面端作为WebSocket服务器（端口17528）
- 移动端直接连接桌面端IP地址
- 局限性：手机和电脑必须在同一WiFi，或需要公网IP/内网穿透

### 目标

设计**云转发架构**，实现：
- 公网环境下移动设备可访问CC-Island
- 支持多用户、多设备（SaaS模式）
- 设备严格隔离，每个设备只有owner可访问
- 移动端实时接收状态更新、弹窗审批
- 系统推送通知支持（熄屏状态下也能收到）

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         云服务器 (VPS)                               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                  WebSocket 转发服务                            │ │
│  │                                                               │ │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐   │ │
│  │   │ 连接管理器  │───▶│ 路由分发器  │───▶│ 状态缓存模块   │   │ │
│  │   │ (管理所有WS)│    │(按token路由)│    │(实例/弹窗缓存) │   │ │
│  │   └─────────────┘    └─────────────┘    └─────────────────┘   │ │
│  │          │                  │                    │            │ │
│  │   ┌─────────────────────────────────────────────────────┐    │ │
│  │   │               推送网关 (FCM/APNs)                    │    │ │
│  │   │       熄屏/后台时发送系统推送通知                     │    │ │
│  │   └─────────────────────────────────────────────────────┘    │ │
│  │          │                  │                    │            │ │
│  │   ┌─────────────────────────────────────────────────────┐    │ │
│  │   │                   PostgreSQL                        │    │ │
│  │   │  tables: devices, sessions, popups, chat_messages   │    │ │
│  │   │           popup_responses, mobile_push_tokens       │    │ │
│  │   └─────────────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  端口: WebSocket 17528, REST API 17529 (可选管理接口)              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
            │                                      │
            │ WebSocket (主动连接)                 │ WebSocket (主动连接)
            ▼                                      ▼
    ┌──────────────────┐                  ┌──────────────────┐
    │  CC-Island桌面端 │                  │   移动端 App     │
    │                  │                  │                  │
    │ 1. 连接云服务器   │                  │ 1. 输入设备token │
    │ 2. 发送状态更新   │────(云转发)────▶│ 2. 连接云服务器  │
    │ 3. 接收审批响应   │◀────(云转发)────│ 3. 接收实时状态  │
    │ 4. 推送聊天消息   │                  │ 4. 发送审批决策  │
    └──────────────────┘                  └──────────────────┘
```

### 核心流程

1. **桌面端启动** → 连接云服务器 → 自动注册（本地生成的device_token）
2. **桌面端状态变化** → 推送到云 → 云缓存并转发给订阅该token的移动端
3. **移动端审批** → 发送到云 → 云转发给对应桌面端
4. **移动端离线时** → 云通过FCM/APNs发送系统推送通知

---

## 三、数据模型设计

### PostgreSQL Schema

```sql
-- 设备表：每个CC-Island实例注册一个设备
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT UNIQUE NOT NULL,     -- 设备唯一标识（机器硬件特征计算）
    name TEXT,                              -- 设备名称（可选，用户自定义）
    status TEXT DEFAULT 'offline',          -- online/offline
    last_seen_at TIMESTAMPTZ,               -- 最后活跃时间（心跳检测）
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会话表：Claude会话状态缓存
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL REFERENCES devices(device_token),
    session_id TEXT NOT NULL,               -- Claude session ID
    project_name TEXT,
    status TEXT NOT NULL,                   -- idle/thinking/working/waiting/ended
    current_tool TEXT,
    tool_input JSONB,                       -- 工具输入详情
    started_at TIMESTAMPTZ,
    updated_at TIMSTAMPTZ DEFAULT NOW(),
    
    UNIQUE(device_token, session_id)
);

-- 弹窗表：待审批弹窗缓存
CREATE TABLE popups (
    id TEXT PRIMARY KEY,                    -- popup_id（来自桌面端）
    device_token TEXT NOT NULL REFERENCES devices(device_token),
    session_id TEXT,
    project_name TEXT,
    type TEXT NOT NULL,                     -- permission/ask/notification
    data JSONB NOT NULL,                    -- permission_data 或 ask_data
    status TEXT DEFAULT 'pending',          -- pending/resolved/timeout
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    
    INDEX idx_popups_device_status (device_token, status)
);

-- 弹窗响应表：记录审批结果
CREATE TABLE popup_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    popup_id TEXT NOT NULL REFERENCES popups(id),
    device_token TEXT NOT NULL,
    decision TEXT,                          -- allow/deny
    answers JSONB,                          -- AskUserQuestion的答案
    responded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 聊天消息表：JSONL解析后的完整对话内容
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    session_id TEXT NOT NULL,               -- Claude session ID
    message_id TEXT NOT NULL,               -- JSONL中的uuid
    
    role TEXT NOT NULL,                     -- user/assistant
    timestamp TIMESTAMPTZ NOT NULL,
    
    -- 消息内容块（JSON数组）
    content JSONB NOT NULL,                 -- [{type: 'text', data: '...'}, ...]
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(device_token, session_id, message_id),
    INDEX idx_chat_session (device_token, session_id, timestamp)
);

-- 移动端推送token表（用于系统推送）
CREATE TABLE mobile_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,             -- 绑定的桌面端设备
    mobile_id TEXT NOT NULL,                -- 移动端唯一标识
    push_token TEXT NOT NULL,               -- FCM/APNs token
    platform TEXT NOT NULL,                 -- android/ios
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(device_token, mobile_id)
);
```

### 数据清理策略

| 表 | 清理策略 |
|----|----------|
| `popups` | resolved后保留24小时，自动删除 |
| `popup_responses` | 保留7天 |
| `chat_messages` | ended状态的session保留3天后删除 |
| `sessions` | ended状态保留7天，自动删除 |
| `devices` | 离线超过30天，标记为inactive |

---

## 四、WebSocket消息类型定义

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CloudMessage {
    // ===== 认证类 =====
    
    #[serde(rename = "device_register")]
    DeviceRegister {
        device_token: String,
        device_name: Option<String>,
    },
    
    #[serde(rename = "mobile_auth")]
    MobileAuth {
        device_token: String,
    },
    
    #[serde(rename = "auth_success")]
    AuthSuccess { 
        device_id: String,
        device_name: Option<String>,
    },
    
    #[serde(rename = "auth_failed")]
    AuthFailed { reason: String },
    
    // ===== 桌面端 -> 云服务器 =====
    
    #[serde(rename = "state_update")]
    StateUpdate {
        device_token: String,
        sessions: Vec<SessionState>,
        popups: Vec<PopupState>,
    },
    
    #[serde(rename = "new_popup")]
    NewPopup {
        device_token: String,
        popup: PopupState,
    },
    
    #[serde(rename = "popup_resolved")]
    PopupResolved {
        device_token: String,
        popup_id: String,
    },
    
    #[serde(rename = "session_ended")]
    SessionEnded {
        device_token: String,
        session_id: String,
    },
    
    #[serde(rename = "chat_messages")]
    ChatMessages {
        device_token: String,
        session_id: String,
        messages: Vec<ChatMessage>,
    },
    
    #[serde(rename = "ping")]
    Ping,
    
    // ===== 云服务器 -> 移动端 =====
    
    #[serde(rename = "initial_state")]
    InitialState {
        sessions: Vec<SessionState>,
        popups: Vec<PopupState>,
    },
    
    #[serde(rename = "state_update")]
    StateUpdateFromDevice {
        sessions: Vec<SessionState>,
        popups: Vec<PopupState>,
    },
    
    #[serde(rename = "new_popup")]
    NewPopupFromDevice { popup: PopupState },
    
    #[serde(rename = "new_chat")]
    NewChat {
        session_id: String,
        messages: Vec<ChatMessage>,
    },
    
    #[serde(rename = "chat_history")]
    ChatHistory {
        session_id: String,
        messages: Vec<ChatMessage>,
    },
    
    // ===== 移动端 -> 云服务器 =====
    
    #[serde(rename = "respond_popup")]
    RespondPopup {
        device_token: String,
        popup_id: String,
        decision: Option<String>,
        answers: Option<Vec<Vec<String>>>,
    },
    
    #[serde(rename = "request_chat_history")]
    RequestChatHistory {
        device_token: String,
        session_id: String,
        limit: Option<u32>,
    },
    
    #[serde(rename = "register_push_token")]
    RegisterPushToken {
        device_token: String,
        mobile_id: String,
        push_token: String,
        platform: String,
    },
    
    // ===== 云服务器 -> 桌面端 =====
    
    #[serde(rename = "popup_response")]
    PopupResponse {
        popup_id: String,
        decision: Option<String>,
        answers: Option<Vec<Vec<String>>>,
    },
    
    #[serde(rename = "pong")]
    Pong,
}
```

### 消息流向

| 来源 | 目标 | 消息类型 |
|------|------|----------|
| 桌面端 | 云服务器 | `device_register`, `state_update`, `new_popup`, `chat_messages`, `ping` |
| 云服务器 | 桌面端 | `auth_success`, `popup_response`, `pong` |
| 移动端 | 云服务器 | `mobile_auth`, `respond_popup`, `request_chat_history`, `register_push_token` |
| 云服务器 | 移动端 | `auth_success`, `initial_state`, `state_update`, `new_popup`, `new_chat`, `chat_history` |

---

## 五、云服务器组件架构

### 项目结构

```
cloud-server/src/
├── main.rs                    # 入口，启动所有服务
├── config.rs                  # 配置管理
├── db/
│   ├── mod.rs
│   ├── pool.rs                # PostgreSQL连接池
│   ├── models.rs              # 数据模型
│   └── repository.rs          # 数据库操作（CRUD）
├── ws/
│   ├── mod.rs
│   ├── server.rs              # WebSocket服务器主逻辑
│   ├── connection.rs          # 单个连接处理
│   ├── router.rs              # 消息路由分发
│   └── handler.rs             # 消息处理器
├── cache/
│   ├── mod.rs
│   ├── state_cache.rs         # 实例/弹窗状态缓存
│   └── device_state.rs        # 单设备状态结构
├── push/
│   ├── mod.rs
│   ├── gateway.rs             # 推送网关（FCM/APNs）
│   ├── fcm.rs                 # Firebase Cloud Messaging
│   └── apns.rs                # Apple Push Notification
└── messages.rs                # 消息类型定义
```

### 核心路由逻辑

```rust
pub struct ConnectionRouter {
    // device_token -> 桌面端连接
    device_connections: HashMap<String, Sender<Message>>,
    
    // device_token -> 移动端连接列表
    mobile_connections: HashMap<String, Vec<Sender<Message>>>,
}

impl ConnectionRouter {
    // 桌面端推送状态 -> 转发给所有订阅该设备的移动端
    pub fn broadcast_to_mobiles(&self, device_token: &str, msg: Message) {
        if let Some(mobiles) = self.mobile_connections.get(device_token) {
            for sender in mobiles {
                sender.try_send(msg.clone());
            }
        }
    }
    
    // 移动端审批响应 -> 转发给对应的桌面端
    pub fn send_to_device(&self, device_token: &str, msg: Message) {
        if let Some(sender) = self.device_connections.get(device_token) {
            sender.try_send(msg);
        }
    }
    
    // 检查移动端是否在线
    pub fn is_mobile_online(&self, device_token: &str) -> bool {
        self.mobile_connections.get(device_token)
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }
}
```

---

## 六、桌面端改动设计

### 新增/修改文件

```
src-tauri/src/
├── websocket_server.rs          # 现有：本地WebSocket服务器
│   └── 改为：可选本地模式 或 云转发模式
│
├── cloud_client.rs              # 新增：云服务器WebSocket客户端
│
├── config.rs                    # 改动：新增云转发配置项
│
├── lib.rs                       # 改动：根据配置选择模式
```

### device_token生成机制（机器唯一ID）

为确保卸载重装后token不变，采用**基于机器硬件特征生成稳定token**的方案。

#### 各平台机器唯一标识来源

| 平台 | 来源 | 说明 |
|------|------|------|
| **Linux** | `/etc/machine-id` | systemd生成的机器唯一ID，重装系统才会变 |
| **Windows** | 注册表 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | Windows安装时生成 |
| **macOS** | `IOPlatformUUID` | Apple硬件UUID，主板绑定 |

#### Rust实现

```rust
use std::hash::{Hash, Hasher};
use twox_hash::XxHash64;

pub fn get_machine_token() -> String {
    let machine_id = get_platform_machine_id();
    
    let mut hasher = XxHash64::with_seed(42);
    machine_id.hash(&mut hasher);
    let hash = hasher.finish();
    
    format_uuid_from_hash(hash)
}

fn get_platform_machine_id() -> String {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/machine-id")
            .unwrap_or_else(|_| {
                std::fs::read_to_string("/var/lib/dbus/machine-id")
                    .unwrap_or_else(|_| fallback_machine_id())
            })
            .trim()
            .to_string()
    }
    
    #[cfg(target_os = "windows")]
    {
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").unwrap();
        key.get_value("MachineGuid").unwrap()
    }
    
    #[cfg(target_os = "macos")]
    {
        use system_information;
        let info = system_information::get_system_info();
        info.platform_uuid.clone()
    }
}

fn fallback_machine_id() -> String {
    // 兜底：MAC地址 + hostname组合
    let mac = get_primary_mac_address();
    let hostname = get_hostname();
    format!("{}-{}", mac, hostname)
}
```

#### 依赖库

```toml
[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"

[target.'cfg(target_os = "macos")'.dependencies]
system-information = "0.1"

[dependencies]
twox-hash = "1.6"
```

#### 稳定性验证

| 场景 | token变化 |
|------|-----------|
| 应用卸载重装 | ✅ 不变 |
| 应用更新 | ✅ 不变 |
| 系统重装 | ❌ 变化 |
| 换电脑 | ❌ 变化 |

### 配置项新增

```rust
pub struct AppSettings {
    // ...现有字段...
    
    // 云转发配置
    pub cloud_mode: bool,                    // false = 本地模式, true = 云转发
    pub cloud_server_url: Option<String>,    // 如 "wss://cloud.example.com:17528"
    pub device_name: Option<String>,         // 用户自定义设备名称
    // 注意：device_token不存储在配置中，由机器硬件特征实时计算
}
```

### device_token获取逻辑

```rust
// 每次启动时从机器硬件特征计算，无需存储
fn get_device_token() -> String {
    get_machine_token()  // 基于机器唯一ID计算
}
```

### Settings UI新增

```
云转发配置区块：

┌─────────────────────────────────────┐
│ 云转发配置                          │
├─────────────────────────────────────┤
│ ☑ 启用云转发模式                   │
│                                     │
│ 云服务器地址:                       │
│ [wss://cloud.example.com:17528    ]│
│                                     │
│ 设备Token (用于移动端连接):         │
│ [a1b2c3d4-e5f6-7890-abcd-ef123456] │
│ [复制] [二维码]                     │
│                                     │
│ 设备名称 (可选):                    │
│ [家里电脑                        ] │
└─────────────────────────────────────┘
```

---

## 七、移动端App改动设计

### 新增/修改文件

```
mobile-app/src/
├── App.tsx                      # 改动：增加云模式入口
├── hooks/
│   ├── useWebSocket.ts          # 现有：本地WebSocket hook
│   ├── useCloudWebSocket.ts     # 新增：云服务器WebSocket hook
│   └── usePushNotification.ts   # 新增：系统推送通知hook
├── components/
│   ├── DeviceList.tsx           # 新增：多设备列表页
│   ├── DeviceDetailPage.tsx     # 新增：单设备详情页
│   ├── ChatView.tsx             # 新增：聊天历史查看
│   ├── AddDeviceModal.tsx       # 新增：添加设备（扫码/输入token）
│   └── SettingsModal.tsx        # 改动：新增云服务器地址配置
└── types.ts                     # 改动：适配新消息类型
```

### App入口逻辑

```tsx
function App() {
  const [mode, setMode] = useState<'local' | 'cloud'>('cloud');
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  
  return (
    <>
      {mode === 'cloud' ? (
        activeDevice ? (
          <DeviceDetailPage 
            deviceToken={activeDevice}
            onBack={() => setActiveDevice(null)}
          />
        ) : (
          <DeviceListPage 
            onSelectDevice={setActiveDevice}
          />
        )
      ) : (
        <LocalConnectionPage />
      )}
    </>
  );
}
```

### 设备详情页核心功能

- 实时状态更新（WebSocket订阅）
- 弹窗审批（发送`respond_popup`消息）
- 聊天历史查看（请求`chat_history`）
- 系统推送通知注册

---

## 八、移动端推送通知设计

### 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         云服务器                                │
│                                                                │
│  规则：                                                        │
│  - 桌面端推送new_popup时                                        │
│  - 检查移动端WebSocket是否在线                                  │
│  - 若在线：直接WS推送                                          │
│  - 若不在线：通过FCM/APNs推送系统通知                           │
│                                                                │
│  ┌─────────────────┐              ┌─────────────────┐         │
│  │ 推送网关服务    │──────────────▶│ Firebase Cloud  │──▶ Android │
│  │ (FCM/APNs)     │──────────────▶│ Apple Push      │──▶ iOS     │
│  └─────────────────┘              └─────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### 推送网关核心逻辑

```rust
pub async fn send_popup_notification(
    device_token: &str,
    popup: &PopupState,
    mobile_ws_online: bool,
) {
    if mobile_ws_online {
        return; // WebSocket已推送
    }
    
    let title = format!("{} 需要审批", popup.project_name);
    let body = popup.summary();
    
    let push_tokens = get_mobile_push_tokens(device_token);
    
    for push_token in push_tokens {
        match push_token.platform {
            "android" => fcm_client.send(&push_token.token, title, body, popup_data),
            "ios" => apns_client.send(&push_token.token, title, body, popup_data),
        }
    }
}
```

### Capacitor推送配置

```typescript
// capacitor.config.ts
plugins: {
  PushNotifications: {
    presentationOptions: ['badge', 'sound', 'alert'],
  },
}
```

### 移动端注册推送Token

```typescript
// App启动时
PushNotifications.register();
PushNotifications.addListener('registration', (token) => {
  sendPushTokenToCloud(deviceToken, token.value);
});
```

---

## 九、部署和运维方案

### VPS推荐配置

| 配置 | 规格 | 月费 |
|------|------|------|
| MVP验证 | 1核/1GB/10GB | $5-10 |
| 正常运营 | 2核/2GB/20GB | $10-20 |

### Docker Compose

```yaml
services:
  cloud-server:
    build: ./cloud-server
    ports: ["17528:17528"]
    depends_on: [postgres]
    
  postgres:
    image: postgres:15-alpine
    volumes: [postgres_data:/var/lib/postgresql/data]
    
  admin-api:
    build: ./admin-api
    ports: ["17529:17529"]
    depends_on: [postgres]
```

### HTTPS/WSS配置

推荐使用Nginx反向代理：
- SSL证书（Let's Encrypt免费）
- WebSocket代理（wss://domain.com → ws://localhost:17528）

### 数据备份

- 每日pg_dump自动备份
- 保留7天
- 上传到对象存储

---

## 十、技术栈总结

| 层面 | 技术 |
|------|------|
| 云服务器 | Rust + tokio + tokio-tungstenite + sqlx |
| 数据库 | PostgreSQL 15 |
| 桌面端 | Rust + WebSocket客户端（改动现有代码） |
| 移动端 | Capacitor + React + TypeScript |
| 推送通知 | Firebase Cloud Messaging + Apple Push Notification |
| 部署 | Docker Compose + Nginx |
| HTTPS | Let's Encrypt + Nginx |

---

## 十一、实现优先级

### Phase 1：MVP核心功能

1. 云服务器WebSocket转发服务
2. PostgreSQL数据存储
3. 桌面端云客户端（状态推送）
4. 移动端云模式连接（状态接收、审批发送）

### Phase 2：完整功能

1. 聊天消息推送（JSONL监听）
2. 移动端ChatView页面
3. 设备二维码生成

### Phase 3：推送通知

1. FCM/APNs集成
2. 移动端推送token注册
3. 离线时系统推送

---

## 十二、风险和注意事项

1. **安全性**：device_token是唯一认证凭证，需妥善保管
2. **扩展性**：路由器设计支持后续添加权限系统
3. **可靠性**：心跳检测确保连接状态准确，离线时启用推送
4. **成本**：VPS+带宽+推送服务，月成本约$10-30