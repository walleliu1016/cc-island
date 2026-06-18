use socketioxide::adapter::Adapter;
use socketioxide::extract::{SocketRef, Data};
use crate::db::repository::Repository;
use crate::ws::events::*;

pub async fn on_hook<A: Adapter>(s: SocketRef<A>, Data(payload): Data<HookPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    match &payload.hook_type {
        HookType::SessionStart => {
            let cwd = payload.hook_body.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let project_name = payload.hook_body.get("project_name").and_then(|v| v.as_str()).unwrap_or(cwd);
            repo.upsert_session(&payload.device_token, &payload.session_id, Some(project_name), "idle", None).await.ok();
        }
        HookType::SessionEnd => {
            repo.end_session(&payload.device_token, &payload.session_id).await.ok();
        }
        HookType::PreToolUse => {
            let tool_name = payload.hook_body.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "working", Some(tool_name)).await.ok();
        }
        HookType::PostToolUse | HookType::PostToolUseFailure => {
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "idle", None).await.ok();
        }
        HookType::PermissionRequest | HookType::Elicitation => {
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "waitingForApproval", None).await.ok();
            if let HookType::PermissionRequest = &payload.hook_type {
                let popup_id = payload.hook_body.get("popup_id").and_then(|v| v.as_str()).unwrap_or(&payload.session_id);
                let tool_name = payload.hook_body.get("tool_name").and_then(|v| v.as_str());
                let project_name = payload.hook_body.get("cwd").and_then(|v| v.as_str());
                repo.upsert_popup(&payload.device_token, &payload.session_id, popup_id, tool_name.unwrap_or("unknown"), project_name, payload.hook_body.clone()).await.ok();
            }
        }
        HookType::Stop => {
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "idle", None).await.ok();
        }
        HookType::UserPromptSubmit => {
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "thinking", None).await.ok();
        }
        HookType::PreCompact => {
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "compacting", None).await.ok();
        }
        HookType::PostCompact => {
            repo.upsert_session(&payload.device_token, &payload.session_id, None, "idle", None).await.ok();
        }
        _ => {}
    }

    let _ = s.within(format!("device:{}", payload.device_token)).emit("hook", &payload).await;
}

pub async fn on_hook_response<A: Adapter>(s: SocketRef<A>, Data(payload): Data<HookResponsePayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    let _ = s.within(format!("device:{}", payload.device_token)).emit("hook:response", &payload).await;

    repo.resolve_popups_by_session(&payload.session_id).await.ok();
}

pub async fn on_popup_resolved<A: Adapter>(s: SocketRef<A>, Data(payload): Data<PopupResolvedPayload>) {
    let repo = s.extensions.get::<Repository>().expect("Repo missing");

    repo.resolve_popup(&payload.popup_id).await.ok();

    let _ = s.within(format!("device:{}", payload.device_token)).emit("popup:resolved", &payload).await;
}
