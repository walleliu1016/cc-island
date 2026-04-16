// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use crate::instance_manager::{ProcessInfo, TerminalType};
use std::process::Command;
use sysinfo::{System, ProcessesToUpdate};

/// Jump to terminal window on macOS using AppleScript
/// Tries to activate the specific window containing the Claude session
pub fn jump_to_terminal_macos(process_info: &ProcessInfo) -> bool {
    let terminal_pid = process_info.terminal_pid;
    let project_name = extract_project_name_from_cwd(&process_info.working_directory);

    match process_info.terminal_type {
        TerminalType::MacosTerminal => {
            jump_to_terminal_window(&project_name)
        }
        TerminalType::MacosIterm2 => {
            jump_to_iterm2_window(&project_name)
        }
        TerminalType::MacosAlacritty => {
            jump_to_alacritty_window()
        }
        TerminalType::MacosGhostty => {
            jump_to_ghostty_window()
        }
        TerminalType::MacosVscode => {
            jump_to_vscode_window()
        }
        _ => {
            // Generic: try to activate by PID
            activate_by_pid(terminal_pid)
        }
    }
}

/// Extract project name from working directory path
fn extract_project_name_from_cwd(cwd: &str) -> String {
    std::path::Path::new(cwd)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// Activate Terminal.app window by matching project name in title
/// Only activates the target window, keeps other minimized windows minimized
fn jump_to_terminal_window(project_name: &str) -> bool {
    // Terminal window title format: "project — ✳ Claude Code — claude — 120x30"
    tracing::info!("Attempting to jump to Terminal window for project: {}", project_name);

    let script = format!(
        r#"
tell application "Terminal"
    set targetWindow to missing value
    set searchTerm to "{}"

    -- Find the target window
    repeat with w in windows
        set windowTitle to name of w
        if windowTitle contains searchTerm and windowTitle contains "Claude Code" then
            set targetWindow to w
            exit repeat
        end if
    end repeat

    if targetWindow is not missing value then
        -- Restore only this window if minimized
        set isMin to miniaturized of targetWindow
        if isMin is true then
            set miniaturized of targetWindow to false
        end if
        -- Bring it to front within the app
        set index of targetWindow to 1
        -- Activate the app
        activate
        return "success"
    else
        return "not found"
    end if
end tell
"#,
        project_name
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            tracing::info!("AppleScript result: stdout='{}', stderr='{}'", stdout, stderr);

            if result.status.success() && stdout == "success" {
                tracing::info!("Successfully jumped to Terminal window for project {}", project_name);
                true
            } else {
                tracing::warn!("Failed to find Terminal window: {}", stderr);
                activate_app("Terminal")
            }
        }
        Err(e) => {
            tracing::error!("Failed to execute osascript: {}", e);
            activate_app("Terminal")
        }
    }
}

/// Activate iTerm2 window by matching project name
fn jump_to_iterm2_window(project_name: &str) -> bool {
    let script = format!(
        r#"
tell application "iTerm2"
    set targetSession to missing value

    repeat with t in terminals
        repeat with s in sessions of t
            set sessionName to name of s
            if sessionName contains "{}" then
                select s
                set targetSession to s
                -- Restore window if minimized
                try
                    set miniaturized of window of t to false
                end try
                exit repeat
            end if
        end repeat
    end repeat
end tell

tell application "System Events"
    set frontmost of process "iTerm2" to true
end tell
"#,
        project_name
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully jumped to iTerm2 window for project {}", project_name);
                true
            } else {
                activate_app("iTerm2")
            }
        }
        Err(_) => activate_app("iTerm2")
    }
}

/// Activate Alacritty window
fn jump_to_alacritty_window() -> bool {
    let script = r#"
tell application "Alacritty"
    if it is running then
        -- Restore first minimized window if any
        tell application "System Events"
            tell process "Alacritty"
                set frontmost to true
                try
                    set value of attribute "AXMinimized" of window 1 to false
                end try
            end tell
        end tell
    end if
end tell
"#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated Alacritty");
                true
            } else {
                activate_app("Alacritty")
            }
        }
        Err(_) => activate_app("Alacritty")
    }
}

/// Activate Ghostty window
fn jump_to_ghostty_window() -> bool {
    let script = r#"
tell application "System Events"
    tell process "Ghostty"
        set frontmost to true
        try
            set value of attribute "AXMinimized" of window 1 to false
        end try
    end tell
end tell
"#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated Ghostty");
                true
            } else {
                activate_app("Ghostty")
            }
        }
        Err(_) => activate_app("Ghostty")
    }
}

