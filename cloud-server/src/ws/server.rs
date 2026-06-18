use std::sync::Arc;
use socketioxide::SocketIo;
use socketioxide_postgres::{PostgresAdapterCtr, SqlxAdapter};
use sqlx::PgPool;
use serde::Deserialize;
use socketioxide::extract::{SocketRef, Data};
use crate::db::repository::Repository;
use crate::ws::events::*;
use crate::ws::handlers;

type Adapter = SqlxAdapter<socketioxide::adapter::Emitter>;

#[derive(Debug, Clone, Deserialize)]
struct DesktopAuth {
    device_token: String,
    hostname: Option<String>,
    device_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct MobileAuth {
    device_tokens: Vec<String>,
}

/// Build the Socket.IO server with all namespaces and the PostgreSQL adapter.
pub async fn build_socketio_server(
    pool: PgPool,
    repo: Repository,
) -> anyhow::Result<(socketioxide::layer::SocketIoLayer<Adapter>, SocketIo<Adapter>)> {
    let adapter = PostgresAdapterCtr::new_with_sqlx(pool.clone());
    let repo = Arc::new(repo);

    let (layer, io) = SocketIo::builder()
        .with_adapter::<Adapter>(adapter)
        .build_layer();

    // /hooks namespace: hook relay, chat history, session list — all device communication
    {
        let repo = repo.clone();
        tokio::spawn(io.ns("/hooks", move |s: SocketRef<Adapter>| {
            let repo = repo.clone();
            async move {
                s.extensions.insert(repo);
                s.on("hook", handlers::hooks::on_hook);
                s.on("hook:response", handlers::hooks::on_hook_response);
                s.on("popup:resolved", handlers::hooks::on_popup_resolved);
                s.on("history", handlers::chat::on_history);
                s.on("history:request", handlers::chat::on_history_request);
                s.on("list:request", handlers::sessions::on_list_request);
                s.on("list:response", handlers::sessions::on_list_response);
            }
        }));
    }

    // Default namespace (/) — auth + room join
    {
        let repo = repo.clone();
        tokio::spawn(io.ns("/", move |s: SocketRef<Adapter>, Data(auth): Data<serde_json::Value>| {
            let repo = repo.clone();
            async move {
                s.extensions.insert(repo.clone());

                // Try Desktop auth
                if let Ok(desktop) = serde_json::from_value::<DesktopAuth>(auth.clone()) {
                    let token = desktop.device_token.clone();
                    repo.upsert_device(&token, desktop.hostname.as_deref(), desktop.device_name.as_deref()).await.ok();
                    let room = format!("device:{}", token);
                    s.join(room.clone());

                    let _ = s.emit("auth_success", &serde_json::json!({
                        "device_id": token,
                        "hostname": desktop.hostname,
                    }));

                    let _ = s.within(room).emit("online", &DeviceOnlinePayload {
                        device: DeviceInfo { token, hostname: desktop.hostname, registered_at: None, online: true },
                    }).await;
                    return;
                }

                // Try Mobile auth
                if let Ok(mobile) = serde_json::from_value::<MobileAuth>(auth.clone()) {
                    for token in &mobile.device_tokens {
                        s.join(format!("device:{}", token));
                    }

                    let _ = s.emit("auth_success", &serde_json::json!({
                        "device_id": s.id.to_string(),
                        "subscriptions": mobile.device_tokens,
                    }));

                    if let Ok(devices) = repo.get_online_devices().await {
                        let _ = s.emit("list", &DeviceListPayload { devices });
                    }
                    return;
                }

                let _ = s.emit("auth_error", &serde_json::json!({"reason": "invalid auth payload"}));
                let _ = s.disconnect();
            }
        }));
    }

    Ok((layer, io))
}
