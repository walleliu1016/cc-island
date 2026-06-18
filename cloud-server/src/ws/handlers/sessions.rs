use socketioxide::extract::{SocketRef, Data};
use crate::ws::events::*;

pub async fn on_list_request(s: SocketRef, Data(payload): Data<RequestSessionListPayload>) {
    let _ = s.within("/sessions")
        .to(format!("device:{}", payload.device_token))
        .emit("list:request", &payload)
        .await;
}

pub async fn on_list_response(s: SocketRef, Data(payload): Data<SessionListResponsePayload>) {
    let _ = s.within("/sessions")
        .to(format!("device:{}", payload.device_token))
        .emit("list", &SessionListResponsePayload {
            device_token: payload.device_token,
            mobile_conn_id: payload.mobile_conn_id,
            sessions: payload.sessions,
        })
        .await;
}

pub fn register_sessions_handlers(ns: &socketioxide::Namespace) {
    ns.on("list:request", on_list_request);
    ns.on("list:response", on_list_response);
}
