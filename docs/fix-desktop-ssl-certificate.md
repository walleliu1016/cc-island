# Desktop SSL证书验证修复方案

## 问题：Desktop无法连接自签名证书的WSS服务器

---

## 当前代码问题

**Desktop (src-tauri/src/cloud_client.rs 第91行)：**
```rust
connect_async(&server_url)  // 默认严格验证SSL证书
```

**Cloud Server：**
- 没有SSL/TLS配置
- 只监听 `ws://`，需要通过Nginx反向代理提供SSL

---

## 修复方案：添加自定义TLS Connector

### 方案1：使用native-tls（推荐，简单）

**修改 Cargo.toml：**
```toml
# src-tauri/Cargo.toml
[dependencies]
tokio-tungstenite = { version = "0.26", features = ["native-tls"] }
native-tls = "0.2"
```

**修改 cloud_client.rs：**
```rust
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::protocol::Message};
use tokio_tungstenite::Connector;
use native_tls::TlsConnector;

// 修改 connect 函数（第80-92行）
pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
    let server_url = self.config.server_url.clone();

    tracing::info!("Connecting to cloud server: {}", server_url);

    // 创建忽略证书验证的TLS connector
    let connector = if server_url.starts_with("wss://") {
        let tls_connector = TlsConnector::builder()
            .danger_accept_invalid_certs(true)  // 允许无效证书
            .danger_accept_invalid_hostnames(true)  // 允许无效主机名
            .build()
            .expect("Failed to create TLS connector");

        Some(Connector::NativeTls(tls_connector))
    } else {
        None  // ws:// 连接不需要TLS
    };

    // Connect WebSocket with custom TLS config and 5 second timeout
    let connect_result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        connect_async_tls_with_config(&server_url, connector, None)
    ).await;

    let (ws_stream, _) = match connect_result {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => return Err(format!("Connection refused: {}", e).into()),
        Err(_) => return Err("Connection timeout after 5 seconds".into()),
    };

    // ... 后续代码不变
}
```

---

### 方案2：使用rustls（更现代，但复杂）

**修改 Cargo.toml：**
```toml
# src-tauri/Cargo.toml
[dependencies]
tokio-tungstenite = { version = "0.26", features = ["rustls-tls-native-roots"] }
rustls = "0.23"
```

**修改 cloud_client.rs：**
```rust
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::protocol::Message};
use tokio_tungstenite::Connector;
use rustls::ClientConfig;
use rustls::crypto::ring::default_provider;
use std::sync::Arc;

// 修改 connect 函数
pub async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
    let server_url = self.config.server_url.clone();

    tracing::info!("Connecting to cloud server: {}", server_url);

    // 创建忽略证书验证的rustls config
    let connector = if server_url.starts_with("wss://") {
        let mut config = ClientConfig::builder()
            .with_safe_defaults()
            .with_custom_certificate_verifier(Arc::new(SkipServerVerification));

        Some(Connector::Rustls(Arc::new(config)))
    } else {
        None
    };

    // Connect WebSocket
    let connect_result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        connect_async_tls_with_config(&server_url, connector, None)
    ).await;

    // ... 后续代码不变
}

// 自定义证书验证器（跳过验证）
struct SkipServerVerification;

impl rustls::client::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer,
        _intermediates: &[rustls::pki_types::CertificateDer],
        _server_name: &rustls::pki_types::ServerName,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::ServerCertVerified::assertion())
    }
}
```

---

## 推荐方案

**使用方案1（native-tls）**，因为：
- 简单，只需添加几行代码
- native-tls使用操作系统原生TLS库（Windows使用SChannel）
- 兼容性好，性能稳定

---

## 注意事项

**安全性警告：**
- `danger_accept_invalid_certs(true)` 会降低安全性
- 仅适用于内网测试环境
- 生产环境建议使用正规SSL证书

**替代方案：**
- 使用公网认可的SSL证书（Let's Encrypt等）
- 或将内网CA证书添加到系统信任列表
- 这样就不需要忽略证书验证

---

## 测试验证

**修改后测试：**
1. 重新编译Desktop：`pnpm tauri:build`
2. 启动Desktop，配置 `wss://...` 地址
3. 查看日志是否显示 "Cloud authentication successful"

---

## Nginx配置参考

**确保Nginx正确转发WebSocket：**
```nginx
location /lynel/ws {
    proxy_pass http://localhost:17528;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;  # WebSocket长连接超时
}
```