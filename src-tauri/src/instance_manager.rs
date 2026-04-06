use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unique session identifier from Claude Code
pub type SessionId = String;

/// Status of a Claude instance
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceStatus {
    Idle,
    Working,
    Waiting,
    Error,
    Compacting,
    Ended,
}

/// Terminal type detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalType {
    // macOS
    MacosTerminal,
    MacosIterm2,
    MacosAlacritty,
    MacosVscode,
    // Windows
    WindowsTerminal,
    WindowsCmd,
    WindowsPowershell,
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
        }
    }

    pub fn update_activity(&mut self) {
        self.last_activity_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
    }

    pub fn set_status(&mut self, status: InstanceStatus) {
        self.status = status;
        self.update_activity();
    }

    pub fn set_working(&mut self, tool_name: String, tool_input: Option<ToolInput>) {
        self.status = InstanceStatus::Working;
        self.current_tool = Some(tool_name);
        self.tool_input = tool_input;
        self.update_activity();
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