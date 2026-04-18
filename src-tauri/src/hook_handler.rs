// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Input from Claude Code hook
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct HookInput {
    pub session_id: String,
    pub hook_event_name: String,
    pub tool_name: Option<String>,
    pub tool_input: Option<HashMap<String, serde_json::Value>>,
    pub tool_response: Option<HashMap<String, serde_json::Value>>,
    pub permission_data: Option<PermissionData>,
    pub notification_data: Option<NotificationData>,
    #[serde(default)]
    pub cwd: Option<String>,
    // Elicitation 事件专用字段
    pub questions: Option<Vec<ElicitationQuestion>>,
    // Stop hook 专用字段
    pub stop_reason: Option<String>,
    pub message_count: Option<u32>,
}

/// Elicitation question structure (for AskUserQuestion)
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ElicitationQuestion {
    pub question: String,
    pub header: String,
    #[serde(default)]
    pub multi_select: bool,
    pub options: Vec<ElicitationOption>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ElicitationOption {
    pub label: String,
    pub description: Option<String>,
}

/// Output to Claude Code - following docs/hook-reference.md format (camelCase)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookOutput {
    /// true=继续执行, false=阻止 (continue is Rust keyword, use rename)
    #[serde(rename = "continue")]
    pub continue_exec: bool,
    /// 决策类型: allow|deny|block|ask
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    /// 决策原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// UI 显示的消息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_message: Option<String>,
    /// 是否隐藏 hook 输出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppress_output: Option<bool>,
    /// 事件特定输出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hook_specific_output: Option<HookSpecificOutput>,
}

/// Hook-specific output structure per docs/hooks-claude.md (camelCase)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookSpecificOutput {
    pub hook_event_name: String,
    /// 注入到模型上下文的文本 (for PreToolUse, SessionStart, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
    /// PreToolUse 专用: allow|deny|ask|defer
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_decision: Option<String>,
    /// PreToolUse 专用: 决策原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_decision_reason: Option<String>,
    /// PreToolUse 专用: 修改后的工具输入
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<serde_json::Value>,
    /// PermissionRequest 专用: decision 对象 {behavior, updatedInput, message}
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<DecisionOutput>,
    /// Elicitation 专用: accept|decline|cancel
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Elicitation 专用: 表单字段值
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
}

/// PermissionRequest decision output (camelCase)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionOutput {
    /// allow|deny
    pub behavior: String,
    /// 修改后的工具输入 (for AskUserQuestion: questions + answers)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<serde_json::Value>,
    /// deny 时向 Claude 显示的原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// deny 时是否中断 Claude
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupt: Option<bool>,
}

/// Permission request data from Claude
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PermissionData {
    pub tool_name: String,
    pub action: String,
    pub details: Option<String>,
}

/// Notification data from Claude (can be ask or plain notification)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NotificationData {
    pub message: String,
    #[serde(rename = "type")]
    pub notification_type: Option<String>,
    pub options: Option<Vec<String>>,
}

impl NotificationData {
    pub fn is_ask(&self) -> bool {
        self.notification_type.as_ref().map(|t| t == "ask").unwrap_or(false)
    }
}

/// Parse hook JSON from Claude Code
pub fn parse_hook(json: &str) -> Result<HookInput, serde_json::Error> {
    serde_json::from_str(json)
}

/// Create output JSON for Claude Code
pub fn create_output(output: &HookOutput) -> String {
    serde_json::to_string(output).unwrap()
}