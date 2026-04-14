// JSONL file watcher for Claude conversation history
// Parses ~/.claude/projects/{projectDir}/{sessionId}.jsonl files

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;

/// Full chat message with structured content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullChatMessage {
    pub id: String,
    pub role: ChatRole,
    pub timestamp: u64,
    pub content: Vec<MessageBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
pub enum MessageBlock {
    Text(String),
    ToolUse(ToolUseBlock),
    ToolResult(ToolResultBlock),
    Thinking(String),
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseBlock {
    pub id: String,
    pub name: String,
    pub input: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultBlock {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
}

impl ToolUseBlock {
    /// Generate a short preview of the tool input
    pub fn preview(&self) -> String {
        if let Some(file_path) = self.input.get("file_path") {
            return file_path.clone();
        }
        if let Some(command) = self.input.get("command") {
            let first_line = command.lines().next().unwrap_or(command);
            return String::from(first_line).chars().take(50).collect();
        }
        if let Some(pattern) = self.input.get("pattern") {
            return pattern.clone();
        }
        self.input.values().next()
            .map(|v| v.chars().take(50).collect())
            .unwrap_or_default()
    }
}

/// Session's conversation history
pub struct SessionConversation {
    pub session_id: String,
    pub cwd: String,
    pub messages: Vec<FullChatMessage>,
    pub last_offset: u64,
    pub seen_tool_ids: HashMap<String, String>, // tool_id -> tool_name
}

impl SessionConversation {
    pub fn new(session_id: String, cwd: String) -> Self {
        Self {
            session_id,
            cwd,
            messages: Vec::new(),
            last_offset: 0,
            seen_tool_ids: HashMap::new(),
        }
    }

    /// Get the JSONL file path for this session
    pub fn jsonl_path(&self) -> PathBuf {
        let project_dir = self.cwd
            .replace("/", "-")
            .replace(".", "-");
        tracing::debug!("jsonl_path: cwd={}, project_dir={}", self.cwd, project_dir);
        dirs::home_dir()
            .unwrap_or(PathBuf::from("/"))
            .join(".claude")
            .join("projects")
            .join(project_dir)
            .join(format!("{}.jsonl", self.session_id))
    }
}

/// Global conversation manager
pub struct ConversationManager {
    conversations: HashMap<String, SessionConversation>,
}

impl ConversationManager {
    pub fn new() -> Self {
        Self {
            conversations: HashMap::new(),
        }
    }

    /// Get or create conversation for a session
    pub fn get_or_create(&mut self, session_id: String, cwd: String) -> &mut SessionConversation {
        self.conversations
            .entry(session_id.clone())
            .or_insert_with(|| SessionConversation::new(session_id, cwd))
    }

    /// Parse full conversation from JSONL file
    pub fn parse_full(&mut self, session_id: &str, cwd: &str) -> Vec<FullChatMessage> {
        // First get the path, then create/get conversation separately to avoid borrow issues
        let temp_conv = SessionConversation::new(session_id.to_string(), cwd.to_string());
        let path = temp_conv.jsonl_path();

        tracing::info!("parse_full called: session_id={}, cwd={}, path={}", session_id, cwd, path.display());

        if !path.exists() {
            tracing::warn!("JSONL file does not exist: {}", path.display());
            return Vec::new();
        }

        // Get or create conversation
        let conv = self.get_or_create(session_id.to_string(), cwd.to_string());

        // Reset and parse from beginning
        conv.last_offset = 0;
        conv.messages.clear();
        conv.seen_tool_ids.clear();

        // Parse lines into a separate vector first
        let mut parsed_messages = Vec::new();
        let mut line_count = 0;
        if let Ok(file) = File::open(&path) {
            let reader = BufReader::new(file);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.is_empty() {
                        continue;
                    }
                    line_count += 1;
                    // Skip /clear command markers
                    if line.contains("<command-name>/clear</command-name>") {
                        parsed_messages.clear();
                        conv.seen_tool_ids.clear();
                        continue;
                    }
                    if let Some(msg) = Self::parse_jsonl_line(&mut conv.seen_tool_ids, &line) {
                        parsed_messages.push(msg);
                    }
                }
            }
        }
        tracing::info!("Parsed {} lines, found {} messages", line_count, parsed_messages.len());

        conv.messages = parsed_messages.clone();
        parsed_messages
    }

