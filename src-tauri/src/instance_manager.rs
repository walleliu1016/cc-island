use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unique session identifier from Claude Code
pub type SessionId = String;

/// Status of a Claude instance
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "type", content = "data")]
pub enum InstanceStatus {
    Idle,
    Thinking,           // AI is thinking (UserPromptSubmit received, no tool yet)
    Working(String),    // Executing a specific tool (tool name)
    Waiting,            // Tool completed, AI continuing to generate response
    WaitingForApproval(String), // Waiting for user approval (tool name)
    Error,
    Compacting,
    Ended,
}

/// Terminal type detection
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalType {
    // macOS
    MacosTerminal,
    MacosIterm2,
    MacosAlacritty,
    MacosVscode,
    MacosGhostty,
    // Windows
    WindowsTerminal,
    WindowsCmd,
    WindowsPowershell,
    WindowsGitBash,
    // Linux
    LinuxGnome,
    LinuxKonsole,
    LinuxAlacritty,
    // Unknown
    Unknown,
}

/// Process information for Jump functionality
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub terminal_pid: u32,
    pub terminal_type: TerminalType,
    pub working_directory: String,
}

/// Tool input details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInput {
    pub tool_name: String,
    pub action: Option<String>,
    pub details: Option<String>,
    pub command: Option<String>,
    pub file_path: Option<String>,
}

/// A Claude Code instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeInstance {
    pub session_id: SessionId,
    pub project_name: String,
    pub custom_name: Option<String>,
    pub process_info: Option<ProcessInfo>,
    pub status: InstanceStatus,
    pub current_tool: Option<String>,
    pub tool_input: Option<ToolInput>,
    pub started_at: u64,
    pub last_activity_at: u64,
    // Fields for display persistence (minimum 3s display time)
    #[serde(skip)]
    pub display_status_until: Option<u64>, // Unix timestamp in ms
    #[serde(skip)]
    pub display_status: Option<InstanceStatus>, // The status to display
    #[serde(skip)]
    pub display_tool: Option<String>, // Tool name to display
    #[serde(skip)]
    pub display_tool_input: Option<ToolInput>, // Tool input to display
}

/// Instance data for API response (includes effective display state)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeInstanceDisplay {
    pub session_id: SessionId,
    pub project_name: String,
    pub custom_name: Option<String>,
    pub process_info: Option<ProcessInfo>,
    pub status: InstanceStatus,
    pub current_tool: Option<String>,
    pub tool_input: Option<ToolInput>,
    pub started_at: u64,
    pub last_activity_at: u64,
}

