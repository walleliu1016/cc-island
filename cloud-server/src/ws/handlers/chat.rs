use socketioxide::extract::{SocketRef, Data};
use crate::db::repository::Repository;
use crate::ws::events::*;

pub async fn on_history(s: SocketRef, Data(payload): Data<ChatHistoryPayload>) {
    let repo = s.extensions().get::<Repository>().expect("Repo missing");

    // Persist to DB
    repo.upsert_chat_messages(
        &payload.device_token,
        &payload.session_id,
        &payload.messages,
    ).await.ok();

    // Broadcast to all mobile subscribers
    let _ = s.within("/chat")
        .to(format!("device:{}", payload.device_token))
        .emit("history", &payload)
        .await;
}

pub async fn on_history_request(s: SocketRef, Data(payload): Data<RequestChatHistoryPayload>) {
    let repo = s.extensions().get::<Repository>().expect("Repo missing");

    let messages = repo.get_chat_history(
        &payload.device_token,
        &payload.session_id,
        payload.limit,
    ).await.unwrap_or_default();

    let _ = s.emit("history", &ChatHistoryPayload {
        device_token: payload.device_token,
        session_id: payload.session_id,
        messages,
    });
}

pub fn register_chat_handlers(ns: &socketioxide::Namespace) {
    ns.on("history", on_history);
    ns.on("history:request", on_history_request);
}
