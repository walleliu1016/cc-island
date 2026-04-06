use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Hook configuration status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookStatus {
    pub name: String,
    pub configured: bool,
    pub required: bool,
    pub timeout: u64,
}

/// Result of checking Claude hooks configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HooksCheckResult {
    pub config_exists: bool,
    pub hooks: Vec<HookStatus>,
    pub missing_required: Vec<String>,
    pub missing_optional: Vec<String>,
}

/// Application settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub permission_timeout: u64,      // seconds
    pub ask_timeout: u64,             // seconds
    pub auto_deny_on_timeout: bool,
    pub show_notifications: bool,
    pub poll_interval: u64,           // milliseconds
    pub enable_logging: bool,         // enable file logging
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            permission_timeout: 300,
            ask_timeout: 120,
            auto_deny_on_timeout: true,
            show_notifications: true,
            poll_interval: 500,
            enable_logging: false,
        }
    }
}

/// Required hooks that must be configured
/// Note: SessionStart only supports "command" type hooks, not "http"
pub const REQUIRED_HOOKS: &[(&str, u64, bool)] = &[
    ("SessionStart", 5, true),   // is_command = true
    ("SessionEnd", 5, false),
    ("PreToolUse", 5, false),
    ("PostToolUse", 5, false),
    ("PermissionRequest", 300, false),
    ("Notification", 120, false),
];

/// Optional hooks
pub const OPTIONAL_HOOKS: &[(&str, u64, bool)] = &[
    ("Stop", 5, false),
    ("PostToolUseFailure", 5, false),
    ("PreCompact", 5, false),
    ("PostCompact", 5, false),
    ("UserPromptSubmit", 5, false),
    ("SubagentStart", 5, false),
    ("SubagentStop", 5, false),
];

/// Get Claude settings file path
fn get_claude_settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude").join("settings.json")
}

/// Check Claude hooks configuration
pub fn check_claude_hooks_config() -> HooksCheckResult {
    let settings_path = get_claude_settings_path();
    let config_exists = settings_path.exists();

    let mut hooks: Vec<HookStatus> = Vec::new();
    let mut missing_required: Vec<String> = Vec::new();
    let mut missing_optional: Vec<String> = Vec::new();

    // Read existing config
    let existing_hooks: HashMap<String, serde_json::Value> = if config_exists {
        match fs::read_to_string(&settings_path) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        json.get("hooks")
                            .and_then(|h| h.as_object())
                            .map(|obj| {
                                obj.iter()
                                    .map(|(k, v)| (k.clone(), v.clone()))
                                    .collect()
                            })
                            .unwrap_or_default()
                    }
                    Err(_) => HashMap::new(),
                }
            }
            Err(_) => HashMap::new(),
        }
    } else {
        HashMap::new()
    };

    // Check required hooks
    for (name, timeout, _is_command) in REQUIRED_HOOKS {
        let configured = existing_hooks.contains_key(*name);
        let status = HookStatus {
            name: name.to_string(),
            configured,
            required: true,
            timeout: *timeout,
        };
        hooks.push(status);

        if !configured {
            missing_required.push(name.to_string());
        }
    }

    // Check optional hooks
    for (name, timeout, _is_command) in OPTIONAL_HOOKS {
        let configured = existing_hooks.contains_key(*name);
        let status = HookStatus {
            name: name.to_string(),
            configured,
            required: false,
            timeout: *timeout,
        };
        hooks.push(status);

        if !configured {
            missing_optional.push(name.to_string());
        }
    }

    HooksCheckResult {
        config_exists,
        hooks,
        missing_required,
        missing_optional,
    }
}

/// Update Claude hooks configuration
pub fn update_claude_hooks_config(hooks_to_enable: Vec<String>) -> Result<(), String> {
    let settings_path = get_claude_settings_path();
    let settings_dir = settings_path.parent().unwrap();

    // Create directory if not exists
    if !settings_dir.exists() {
        fs::create_dir_all(settings_dir)
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    // Also create the SessionStart script if needed
    let script_path = settings_dir.join("cc-island-session-start.sh");
    let script_content = r#"#!/bin/bash
INPUT=$(cat)
curl -s -X POST http://localhost:17527/hook -H "Content-Type: application/json" -d "$INPUT" > /dev/null 2>&1
"#;
    fs::write(&script_path, script_content)
        .map_err(|e| format!("Failed to write session start script: {}", e))?;
    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set script permissions: {}", e))?;
    }

    // Read existing config
    let mut config: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Build hooks object
    let mut hooks_obj = serde_json::Map::new();

    // Add all hooks to enable
    let all_hooks: HashMap<&str, (u64, bool)> = REQUIRED_HOOKS.iter()
        .chain(OPTIONAL_HOOKS.iter())
        .map(|(name, timeout, is_command)| (*name, (*timeout, *is_command)))
        .collect();

    for hook_name in hooks_to_enable {
        if let Some((timeout, is_command)) = all_hooks.get(hook_name.as_str()) {
            if *is_command {
                // Use command type for SessionStart
                hooks_obj.insert(hook_name, serde_json::json!([{
                    "hooks": [{
                        "type": "command",
                        "command": "~/.claude/cc-island-session-start.sh",
                        "timeout": *timeout
                    }]
                }]));
            } else {
                // Use http type for other hooks
                hooks_obj.insert(hook_name, serde_json::json!([{
                    "hooks": [{
                        "type": "http",
                        "url": "http://localhost:17527/hook",
                        "timeout": *timeout
                    }]
                }]));
            }
        }
    }

    config["hooks"] = serde_json::Value::Object(hooks_obj);

    // Add schema
    config["$schema"] = serde_json::json!("https://json.schemastore.org/claude-code-settings.json");

    // Write config
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}