    /// Parse incremental (new lines only)
    pub fn parse_incremental(&mut self, session_id: &str, cwd: &str) -> Vec<FullChatMessage> {
        // First get the path
        let temp_conv = SessionConversation::new(session_id.to_string(), cwd.to_string());
        let path = temp_conv.jsonl_path();

        if !path.exists() {
            return Vec::new();
        }

        let conv = self.get_or_create(session_id.to_string(), cwd.to_string());
        let mut new_messages = Vec::new();

        if let Ok(mut file) = File::open(&path) {
            // Get current file size
            let file_size = file.seek(SeekFrom::End(0)).unwrap_or(0);

            // If file shrunk (was cleared), reset state
            if file_size < conv.last_offset {
                conv.last_offset = 0;
                conv.messages.clear();
                conv.seen_tool_ids.clear();
            }

            // Seek to last read position
            if conv.last_offset > 0 {
                file.seek(SeekFrom::Start(conv.last_offset)).ok();
            }

            let reader = BufReader::new(file);
            let mut seen_tool_ids = conv.seen_tool_ids.clone();

            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.is_empty() {
                        continue;
                    }
                    if line.contains("<command-name>/clear</command-name>") {
                        conv.messages.clear();
                        seen_tool_ids.clear();
                        continue;
                    }
                    if let Some(msg) = Self::parse_jsonl_line(&mut seen_tool_ids, &line) {
                        new_messages.push(msg.clone());
                        conv.messages.push(msg);
                    }
                }
            }

