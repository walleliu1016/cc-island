use socketioxide::adapter::Adapter;
use socketioxide::extract::{SocketRef, Data};
use crate::ws::events::*;

pub async fn on_list_request<A: Adapter>(s: SocketRef<A>, Data(payload): Data<RequestSessionListPayload>) {
    let _ = s.within(format!("device:{}", payload.device_token)).emit("list:request", &payload).await;
}

pub async fn on_list_response<A: Adapter>(s: SocketRef<A>, Data(payload): Data<SessionListResponsePayload>) {
    let _ = s.within(format!("device:{}", payload.device_token)).emit("list:response", &SessionListResponsePayload {
        device_token: payload.device_token,
        mobile_conn_id: payload.mobile_conn_id,
        sessions: payload.sessions,
    }).await;
}
