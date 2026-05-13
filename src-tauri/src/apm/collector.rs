// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! APM Collector - collects APM data and sends to APM Server

use std::sync::Arc;
use serde_json::json;

use crate::apm::sender::ApmSender;
use crate::config::AppSettings;
use crate::machine_id;

/// APM Collector
pub struct ApmCollector {
    sender: Option<Arc<ApmSender>>,
    enabled: bool,
}

impl ApmCollector {
    pub fn new(settings: &AppSettings) -> Arc<Self> {
        let enabled = settings.apm_enabled;

        let sender = if enabled && settings.apm_server_url.is_some() {
            let user_id = settings.apm_user_id.clone()
                .unwrap_or_else(|| machine_id::get_hostname());

            let device_id = machine_id::get_machine_token();

            Some(ApmSender::new(
                settings.apm_server_url.clone().unwrap(),
                user_id,
                device_id,
            ))
        } else {
            None
        };

        Arc::new(Self { sender, enabled })
    }

    /// Collect and send hook event
    pub fn collect_hook(&self, hook_input: &crate::hook_handler::HookInput) {
        if !self.enabled || self.sender.is_none() {
            return;
        }

        let sender = self.sender.clone().unwrap();

        // Build hook event JSON
        let event = json!({
            "session_id": hook_input.session_id,
            "hook_event_name": hook_input.hook_event_name,
            "tool_name": hook_input.tool_name,
            "tool_input": hook_input.tool_input,
            "tool_response": hook_input.tool_response,
            "tool_use_id": hook_input.tool_use_id,
            "agent_id": hook_input.agent_id,
            "agent_type": hook_input.agent_type,
            "cwd": hook_input.cwd,
            "metadata": hook_input.metadata,
            "duration_ms": hook_input.duration_ms,
            "success": hook_input.success,
        });

        // Send async (fire and forget)
        tokio::spawn(async move {
            sender.send_hook_event(&event).await;
        });
    }

    /// Collect and send message (from JSONL)
    pub fn collect_message(&self, message: &crate::conversation_parser::ConversationMessage) {
        if !self.enabled || self.sender.is_none() {
            return;
        }

        let sender = self.sender.clone().unwrap();

        // Build message JSON
        let role_str = match message.role {
            crate::conversation_parser::MessageRole::User => "user",
            crate::conversation_parser::MessageRole::Assistant => "assistant",
        };

        let msg_json = json!({
            "session_id": message.session_id,
            "role": role_str,
            "content": message.content.iter().map(|b| {
                match b {
                    crate::conversation_parser::MessageBlock::Text { text } => text.clone(),
                    _ => "".to_string(),
                }
            }).collect::<Vec<String>>().join("\n"),
            "model": message.model,
            "usage": message.usage,
        });

        // Send async
        tokio::spawn(async move {
            sender.send_message(&msg_json).await;
        });
    }
}