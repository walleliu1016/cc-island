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

    while let Some(p) = current_pid {
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name: String = process.name().to_string_lossy().to_lowercase();

            if name.contains("terminal") && name.contains("app") {
                return TerminalType::MacosTerminal;
            }
            if name.contains("iterm") {
                return TerminalType::MacosIterm2;
            }
            if name.contains("alacritty") {
                return TerminalType::MacosAlacritty;
            }
            if name.contains("electron") || name.contains("code") {
                return TerminalType::MacosVscode;
            }

            current_pid = process.parent().map(|parent_pid| parent_pid.as_u32());
        } else {
            break;
        }
    }

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

    while let Some(p) = current_pid {
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name: String = process.name().to_string_lossy().to_lowercase();

            if name.contains("terminal") || name.contains("iterm") ||
               name.contains("alacritty") || name.contains("electron") {
                return p;
            }

            current_pid = process.parent().map(|parent_pid| parent_pid.as_u32());
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

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        // Check for claude CLI process
        if name.contains("claude") {
            let pid_u32 = pid.as_u32();
            let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
            let terminal_type = detect_terminal_type_macos(pid_u32);
            let terminal_pid = find_terminal_pid(pid_u32, &sys);
            let working_directory = process.cwd()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            return Some(ProcessInfo {
                pid: pid_u32,
                ppid,
                terminal_pid,
                terminal_type,
                working_directory,
            });
        }
    }

    None
}