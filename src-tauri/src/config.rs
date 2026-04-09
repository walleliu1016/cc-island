use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// CC-Island directory name (sibling to .claude)
pub const CC_ISLAND_DIR_NAME: &str = ".cc-island";

/// SessionStart script filename (Unix)
pub const SESSION_START_SCRIPT_UNIX: &str = "session-start.sh";

/// SessionStart script filename (Windows)
pub const SESSION_START_SCRIPT_WIN: &str = "session-start.ps1";

/// Initialization marker file
pub const INIT_MARKER: &str = ".initialized";

/// Log file name
pub const LOG_FILE: &str = "cc-island.log";

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
    ("UserPromptSubmit", 5, false),  // Required for "thinking" status display
];

/// Optional hooks
pub const OPTIONAL_HOOKS: &[(&str, u64, bool)] = &[
    ("Stop", 5, false),
    ("PostToolUseFailure", 5, false),
    ("PreCompact", 5, false),
    ("PostCompact", 5, false),
    ("SubagentStart", 5, false),
    ("SubagentStop", 5, false),
];

/// Get Claude settings file path
fn get_claude_settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude").join("settings.json")
}

/// Get CC-Island directory path (sibling to .claude)
pub fn get_cc_island_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(CC_ISLAND_DIR_NAME)
}

/// Get log file path
pub fn get_log_file_path() -> PathBuf {
    get_cc_island_dir().join(LOG_FILE)
}

/// Get SessionStart script path (platform-specific)
pub fn get_session_start_script_path() -> PathBuf {
    #[cfg(unix)]
    {
        get_cc_island_dir().join(SESSION_START_SCRIPT_UNIX)
    }
    #[cfg(windows)]
    {
        get_cc_island_dir().join(SESSION_START_SCRIPT_WIN)
    }
}

/// Get SessionStart script content (platform-specific)
pub fn get_session_start_script_content() -> &'static str {
    #[cfg(unix)]
    {
        r#"#!/bin/bash
# CC-Island SessionStart hook
# Forwards session start event to CC-Island HTTP server
INPUT=$(cat)
curl -s -X POST http://localhost:17527/hook \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  > /dev/null 2>&1
"#
    }
    #[cfg(windows)]
    {
        r#"<#
.SYNOPSIS
    CC-Island SessionStart hook
.DESCRIPTION
    Forwards session start event to CC-Island HTTP server
#>
$jsonInput = [Console]::In.ReadToEnd()
$headers = @{
    "Content-Type" = "application/json"
}
try {
    Invoke-RestMethod -Uri "http://localhost:17527/hook" -Method POST -Headers $headers -Body $jsonInput -ErrorAction SilentlyContinue | Out-Null
} catch {
    # Ignore errors silently
}
"#
    }
}

/// Get the command path for settings.json (platform-specific)
pub fn get_session_start_command() -> String {
    #[cfg(unix)]
    {
        "~/.cc-island/session-start.sh".to_string()
    }
    #[cfg(windows)]
    {
        // On Windows, use PowerShell with full path
        // Double quotes allow $env:USERPROFILE to expand
        // Note: The path uses forward slashes which PowerShell accepts
        "powershell -NoProfile -ExecutionPolicy Bypass -File \"$env:USERPROFILE/.cc-island/session-start.ps1\"".to_string()
    }
}

/// Check if CC-Island has been initialized
pub fn is_initialized() -> bool {
    get_cc_island_dir().join(INIT_MARKER).exists()
}

/// Auto-setup hooks on first startup
/// Returns true if initialization was performed, false if already initialized
pub fn auto_setup_hooks() -> bool {
    // Check if already initialized
    if is_initialized() {
        tracing::info!("CC-Island hooks already initialized");
        return false;
    }

    tracing::info!("First startup - initializing CC-Island hooks...");

    let cc_island_dir = get_cc_island_dir();
    let script_path = get_session_start_script_path();
    let init_marker = cc_island_dir.join(INIT_MARKER);

    // Create cc-island directory
    if !cc_island_dir.exists() {
        if let Err(e) = fs::create_dir_all(&cc_island_dir) {
            tracing::error!("Failed to create cc-island directory: {}", e);
            return false;
        }
        tracing::info!("Created directory: {}", cc_island_dir.display());
    }

    // Create SessionStart script
    let script_content = get_session_start_script_content();
    if let Err(e) = fs::write(&script_path, script_content) {
        tracing::error!("Failed to write session start script: {}", e);
        return false;
    }
    tracing::info!("Created script: {}", script_path.display());

    // Make script executable (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755)) {
            tracing::error!("Failed to set script permissions: {}", e);
            return false;
        }
    }

    // Update Claude settings.json with all required hooks
    let all_hooks: Vec<String> = REQUIRED_HOOKS.iter()
        .chain(OPTIONAL_HOOKS.iter())
        .map(|(name, _, _)| name.to_string())
        .collect();

    if let Err(e) = update_claude_hooks_config(all_hooks) {
        tracing::error!("Failed to update Claude hooks config: {}", e);
        return false;
    }
    tracing::info!("Updated Claude hooks configuration");

    // Create initialization marker
    if let Err(e) = fs::write(&init_marker, format!("initialized at {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"))) {
        tracing::error!("Failed to create init marker: {}", e);
        return false;
    }
    tracing::info!("Created init marker: {}", init_marker.display());

    tracing::info!("CC-Island hooks initialization completed successfully");
    true
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
    let claude_dir = settings_path.parent().unwrap();
    let cc_island_dir = get_cc_island_dir();

    // Create .claude directory if not exists
    if !claude_dir.exists() {
        fs::create_dir_all(claude_dir)
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    // Create cc-island directory if not exists
    if !cc_island_dir.exists() {
        fs::create_dir_all(&cc_island_dir)
            .map_err(|e| format!("Failed to create cc-island directory: {}", e))?;
    }

    // Create the SessionStart script if needed
    let script_path = get_session_start_script_path();
    if !script_path.exists() {
        let script_content = get_session_start_script_content();
        fs::write(&script_path, script_content)
            .map_err(|e| format!("Failed to write session start script: {}", e))?;
        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Failed to set script permissions: {}", e))?;
        }
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
                // Use command type for SessionStart (platform-specific)
                let command = get_session_start_command();
                hooks_obj.insert(hook_name, serde_json::json!([{
                    "hooks": [{
                        "type": "command",
                        "command": command,
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