use socketioxide::extract::SocketRef;
use crate::db::repository::Repository;
use crate::ws::events::*;

pub async fn on_connect(s: SocketRef) {
    let repo = s.extensions().get::<Repository>().expect("Repo missing");

    let devices = repo.get_online_devices().await.unwrap_or_default();
    let device_list: Vec<DeviceInfo> = devices.into_iter().map(|d| DeviceInfo {
        token: d.token,
        hostname: d.hostname,
        registered_at: d.registered_at,
        online: true,
    }).collect();

    let _ = s.emit("list", &DeviceListPayload { devices: device_list }).await;
}

pub async fn on_disconnect(s: SocketRef) {
    // Socket.IO rooms auto-cleanup on disconnect
    // Auth middleware manages room join/leave
    let _ = s;
}

pub fn register_devices_handlers(ns: &socketioxide::Namespace) {
    ns.on_connect(on_connect);
    ns.on_disconnect(on_disconnect);
}
