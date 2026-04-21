// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Parses Claude Code JSONL conversation files for complete chat history.
//!
//! JSONL files are stored at: ~/.claude/projects/{project-hash}/{session-id}.jsonl
//!
//! This provides complete assistant responses, thinking blocks, and structured
//! tool results - which are NOT available through Hook events alone.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::SystemTime;
use serde::{Deserialize, Serialize};
use chrono::DateTime;

/// Conversation parser that reads JSONL files incrementally
pub struct ConversationParser {
    /// Cache of parsed messages per session
    cache: HashMap<String, ParsedSession>,
}

/// Parsed session state
struct ParsedSession {
    /// Last file offset for incremental reading
    last_offset: u64,
    /// Parsed messages
    messages: Vec<ConversationMessage>,
    /// Map of tool_use_id to tool name
    tool_id_to_name: HashMap<String, String>,
    /// Completed tool IDs (have received results)
    completed_tool_ids: HashMap<String, ToolResultData>,
}

/// Parsed conversation message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: Vec<MessageBlock>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MessageBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "toolUse")]
    ToolUse { id: String, name: String, input: serde_json::Value },
    #[serde(rename = "toolResult")]
    ToolResult { tool_use_id: String, content: String, is_error: bool },
    #[serde(rename = "thinking")]
    Thinking { text: String },
    #[serde(rename = "interrupted")]
    Interrupted,
}

/// Structured tool result data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultData {
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub content: Option<String>,
    pub is_error: bool,
    pub is_interrupted: bool,
}

