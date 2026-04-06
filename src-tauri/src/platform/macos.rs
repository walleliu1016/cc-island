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
            // Try to find and activate the specific window by title
            jump_to_terminal_window(&project_name)
        }
        TerminalType::MacosIterm2 => {
            jump_to_iterm2_window(&project_name)
        }
        TerminalType::MacosAlacritty => {
            jump_to_alacritty_window(&project_name)
        }
        TerminalType::MacosGhostty => {
            jump_to_ghostty_window(&project_name)
        }
        TerminalType::MacosVscode => {
            jump_to_vscode_window(&project_name)
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
fn jump_to_terminal_window(project_name: &str) -> bool {
    // Terminal window title format: "project — ✳ Claude Code — claude — 120x30"
    // Match windows containing both project name and "Claude Code"
    let script = format!(
        r#"
tell application "Terminal"
    activate
    set targetWindow to missing value
    set searchTerm to "{}"

    repeat with w in windows
        set windowTitle to name of w
        if windowTitle contains searchTerm and windowTitle contains "Claude Code" then
            set targetWindow to w
            exit repeat
        end if
    end repeat

    if targetWindow is not missing value then
        set index of targetWindow to 1
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
            if result.status.success() {
                tracing::info!("Successfully jumped to Terminal window for project {}", project_name);
                true
            } else {
                tracing::warn!("Failed to find Terminal window: {}", String::from_utf8_lossy(&result.stderr));
                // Fallback: just activate Terminal
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
    activate
    set targetSession to missing value

    repeat with t in terminals
        repeat with s in sessions of t
            set sessionName to name of s
            if sessionName contains "{}" then
                select s
                set targetSession to s
                exit repeat
            end if
        end repeat
    end repeat
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

/// Activate Alacritty window (limited AppleScript support)
fn jump_to_alacritty_window(_project_name: &str) -> bool {
    // Alacritty has limited AppleScript support, just activate the app
    activate_app("Alacritty")
}

/// Activate Ghostty window
fn jump_to_ghostty_window(project_name: &str) -> bool {
    // Ghostty window title: "⠐ Claude Code"
    // We can try to match, but Ghostty's AppleScript support is limited
    let script = format!(
        r#"
tell application "Ghostty"
    activate
end tell
tell application "System Events"
    tell process "Ghostty"
        set frontmost to true
    end tell
end tell
"#,
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
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
fn jump_to_vscode_window(project_name: &str) -> bool {
    // VS Code window title usually contains folder name
    let script = format!(
        r#"
tell application "Visual Studio Code"
    activate
end tell
"#,
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
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
        r#"tell application "{}" to activate"#,
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

        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name = process.name().to_string_lossy().to_lowercase();
            let exe = process.exe().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();

            tracing::info!("Checking PID {}: name='{}', exe='{}'", p, name, exe);

            // macOS Terminal.app - check both name and executable path
            if name == "terminal" || exe.contains("terminal.app") || exe.contains("/terminal") {
                tracing::info!("Detected Terminal.app");
                return TerminalType::MacosTerminal;
            }
            // iTerm2
            if name.contains("iterm") || exe.contains("iterm") {
                tracing::info!("Detected iTerm2");
                return TerminalType::MacosIterm2;
            }
            // Alacritty
            if name.contains("alacritty") || exe.contains("alacritty") {
                tracing::info!("Detected Alacritty");
                return TerminalType::MacosAlacritty;
            }
            // Ghostty
            if name.contains("ghostty") || exe.contains("ghostty") {
                tracing::info!("Detected Ghostty");
                return TerminalType::MacosGhostty;
            }
            // VS Code - check for both Electron and Code
            if name.contains("electron") || name.contains("code") || exe.contains("visual studio code") || exe.contains("vscode") {
                tracing::info!("Detected VS Code");
                return TerminalType::MacosVscode;
            }

            // Get parent from sysinfo first
            let parent = process.parent();

            // If sysinfo returns None for parent, try using ps command as fallback
            let next_pid = if parent.is_none() && (name == "login" || name == "zsh" || name == "bash") {
                // Use ps to find parent PID
                let output = std::process::Command::new("ps")
                    .args(["-p", &p.to_string(), "-o", "ppid="])
                    .output();

                match output {
                    Ok(result) => {
                        let ppid_str = String::from_utf8_lossy(&result.stdout).trim().to_string();
                        if let Ok(ppid) = ppid_str.parse::<u32>() {
                            tracing::info!("Using ps fallback: PID {} has parent {}", p, ppid);
                            Some(ppid)
                        } else {
                            None
                        }
                    }
                    Err(_) => None
                }
            } else {
                parent.map(|parent_pid| parent_pid.as_u32())
            };

            tracing::info!("PID {} next_pid: {:?}", p, next_pid);
            current_pid = next_pid;
        } else {
            tracing::warn!("Process PID {} not found in sysinfo", p);
            break;
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
                return p;
            }

            // Get parent - use ps fallback if needed
            let parent = process.parent();
            let next_pid = if parent.is_none() && (name == "login" || name == "zsh" || name == "bash") {
                let output = std::process::Command::new("ps")
                    .args(["-p", &p.to_string(), "-o", "ppid="])
                    .output();
                match output {
                    Ok(result) => {
                        let ppid_str = String::from_utf8_lossy(&result.stdout).trim().to_string();
                        ppid_str.parse::<u32>().ok()
                    }
                    Err(_) => None
                }
            } else {
                parent.map(|parent_pid| parent_pid.as_u32())
            };

            current_pid = next_pid;
        } else {
            break;
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