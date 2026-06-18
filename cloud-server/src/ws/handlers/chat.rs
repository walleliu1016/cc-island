use socketioxide::adapter::Adapter;
use socketioxide::extract::{SocketRef, Data};
use crate::db::repository::Repository;
use crate::ws::events::*;

pub async fn on_history<A: Adapter>(s: SocketRef<A>, Data(payload): Data<ChatHistoryPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    repo.upsert_chat_messages(&payload.device_token, &payload.session_id, &payload.messages).await.ok();

    let _ = s.within(format!("device:{}", payload.device_token)).emit("history", &payload).await;
}

pub async fn on_history_request<A: Adapter>(s: SocketRef<A>, Data(payload): Data<RequestChatHistoryPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    let messages = repo.get_chat_history(&payload.device_token, &payload.session_id, payload.limit).await.unwrap_or_default();

    let _ = s.emit("history", &ChatHistoryPayload {
        device_token: payload.device_token,
        session_id: payload.session_id,
        messages,
    });
}