            conv.seen_tool_ids = seen_tool_ids;
            conv.last_offset = file_size;
        }

        new_messages
    }

    /// Parse a single JSONL line (static method to avoid borrow issues)
    fn parse_jsonl_line(seen_tool_ids: &mut HashMap<String, String>, line: &str) -> Option<FullChatMessage> {
        let json: serde_json::Value = serde_json::from_str(line).ok()?;

        let msg_type = json.get("type").and_then(|t| t.as_str());
        if msg_type.is_none() {
            tracing::debug!("No type field in line: {}", line.chars().take(100).collect::<String>());
            return None;
        }
        let msg_type = msg_type.unwrap();

        let uuid = json.get("uuid").and_then(|u| u.as_str());
        if uuid.is_none() {
            tracing::debug!("No uuid field for type: {}", msg_type);
            return None;
        }
        let uuid = uuid.unwrap();

        tracing::debug!("Parsing line: type={}, uuid={}", msg_type, uuid);

        // Parse timestamp
        let timestamp = json.get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(|s| {
                chrono::DateTime::parse_from_rfc3339(s)
                    .map(|dt| dt.timestamp_millis() as u64)
                    .ok()
            })
            .unwrap_or_else(|| std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64);

        // Skip meta messages
        if json.get("isMeta").and_then(|m: &serde_json::Value| m.as_bool()) == Some(true) {
            return None;
        }

        let message_obj = json.get("message");
        if message_obj.is_none() {
            tracing::debug!("No message field for type: {}", msg_type);
            return None;
        }
        let message_obj = message_obj.unwrap();

        match msg_type {
            "user" => Self::parse_user_message(uuid, timestamp, message_obj),
            "assistant" => Self::parse_assistant_message(seen_tool_ids, uuid, timestamp, message_obj),
            "tool_result" => {
                Self::parse_tool_result(seen_tool_ids, &json, message_obj);
                None
            }
            _ => None
        }
    }

    fn parse_user_message(uuid: &str, timestamp: u64, message_obj: &serde_json::Value) -> Option<FullChatMessage> {
        let content = message_obj.get("content")?;

        // Try string content first
        if let Some(text) = content.as_str() {
            // Skip command markers
            if text.starts_with("<command-name>") || text.starts_with("<local-command") {
                return None;
            }
            if text.starts_with("[Request interrupted by user") {
                return Some(FullChatMessage {
                    id: uuid.to_string(),
                    role: ChatRole::User,
                    timestamp,
                    content: vec![MessageBlock::Interrupted],
                });
            }
            return Some(FullChatMessage {
                id: uuid.to_string(),
                role: ChatRole::User,
                timestamp,
                content: vec![MessageBlock::Text(text.to_string())],
            });
        }

        // Try array content
        if let Some(blocks) = content.as_array() {
            let mut message_blocks = Vec::new();
            for block in blocks {
                let block_type = block.get("type").and_then(|t| t.as_str());
                match block_type {
                    Some("text") => {
                        let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        if text.starts_with("[Request interrupted by user") {
                            message_blocks.push(MessageBlock::Interrupted);
                        } else {
                            message_blocks.push(MessageBlock::Text(text.to_string()));
                        }
                    }
                    Some("tool_use") => {
                        if let Some(tool_block) = Self::parse_tool_use_block(block) {
                            message_blocks.push(MessageBlock::ToolUse(tool_block));
                        }
                    }
                    _ => {}
                }
            }
            if !message_blocks.is_empty() {
                return Some(FullChatMessage {
                    id: uuid.to_string(),
                    role: ChatRole::User,
                    timestamp,
                    content: message_blocks,
                });
            }
        }

        None
    }

    fn parse_assistant_message(
        seen_tool_ids: &mut HashMap<String, String>,
        uuid: &str,
        timestamp: u64,
        message_obj: &serde_json::Value
    ) -> Option<FullChatMessage> {
        let content = message_obj.get("content");
        if content.is_none() {
            tracing::debug!("No content field in assistant message: {}", uuid);
            return None;
        }
        let content = content.unwrap();

        // Try string content
        if let Some(text) = content.as_str() {
            tracing::debug!("Assistant message {} has string content: {} chars", uuid, text.len());
            return Some(FullChatMessage {
                id: uuid.to_string(),
                role: ChatRole::Assistant,
                timestamp,
                content: vec![MessageBlock::Text(text.to_string())],
            });
        }

        // Try array content
        if let Some(blocks) = content.as_array() {
            tracing::debug!("Assistant message {} has {} content blocks", uuid, blocks.len());
            let mut message_blocks = Vec::new();
            for block in blocks {
                let block_type = block.get("type").and_then(|t| t.as_str());
                match block_type {
                    Some("text") => {
                        let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        if !text.starts_with("[Request interrupted by user") {
                            message_blocks.push(MessageBlock::Text(text.to_string()));
                        }
                    }
                    Some("tool_use") => {
                        if let Some(tool_block) = Self::parse_tool_use_block(block) {
                            seen_tool_ids.insert(tool_block.id.clone(), tool_block.name.clone());
                            message_blocks.push(MessageBlock::ToolUse(tool_block));
                        }
                    }
                    Some("thinking") => {
                        let thinking = block.get("thinking").and_then(|t| t.as_str()).unwrap_or("");
                        message_blocks.push(MessageBlock::Thinking(thinking.to_string()));
                    }
                    _ => {}
                }
            }
            if !message_blocks.is_empty() {
                return Some(FullChatMessage {
                    id: uuid.to_string(),
                    role: ChatRole::Assistant,
                    timestamp,
                    content: message_blocks,
                });
            }
        }

        None
    }

    fn parse_tool_use_block(block: &serde_json::Value) -> Option<ToolUseBlock> {
        let id = block.get("id").and_then(|i| i.as_str())?.to_string();
        let name = block.get("name").and_then(|n| n.as_str())?.to_string();

        let mut input = HashMap::new();
        if let Some(input_obj) = block.get("input") {
            if let Some(obj) = input_obj.as_object() {
                for (key, value) in obj {
                    if let Some(str_val) = value.as_str() {
                        input.insert(key.clone(), str_val.to_string());
                    } else if let Some(num) = value.as_i64() {
                        input.insert(key.clone(), num.to_string());
                    } else if let Some(bool_val) = value.as_bool() {
                        input.insert(key.clone(), bool_val.to_string());
                    } else {
                        // For other JSON types, serialize to string
                        input.insert(key.clone(), value.to_string());
                    }
                }
            }
        }

        Some(ToolUseBlock {
            id,
            name,
            input,
            preview: None,
        })
    }

    fn parse_tool_result(
        seen_tool_ids: &mut HashMap<String, String>,
        _json: &serde_json::Value,
        message_obj: &serde_json::Value
    ) {
        if let Some(content) = message_obj.get("content") {
            if let Some(blocks) = content.as_array() {
                for block in blocks {
                    if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                        continue;
                    }

                    let tool_use_id = block.get("tool_use_id").and_then(|i| i.as_str()).unwrap_or("");

                    // Track tool result
                    if !tool_use_id.is_empty() {
                        seen_tool_ids.insert(tool_use_id.to_string(), "result".to_string());
                    }
                }
            }
        }
    }

    /// Clear conversation for a session
    pub fn clear(&mut self, session_id: &str) {
        self.conversations.remove(session_id);
    }

    /// Get all conversations
    pub fn get_all(&self) -> HashMap<String, Vec<FullChatMessage>> {
        self.conversations
            .iter()
            .map(|(k, v)| (k.clone(), v.messages.clone()))
            .collect()
    }
}

