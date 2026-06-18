use socketioxide::extract::{SocketRef, Data};
use crate::db::repository::Repository;
use crate::ws::events::*;

pub async fn on_hook(s: SocketRef, Data(payload): Data<HookPayload>) {
    let repo = s.extensions().get::<Repository>().expect("Repo missing");

    // Persist session lifecycle to DB
    match &payload.hook_type {
        HookType::SessionStart => {
            let cwd = payload.hook_body.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let project_name = payload.hook_body.get("project_name").and_then(|v| v.as_str()).unwrap_or(cwd);
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                Some(project_name),
                "idle",
                None,
            ).await.ok();
        }
        HookType::SessionEnd => {
            repo.end_session(&payload.device_token, &payload.session_id).await.ok();
        }
        HookType::PreToolUse => {
            let tool_name = payload.hook_body.get("tool_name").and_then(|v| v.as_str()).unwrap_or("unknown");
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "working",
                Some(tool_name),
            ).await.ok();
        }
        HookType::PostToolUse | HookType::PostToolUseFailure => {
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "idle",
                None,
            ).await.ok();
        }
        HookType::PermissionRequest | HookType::Elicitation => {
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "waitingForApproval",
                None,
            ).await.ok();

            // Upsert popup for PermissionRequest
            if let HookType::PermissionRequest = &payload.hook_type {
                let popup_id = payload.hook_body.get("popup_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&payload.session_id);
                let tool_name = payload.hook_body.get("tool_name").and_then(|v| v.as_str());
                let project_name = payload.hook_body.get("cwd").and_then(|v| v.as_str());

                repo.upsert_popup(
                    &payload.device_token,
                    &payload.session_id,
                    popup_id,
                    tool_name.unwrap_or("unknown"),
                    project_name,
                    payload.hook_body.clone(),
                ).await.ok();
            }
        }
        HookType::Stop => {
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "idle",
                None,
            ).await.ok();
        }
        HookType::UserPromptSubmit => {
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "thinking",
                None,
            ).await.ok();
        }
        HookType::PreCompact => {
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "compacting",
                None,
            ).await.ok();
        }
        HookType::PostCompact => {
            repo.upsert_session(
                &payload.device_token,
                &payload.session_id,
                None,
                "idle",
                None,
            ).await.ok();
        }
        _ => {}
    }

    // Broadcast to all mobile subscribers in device room
    let _ = s.within("/hooks")
        .to(format!("device:{}", payload.device_token))
        .emit("hook", &payload)
        .await;
}

pub async fn on_hook_response(s: SocketRef, Data(payload): Data<HookResponsePayload>) {
    let repo = s.extensions().get::<Repository>().expect("Repo missing");

    // Forward to desktop
    let _ = s.within("/hooks")
        .to(format!("device:{}", payload.device_token))
        .emit("hook:response", &payload)
        .await;

    // Resolve popup by session
    repo.resolve_popups_by_session(&payload.session_id).await.ok();
}

pub async fn on_popup_resolved(s: SocketRef, Data(payload): Data<PopupResolvedPayload>) {
    let repo = s.extensions().get::<Repository>().expect("Repo missing");

    repo.resolve_popup(&payload.popup_id).await.ok();

    let _ = s.within("/hooks")
        .to(format!("device:{}", payload.device_token))
        .emit("popup:resolved", &payload)
        .await;
}

pub fn register_hooks_handlers(ns: &socketioxide::Namespace) {
    ns.on("hook", on_hook);
    ns.on("hook:response", on_hook_response);
    ns.on("popup:resolved", on_popup_resolved);
}