impl ConversationParser {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
    }

    /// Get session file path
    fn session_file_path(session_id: &str, cwd: &str) -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        // Project dir: replace both Unix (/) and Windows (\) path separators with -
        let project_dir = cwd
            .replace('/', "-")
            .replace('\\', "-")
            .replace('.', "-");
        home.join(".claude/projects").join(project_dir).join(format!("{}.jsonl", session_id))
    }

    /// Find JSONL file by searching all project directories when cwd is unknown
    fn find_session_file(session_id: &str) -> Option<PathBuf> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let projects_dir = home.join(".claude/projects");

        if !projects_dir.exists() {
            return None;
        }

        // Search all project directories for this session's JSONL file
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let project_dir = entry.path();
                if project_dir.is_dir() {
                    let jsonl_file = project_dir.join(format!("{}.jsonl", session_id));
                    if jsonl_file.exists() {
                        tracing::info!("Found session {} JSONL at {}", session_id, jsonl_file.display());
                        return Some(jsonl_file);
                    }
                }
            }
        }

        None
    }

    /// Extract cwd from JSONL file first line (fallback when cwd unknown)
    fn extract_cwd_from_file(file_path: &PathBuf) -> Option<String> {
        let file = File::open(file_path).ok()?;
        let reader = BufReader::new(&file);

        for line in reader.lines().flatten() {
            if line.is_empty() {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(cwd) = json.get("cwd").and_then(|c| c.as_str()) {
                    return Some(cwd.to_string());
                }
            }
        }
        None
    }

    /// Parse full conversation for a session (reads entire file)
    /// Also updates cache to prevent incremental re-reading
    pub fn parse_full(&mut self, session_id: &str, cwd: &str) -> Vec<ConversationMessage> {
        let file_path = Self::session_file_path(session_id, cwd);

        if !file_path.exists() {
            return vec![];
        }

        let session = self.cache.entry(session_id.to_string()).or_insert(ParsedSession {
            last_offset: 0,
            messages: vec![],
            tool_id_to_name: HashMap::new(),
            completed_tool_ids: HashMap::new(),
        });

        Self::parse_file_full(&file_path, session);

        session.messages.clone()
    }

    /// Parse full conversation when cwd is unknown (searches all project dirs)
    /// Also updates cache to prevent incremental re-reading
    pub fn parse_full_without_cwd(&mut self, session_id: &str) -> Vec<ConversationMessage> {
        let file_path = Self::find_session_file(session_id);

        if file_path.is_none() {
            return vec![];
        }

        let file_path = file_path.unwrap();
        let session = self.cache.entry(session_id.to_string()).or_insert(ParsedSession {
            last_offset: 0,
            messages: vec![],
            tool_id_to_name: HashMap::new(),
            completed_tool_ids: HashMap::new(),
        });

        Self::parse_file_full(&file_path, session);

        session.messages.clone()
    }

    /// Parse entire file (for initial full read)
    fn parse_file_full(file_path: &PathBuf, session: &mut ParsedSession) {
        let file = File::open(file_path).ok();
        if file.is_none() {
            return;
        }

        let file = file.unwrap();
        let reader = BufReader::new(&file);
        let mut new_messages: Vec<ConversationMessage> = vec![];

        for line in reader.lines() {
            if line.is_err() {
                break;
            }
            let line = line.unwrap();
            if line.is_empty() {
                continue;
            }

            // Check for /clear command
            if line.contains("<command-name>/clear</command-name>") {
                session.messages.clear();
                session.tool_id_to_name.clear();
                session.completed_tool_ids.clear();
                continue;
            }

            // Parse JSON line
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                Self::parse_line(json, session, &mut new_messages);
            }
        }

        // Update offset
        if let Ok(metadata) = file.metadata() {
            session.last_offset = metadata.len();
        }

        // Append messages (dedupe by id to avoid duplicates from JSONL file)
        for msg in new_messages {
            if !session.messages.iter().any(|m| m.id == msg.id) {
                session.messages.push(msg);
            }
        }
    }

    /// Parse incrementally - only read new lines since last call
    /// Returns ONLY new messages (not the complete list)
    pub fn parse_incremental(&mut self, session_id: &str, cwd: &str) -> Vec<ConversationMessage> {
        let file_path = Self::session_file_path(session_id, cwd);

        if !file_path.exists() {
            return vec![];
        }

        let session = self.cache.entry(session_id.to_string()).or_insert(ParsedSession {
            last_offset: 0,
            messages: vec![],
            tool_id_to_name: HashMap::new(),
            completed_tool_ids: HashMap::new(),
        });

        // Check if file was truncated (e.g., /clear command)
        if let Ok(file) = File::open(&file_path) {
            if let Ok(metadata) = file.metadata() {
                let file_size = metadata.len();
                if file_size < session.last_offset {
                    // File was truncated, reset state
                    session.last_offset = 0;
                    session.messages.clear();
                    session.tool_id_to_name.clear();
                    session.completed_tool_ids.clear();
                }
            }
        }

        Self::parse_file_new_only(&file_path, session)
    }

    /// Parse incrementally when cwd is unknown (searches all project dirs)
    pub fn parse_incremental_without_cwd(&mut self, session_id: &str) -> Vec<ConversationMessage> {
        let file_path = Self::find_session_file(session_id);

        if file_path.is_none() {
            return vec![];
        }

        let file_path = file_path.unwrap();
        let session = self.cache.entry(session_id.to_string()).or_insert(ParsedSession {
            last_offset: 0,
            messages: vec![],
            tool_id_to_name: HashMap::new(),
            completed_tool_ids: HashMap::new(),
        });

        // Check if file was truncated (e.g., /clear command)
        if let Ok(file) = File::open(&file_path) {
            if let Ok(metadata) = file.metadata() {
                let file_size = metadata.len();
                if file_size < session.last_offset {
                    // File was truncated, reset state
                    session.last_offset = 0;
                    session.messages.clear();
                    session.tool_id_to_name.clear();
                    session.completed_tool_ids.clear();
                }
            }
        }

        Self::parse_file_new_only(&file_path, session)
    }

    /// Parse file from current offset, return ONLY new messages
    fn parse_file_new_only(file_path: &PathBuf, session: &mut ParsedSession) -> Vec<ConversationMessage> {
        let file = File::open(file_path).ok();
        if file.is_none() {
            return vec![];
        }

        let mut file = file.unwrap();

        // Seek to last offset
        if session.last_offset > 0 {
            if file.seek(SeekFrom::Start(session.last_offset)).is_err() {
                return vec![];
            }
        }

        let reader = BufReader::new(&file);
        let mut new_messages: Vec<ConversationMessage> = vec![];

        for line in reader.lines() {
            if line.is_err() {
                break;
            }
            let line = line.unwrap();
            if line.is_empty() {
                continue;
            }

            // Check for /clear command
            if line.contains("<command-name>/clear</command-name>") {
                session.messages.clear();
                session.tool_id_to_name.clear();
                session.completed_tool_ids.clear();
                new_messages.clear();  // Clear any accumulated new messages too
                continue;
            }

            // Parse JSON line
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                Self::parse_line(json, session, &mut new_messages);
            }
        }

        // Update offset
        if let Ok(metadata) = file.metadata() {
            session.last_offset = metadata.len();
        }

        // Append new messages to session cache (for future reference)
        session.messages.extend(new_messages.clone());

        // Return only the NEW messages (not the complete list)
        new_messages
    }

    /// Parse a single JSONL line
    fn parse_line(
        json: serde_json::Value,
        session: &mut ParsedSession,
        new_messages: &mut Vec<ConversationMessage>,
    ) {
        let type_str = json.get("type").and_then(|t| t.as_str());
        if type_str.is_none() {
            return;
        }

        let type_str = type_str.unwrap();

        // Skip meta messages
        if json.get("isMeta").and_then(|m| m.as_bool()) == Some(true) {
            return;
        }

        // Handle tool_result first (to track completed tools)
        if type_str == "tool_result" {
            Self::parse_tool_result(json, session);
            return;
        }

        // Handle user/assistant messages
        if type_str == "user" || type_str == "assistant" {
            if let Some(msg) = Self::parse_message(json, session) {
                new_messages.push(msg);
            }
        }
    }

    /// Parse tool_result line
    fn parse_tool_result(json: serde_json::Value, session: &mut ParsedSession) {
        let message = json.get("message");
        if message.is_none() {
            return;
        }

        let content_array = message.unwrap().get("content").and_then(|c| c.as_array());
        if content_array.is_none() {
            return;
        }

        for block in content_array.unwrap() {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }

            let tool_use_id = block.get("tool_use_id").and_then(|id| id.as_str());
            if tool_use_id.is_none() {
                continue;
            }
            let tool_use_id = tool_use_id.unwrap().to_string();

            let content = block.get("content").and_then(|c| c.as_str()).map(|s| s.to_string());
            let is_error = block.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);

            // Get stdout/stderr from toolUseResult if available
            let tool_use_result = json.get("toolUseResult");
            let stdout = tool_use_result.and_then(|r| r.get("stdout")).and_then(|s| s.as_str()).map(|s| s.to_string());
            let stderr = tool_use_result.and_then(|r| r.get("stderr")).and_then(|s| s.as_str()).map(|s| s.to_string());

            // Detect interruption
            let is_interrupted = is_error && (
                content.as_ref().map(|c| c.contains("Interrupted by user")).unwrap_or(false) ||
                content.as_ref().map(|c| c.contains("interrupted by user")).unwrap_or(false) ||
                content.as_ref().map(|c| c.contains("user doesn't want to proceed")).unwrap_or(false)
            );

            session.completed_tool_ids.insert(tool_use_id.clone(), ToolResultData {
                stdout,
                stderr,
                content,
                is_error,
                is_interrupted,
            });
        }
    }

    /// Parse user/assistant message
    fn parse_message(json: serde_json::Value, session: &mut ParsedSession) -> Option<ConversationMessage> {
        let uuid = json.get("uuid").and_then(|u| u.as_str());
        if uuid.is_none() {
            return None;
        }

        let type_str = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let role = if type_str == "user" { MessageRole::User } else { MessageRole::Assistant };

        let message = json.get("message");
        if message.is_none() {
            return None;
        }
        let message = message.unwrap();

        // Parse timestamp
        let timestamp = json.get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.timestamp_millis() as u64)
            .unwrap_or_else(|| {
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64
            });

        // Get session_id from top level
        let session_id = json.get("sessionId")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();

        let mut blocks: Vec<MessageBlock> = vec![];

        // Handle string content
        if let Some(content_str) = message.get("content").and_then(|c| c.as_str()) {
            // Skip command messages
            if content_str.starts_with("<command-name>") || content_str.starts_with("<local-command") || content_str.starts_with("Caveat:") {
                return None;
            }

            // Check for interrupted
            if content_str.starts_with("[Request interrupted by user") {
                blocks.push(MessageBlock::Interrupted);
            } else {
                blocks.push(MessageBlock::Text { text: content_str.to_string() });
            }
        }
        // Handle array content
        else if let Some(content_array) = message.get("content").and_then(|c| c.as_array()) {
            for block in content_array {
                let block_type = block.get("type").and_then(|t| t.as_str());

                match block_type {
                    Some("text") => {
                        let text = block.get("text").and_then(|t| t.as_str());
                        if let Some(text) = text {
                            if text.starts_with("[Request interrupted by user") {
                                blocks.push(MessageBlock::Interrupted);
                            } else {
                                blocks.push(MessageBlock::Text { text: text.to_string() });
                            }
                        }
                    }
                    Some("tool_use") => {
                        let id = block.get("id").and_then(|i| i.as_str());
                        let name = block.get("name").and_then(|n| n.as_str());
                        let input = block.get("input").cloned();

                        if let (Some(id), Some(name), Some(input)) = (id, name, input) {
                            // Track tool name for result matching
                            session.tool_id_to_name.insert(id.to_string(), name.to_string());
                            blocks.push(MessageBlock::ToolUse {
                                id: id.to_string(),
                                name: name.to_string(),
                                input,
                            });
                        }
                    }
                    Some("thinking") => {
                        let thinking = block.get("thinking").and_then(|t| t.as_str());
                        if let Some(thinking) = thinking {
                            blocks.push(MessageBlock::Thinking { text: thinking.to_string() });
                        }
                    }
                    _ => {}
                }
            }
        }

        if blocks.is_empty() {
            return None;
        }

        Some(ConversationMessage {
            id: uuid.unwrap().to_string(),
            session_id,
            role,
            content: blocks,
            timestamp,
        })
    }

    /// Get tool result data for a tool_use_id
    pub fn get_tool_result(&self, session_id: &str, tool_use_id: &str) -> Option<ToolResultData> {
        self.cache.get(session_id)
            .and_then(|s| s.completed_tool_ids.get(tool_use_id).cloned())
    }

    /// Clear session cache (for /clear or session end)
    pub fn clear_session(&mut self, session_id: &str) {
        self.cache.remove(session_id);
    }

    /// Convert ConversationMessage to ChatMessage format for compatibility
    pub fn to_chat_messages(messages: Vec<ConversationMessage>) -> Vec<crate::chat_messages::ChatMessage> {
        let mut result = Vec::new();
        for msg in messages {
            let msg_id = &msg.id;
            let msg_session_id = &msg.session_id;
            let msg_timestamp = msg.timestamp;
            let msg_role = &msg.role;

            for block in msg.content {
                let (content, tool_name, message_type) = match block {
                    MessageBlock::Text { text } => {
                        // Use role to determine message type for text blocks
                        let mt = match msg_role {
                            MessageRole::User => crate::chat_messages::MessageType::User,
                            MessageRole::Assistant => crate::chat_messages::MessageType::Assistant,
                        };
                        (text, None, mt)
                    }
                    MessageBlock::ToolUse { name, input, .. } => {
                        (format!("{}: {}", name, serde_json::to_string(&input).unwrap_or_default()), Some(name), crate::chat_messages::MessageType::ToolCall)
                    }
                    MessageBlock::ToolResult { content, .. } => (content, None, crate::chat_messages::MessageType::ToolResult),
                    MessageBlock::Thinking { text } => (text, None, crate::chat_messages::MessageType::Thinking),
                    MessageBlock::Interrupted => ("Interrupted".to_string(), None, crate::chat_messages::MessageType::Interrupted),
                };

                result.push(crate::chat_messages::ChatMessage {
                    id: msg_id.clone(),
                    session_id: msg_session_id.clone(),
                    message_type,
                    content,
                    tool_name,
                    timestamp: msg_timestamp,
                });
            }
        }
        result
    }
}

impl Default for ConversationParser {
    fn default() -> Self {
        Self::new()
    }
}