use socketioxide::extract::{SocketRef, Data};
use serde::{Deserialize, Serialize};
use crate::db::repository::Repository;
use crate::ws::events::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopAuth {
    device_token: String,
    hostname: Option<String>,
    device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MobileAuth {
    device_tokens: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AuthState {
    pub connection_type: ConnectionType,
    pub device_token: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionType {
    Desktop,
    Mobile,
}

pub async fn auth_middleware(s: SocketRef, Data(data): Data<serde_json::Value>) -> Result<(), socketioxide::extract::Error> {
    let repo = s.extensions().get::<Repository>()
        .ok_or_else(|| socketioxide::extract::Error::new("Repository not in extensions"))?;

    // Try Desktop auth
    if let Ok(desktop) = serde_json::from_value::<DesktopAuth>(data.clone()) {
        let device_token = desktop.device_token.clone();

        repo.upsert_device(&device_token, desktop.hostname.as_deref(), desktop.device_name.as_deref())
            .await
            .map_err(|e| {
                tracing::error!("Failed to upsert device: {}", e);
                socketioxide::extract::Error::new("db error")
            })?;

        s.extensions().insert(AuthState {
            connection_type: ConnectionType::Desktop,
            device_token: Some(device_token.clone()),
            hostname: desktop.hostname.clone(),
        });

        let _ = s.join(format!("device:{}", device_token)).await;

        let _ = s.emit("auth_success", &serde_json::json!({
            "device_id": device_token,
            "hostname": desktop.hostname,
        })).await;

        let _ = s.within("/devices").broadcast().emit("online", &DeviceOnlinePayload {
            device: DeviceInfo {
                token: device_token,
                hostname: desktop.hostname,
                registered_at: None,
                online: true,
            },
        }).await;

        return Ok(());
    }

    // Try Mobile auth
    if let Ok(mobile) = serde_json::from_value::<MobileAuth>(data.clone()) {
        s.extensions().insert(AuthState {
            connection_type: ConnectionType::Mobile,
            device_token: None,
            hostname: None,
        });

        let conn_id = s.id.to_string();

        for token in &mobile.device_tokens {
            let _ = s.join(format!("device:{}", token)).await;
        }

        let _ = s.emit("auth_success", &serde_json::json!({
            "device_id": conn_id,
            "subscriptions": mobile.device_tokens,
        })).await;

        return Ok(());
    }

    let _ = s.emit("auth_error", &serde_json::json!({"reason": "invalid auth payload"})).await;
    let _ = s.disconnect().await;
    Err(socketioxide::extract::Error::new("auth failed"))
}
