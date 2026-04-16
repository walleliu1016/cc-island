// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Chat message types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageType {
    User,
    Assistant,
    ToolCall,
    ToolResult,
    Thinking,
    Interrupted,
}

/// Chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub message_type: MessageType,
    pub content: String,
    /// Tool name for toolCall/toolResult
    pub tool_name: Option<String>,
    /// Timestamp in milliseconds
    pub timestamp: u64,
}

/// Chat history manager - stores messages per session
pub struct ChatHistory {
    /// Messages grouped by session_id
    messages: HashMap<String, Vec<ChatMessage>>,
    /// Max messages per session
    max_per_session: usize,
}

impl ChatHistory {
    pub fn new() -> Self {
        Self {
            messages: HashMap::new(),
            max_per_session: 100,
        }
    }

    /// Add a message to a session's history
    pub fn add_message(&mut self, message: ChatMessage) {
        let session_messages = self.messages.entry(message.session_id.clone()).or_insert_with(Vec::new);
        session_messages.push(message);

        // Keep max messages per session
        if session_messages.len() > self.max_per_session {
            session_messages.remove(0);
        }
    }

    /// Get messages for a session
    pub fn get_messages(&self, session_id: &str) -> Vec<ChatMessage> {
        self.messages.get(session_id).cloned().unwrap_or_default()
    }

    /// Clear messages for a session (when session ends)
    pub fn clear_session(&mut self, session_id: &str) {
        self.messages.remove(session_id);
    }

    /// Get all messages across all sessions
    pub fn get_all(&self) -> Vec<ChatMessage> {
        self.messages.values().flat_map(|v| v.clone()).collect()
    }
}

impl Default for ChatHistory {
    fn default() -> Self {
        Self::new()
    }
}