/// Activate VS Code window
fn jump_to_vscode_window() -> bool {
    let script = r#"
tell application "System Events"
    tell process "Code"
        set frontmost to true
        try
            set value of attribute "AXMinimized" of window 1 to false
        end try
    end tell
end tell
"#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated VS Code");
                true
            } else {
                activate_app("Visual Studio Code")
            }
        }
        Err(_) => activate_app("Visual Studio Code")
    }
}

/// Generic app activation by name
fn activate_app(app_name: &str) -> bool {
    let script = format!(
        r#"tell application "System Events"
    set frontmost of process "{}" to true
end tell"#,
        app_name
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(result) => result.status.success(),
        Err(_) => false
    }
}

/// Activate by PID (fallback)
fn activate_by_pid(pid: u32) -> bool {
    let script = format!(
        r#"tell application "System Events"
    set frontmost of first process whose unix id is {} to true
end tell"#,
        pid
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(result) => result.status.success(),
        Err(_) => false
    }
}

/// Detect terminal type from process tree on macOS
pub fn detect_terminal_type_macos(pid: u32) -> TerminalType {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut current_pid: Option<u32> = Some(pid);
    let mut visited = std::collections::HashSet::new();
    let mut depth = 0;

    tracing::info!("Starting terminal detection from PID {}", pid);

    while let Some(p) = current_pid {
        // Prevent infinite loops
        if visited.contains(&p) {
            tracing::warn!("Cycle detected at PID {}", p);
            break;
        }
        visited.insert(p);
        depth += 1;

        if depth > 20 {
            tracing::warn!("Max depth reached in process tree");
            break;
        }

        // Use ps command for reliable process info
        let output = std::process::Command::new("ps")
            .args(["-p", &p.to_string(), "-o", "ppid=,comm="])
            .output();

        match output {
            Ok(result) => {
                let output_str = String::from_utf8_lossy(&result.stdout).trim().to_string();
                let parts: Vec<&str> = output_str.split_whitespace().collect();

                if parts.len() >= 2 {
                    let ppid_str = parts[0];
                    let comm = parts[1..].join(" ").to_lowercase();

                    tracing::info!("Checking PID {}: comm='{}'", p, comm);

                    // Check for terminal types
                    if comm.contains("terminal.app") || comm.contains("/terminal") || comm.ends_with("terminal") {
                        tracing::info!("Detected Terminal.app");
                        return TerminalType::MacosTerminal;
                    }
                    if comm.contains("iterm") {
                        tracing::info!("Detected iTerm2");
                        return TerminalType::MacosIterm2;
                    }
                    if comm.contains("alacritty") {
                        tracing::info!("Detected Alacritty");
                        return TerminalType::MacosAlacritty;
                    }
                    if comm.contains("ghostty") {
                        tracing::info!("Detected Ghostty");
                        return TerminalType::MacosGhostty;
                    }
                    if comm.contains("visual studio code") || comm.contains("vscode") || comm.contains("electron") {
                        tracing::info!("Detected VS Code");
                        return TerminalType::MacosVscode;
                    }

                    // Continue with parent
                    if let Ok(ppid) = ppid_str.parse::<u32>() {
                        if ppid > 0 {
                            current_pid = Some(ppid);
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            Err(e) => {
                tracing::warn!("Failed to run ps: {}", e);
                break;
            }
        }
    }

    tracing::warn!("No known terminal detected for PID {}", pid);
    TerminalType::Unknown
}

/// Get process info for a Claude session
pub fn get_process_info(pid: u32) -> Option<ProcessInfo> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let process = sys.process(sysinfo::Pid::from_u32(pid))?;

    let ppid = process.parent()
        .map(|p| p.as_u32())
        .unwrap_or(0);

    let terminal_type = detect_terminal_type_macos(pid);
    let terminal_pid = find_terminal_pid(pid, &sys);

    let working_directory = process.cwd()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Some(ProcessInfo {
        pid,
        ppid,
        terminal_pid,
        terminal_type,
        working_directory,
    })
}

/// Find terminal PID by walking up process tree
fn find_terminal_pid(start_pid: u32, sys: &System) -> u32 {
    let mut current_pid: Option<u32> = Some(start_pid);
    let mut visited = std::collections::HashSet::new();
    let mut depth = 0;

    while let Some(p) = current_pid {
        if visited.contains(&p) {
            break;
        }
        visited.insert(p);
        depth += 1;

        if depth > 20 {
            break;
        }

        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name = process.name().to_string_lossy().to_lowercase();
            let exe = process.exe().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();

            // These are terminal processes
            if name == "terminal" || exe.contains("terminal.app") ||
               name.contains("iterm") || exe.contains("iterm") ||
               name.contains("alacritty") || exe.contains("alacritty") ||
               name.contains("ghostty") || exe.contains("ghostty") ||
               name.contains("electron") || exe.contains("visual studio code") || exe.contains("vscode") {
                tracing::info!("Found terminal PID {} name='{}' exe='{}'", p, name, exe);
                return p;
            }

            // Get parent - always use ps command for reliability
            let output = std::process::Command::new("ps")
                .args(["-p", &p.to_string(), "-o", "ppid="])
                .output();
            let next_pid = match output {
                Ok(result) => {
                    let ppid_str = String::from_utf8_lossy(&result.stdout).trim().to_string();
                    if let Ok(ppid) = ppid_str.parse::<u32>() {
                        if ppid > 0 { Some(ppid) } else { None }
                    } else {
                        None
                    }
                }
                Err(_) => None
            };

            current_pid = next_pid;
        } else {
            // Process not in sysinfo, use ps fallback
            let output = std::process::Command::new("ps")
                .args(["-p", &p.to_string(), "-o", "ppid=,comm="])
                .output();
            match output {
                Ok(result) => {
                    let output_str = String::from_utf8_lossy(&result.stdout).trim().to_string();
                    let parts: Vec<&str> = output_str.splitn(2, ' ').filter(|s| !s.is_empty()).collect();
                    if parts.len() >= 2 {
                        let ppid_str = parts[0];
                        let comm = parts[1].to_lowercase();
                        tracing::info!("PS fallback: PID {} ppid='{}' comm='{}'", p, ppid_str, comm);

                        // Check if this is a terminal
                        if comm.contains("terminal") || comm.contains("iterm") ||
                           comm.contains("alacritty") || comm.contains("ghostty") ||
                           comm.contains("code") {
                            tracing::info!("Found terminal via ps: PID {} comm='{}'", p, comm);
                            return p;
                        }

                        // Continue with parent
                        if let Ok(ppid) = ppid_str.parse::<u32>() {
                            if ppid > 0 {
                                current_pid = Some(ppid);
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    } else if parts.len() == 1 {
                        // Only ppid, no comm
                        if let Ok(ppid) = parts[0].parse::<u32>() {
                            if ppid > 0 {
                                current_pid = Some(ppid);
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                Err(_) => break
            }
        }
    }

    start_pid
}

/// Find Claude process by working directory
pub fn find_claude_process_by_cwd(cwd: &str) -> Option<ProcessInfo> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    // Find all claude processes
    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name.contains("claude") || name.contains("node") {
            if let Some(process_cwd) = process.cwd() {
                if process_cwd.to_string_lossy() == cwd {
                    let pid_u32 = pid.as_u32();
                    let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
                    let terminal_type = detect_terminal_type_macos(pid_u32);
                    let terminal_pid = find_terminal_pid(pid_u32, &sys);
                    let working_directory = process_cwd.to_string_lossy().to_string();

                    return Some(ProcessInfo {
                        pid: pid_u32,
                        ppid,
                        terminal_pid,
                        terminal_type,
                        working_directory,
                    });
                }
            }
        }
    }

    None
}

/// Find any Claude process
pub fn find_any_claude_process() -> Option<ProcessInfo> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    tracing::info!("Searching for Claude processes...");

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        // Check for claude CLI process
        if name.contains("claude") {
            tracing::info!("Found claude process: PID={}, name={}", pid.as_u32(), name);
            let pid_u32 = pid.as_u32();
            let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
            let terminal_type = detect_terminal_type_macos(pid_u32);
            let terminal_pid = find_terminal_pid(pid_u32, &sys);
            let working_directory = process.cwd()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            tracing::info!("Claude process info: terminal_type={:?}, terminal_pid={}", terminal_type, terminal_pid);

            return Some(ProcessInfo {
                pid: pid_u32,
                ppid,
                terminal_pid,
                terminal_type,
                working_directory,
            });
        }
    }

    tracing::warn!("No claude process found");
    None
}