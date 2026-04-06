use crate::instance_manager::{ProcessInfo, TerminalType};
use std::process::Command;
use sysinfo::{System, ProcessesToUpdate};

/// Jump to terminal window on macOS using AppleScript
pub fn jump_to_terminal_macos(process_info: &ProcessInfo) -> bool {
    let terminal_pid = process_info.terminal_pid;

    let script = match process_info.terminal_type {
        TerminalType::MacosTerminal => {
            "tell application \"Terminal\" to activate\n\
             tell application \"System Events\" to tell process \"Terminal\"\n\
             set frontmost to true\n\
             end tell"
        }
        TerminalType::MacosIterm2 => {
            "tell application \"iTerm2\" to activate\n\
             tell application \"System Events\" to tell process \"iTerm2\"\n\
             set frontmost to true\n\
             end tell"
        }
        TerminalType::MacosAlacritty => {
            "tell application \"Alacritty\" to activate\n\
             tell application \"System Events\" to tell process \"Alacritty\"\n\
             set frontmost to true\n\
             end tell"
        }
        TerminalType::MacosGhostty => {
            "tell application \"Ghostty\" to activate\n\
             tell application \"System Events\" to tell process \"Ghostty\"\n\
             set frontmost to true\n\
             end tell"
        }
        TerminalType::MacosVscode => {
            "tell application \"Visual Studio Code\" to activate\n\
             tell application \"System Events\" to tell process \"Electron\"\n\
             set frontmost to true\n\
             end tell"
        }
        _ => {
            // Generic: try to activate by PID
            &format!(
                "tell application \"System Events\"\n\
                 set frontmost of first process whose unix id is {} to true\n\
                 end tell",
                terminal_pid
            )
        }
    };

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully jumped to terminal PID {}", terminal_pid);
                true
            } else {
                tracing::warn!("Failed to jump to terminal: {}", String::from_utf8_lossy(&result.stderr));
                false
            }
        }
        Err(e) => {
            tracing::error!("Failed to execute osascript: {}", e);
            false
        }
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