impl ClaudeInstance {
    pub fn new(session_id: SessionId, project_name: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            session_id,
            project_name,
            custom_name: None,
            process_info: None,
            status: InstanceStatus::Idle,
            current_tool: None,
            tool_input: None,
            started_at: now,
            last_activity_at: now,
            display_status_until: None,
            display_status: None,
            display_tool: None,
            display_tool_input: None,
        }
    }

    pub fn update_activity(&mut self) {
        self.last_activity_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
    }

    pub fn set_status(&mut self, status: InstanceStatus) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // If transitioning from Working/Thinking/WaitingForApproval to Idle/Waiting,
        // keep the display status for at least 3 seconds
        match (&self.status, &status) {
            (InstanceStatus::Working(_), InstanceStatus::Idle) |
            (InstanceStatus::Working(_), InstanceStatus::Waiting) |
            (InstanceStatus::Thinking, InstanceStatus::Idle) |
            (InstanceStatus::Thinking, InstanceStatus::Waiting) |
            (InstanceStatus::WaitingForApproval(_), InstanceStatus::Idle) |
            (InstanceStatus::WaitingForApproval(_), InstanceStatus::Waiting) => {
                // Set display persistence for 3 seconds
                self.display_status_until = Some(now_ms + 3000);
                self.display_status = Some(self.status.clone());
                self.display_tool = self.current_tool.clone();
                self.display_tool_input = self.tool_input.clone();
            }
            _ => {}
        }

        self.status = status;
        self.update_activity();
    }

    pub fn set_working(&mut self, tool_name: String, tool_input: Option<ToolInput>) {
        // Clear any pending display persistence when starting new work
        self.display_status_until = None;
        self.display_status = None;
        self.display_tool = None;
        self.display_tool_input = None;

        self.status = InstanceStatus::Working(tool_name.clone());
        self.current_tool = Some(tool_name);
        self.tool_input = tool_input;
        self.update_activity();
    }

    /// Get the effective status for display purposes
    pub fn get_display_status(&self) -> (&InstanceStatus, Option<&String>, Option<&ToolInput>) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Check if we should show persisted display status
        if let Some(until) = self.display_status_until {
            if now_ms < until {
                // Still within the display persistence window
                if let Some(ref display_status) = self.display_status {
                    return (display_status, self.display_tool.as_ref(), self.display_tool_input.as_ref());
                }
            }
        }

        // Return actual current status
        (&self.status, self.current_tool.as_ref(), self.tool_input.as_ref())
    }

    /// Convert to display struct with effective display state
    pub fn to_display(&self) -> ClaudeInstanceDisplay {
        let (status, current_tool, tool_input) = self.get_display_status();

        ClaudeInstanceDisplay {
            session_id: self.session_id.clone(),
            project_name: self.project_name.clone(),
            custom_name: self.custom_name.clone(),
            process_info: self.process_info.clone(),
            status: status.clone(),
            current_tool: current_tool.cloned(),
            tool_input: tool_input.cloned(),
            started_at: self.started_at,
            last_activity_at: self.last_activity_at,
        }
    }
}

/// Manages all Claude instances
pub struct InstanceManager {
    instances: HashMap<SessionId, ClaudeInstance>,
    max_instances: usize,
}

impl InstanceManager {
    pub fn new() -> Self {
        Self {
            instances: HashMap::new(),
            max_instances: 10,
        }
    }

    pub fn add_instance(&mut self, instance: ClaudeInstance) {
        if self.instances.len() >= self.max_instances {
            // Remove oldest ended instance
            if let Some(oldest_ended) = self.instances
                .iter()
                .filter(|(_, i)| i.status == InstanceStatus::Ended)
                .min_by_key(|(_, i)| i.last_activity_at)
                .map(|(k, _)| k.clone())
            {
                self.instances.remove(&oldest_ended);
            }
        }
        self.instances.insert(instance.session_id.clone(), instance);
    }

    pub fn get_instance(&self, session_id: &SessionId) -> Option<&ClaudeInstance> {
        self.instances.get(session_id)
    }

    pub fn get_instance_mut(&mut self, session_id: &SessionId) -> Option<&mut ClaudeInstance> {
        self.instances.get_mut(session_id)
    }

    pub fn remove_instance(&mut self, session_id: &SessionId) {
        self.instances.remove(session_id);
    }

    pub fn get_all_instances(&self) -> Vec<ClaudeInstance> {
        self.instances.values().cloned().collect()
    }

    /// Get all instances with display state applied (for API responses)
    pub fn get_all_instances_display(&self) -> Vec<ClaudeInstanceDisplay> {
        self.instances.values().map(|i| i.to_display()).collect()
    }

    pub fn count(&self) -> usize {
        self.instances.len()
    }

    pub fn count_by_status(&self, status: InstanceStatus) -> usize {
        self.instances.values().filter(|i| i.status == status).count()
    }

    /// Mark ended instances for removal after 30 seconds
    pub fn cleanup_ended(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let to_remove: Vec<SessionId> = self.instances
            .iter()
            .filter(|(_, i)| {
                i.status == InstanceStatus::Ended && now - i.last_activity_at > 30
            })
            .map(|(k, _)| k.clone())
            .collect();

        for session_id in to_remove {
            self.instances.remove(&session_id);
        }
    }
}

impl Default for InstanceManager {
    fn default() -> Self {
        Self::new()
    }
}