impl Default for ConversationManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jsonl_path() {
        let conv = SessionConversation::new("test-session".to_string(), "/Users/test/project".to_string());
        let path = conv.jsonl_path();
        assert!(path.to_string_lossy().contains(".claude/projects"));
        assert!(path.to_string_lossy().contains("Users-test-project"));
    }

    #[test]
    fn test_parse_real_jsonl() {
        // Use a real JSONL file for testing
        let mut manager = ConversationManager::new();

        // Test with akke project (cwd = /Users/akke)
        let session_id = "d416dd44-1a67-4d7a-8659-184e87340d02";
        let cwd = "/Users/akke";

        let messages = manager.parse_full(session_id, cwd);

        println!("Parsed {} messages from JSONL file", messages.len());
        for msg in &messages {
            println!("  Message: id={}, role={:?}, content_blocks={}",
                msg.id, msg.role, msg.content.len());
            for block in &msg.content {
                match block {
                    MessageBlock::Text(t) => println!("    Text: {} chars", t.len()),
                    MessageBlock::ToolUse(t) => println!("    ToolUse: {}", t.name),
                    MessageBlock::ToolResult(r) => println!("    ToolResult: is_error={}", r.is_error),
                    MessageBlock::Thinking(t) => println!("    Thinking: {} chars", t.len()),
                    MessageBlock::Interrupted => println!("    Interrupted"),
                }
            }
        }

        // Should have at least some messages
        assert!(messages.len() > 0, "Should have parsed some messages");
    }

    #[test]
    fn test_parse_fm_agent_jsonl() {
        let mut manager = ConversationManager::new();
        let session_id = "ec303162-e7be-4f0f-b829-c317800b454b";
        let cwd = "/Users/akke/project/fm-agent";

        let messages = manager.parse_full(session_id, cwd);

        println!("\nParsed {} messages from fm-agent JSONL file", messages.len());
        for msg in &messages {
            println!("  Message: id={}, role={:?}, content_blocks={}",
                msg.id, msg.role, msg.content.len());
        }

        assert!(messages.len() > 0, "Should have parsed some messages from fm-agent");
    }
}
