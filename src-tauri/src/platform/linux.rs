use crate::instance_manager::{ProcessInfo, TerminalType};
use std::process::Command;

/// Jump to terminal window on Linux using xdotool or wmctrl
/// Only activate the specific window containing the Claude session
pub fn jump_to_terminal_linux(process_info: &ProcessInfo) -> bool {
    let terminal_pid = process_info.terminal_pid;
    let project_name = extract_project_name_from_cwd(&process_info.working_directory);

    // Try xdotool first - it can activate specific window by PID
    if activate_window_by_pid_xdotool(terminal_pid) {
        return true;
    }

    // Fallback: try to find window by project name in title
    if activate_window_by_title(&project_name) {
        return true;
    }

    // Last fallback: wmctrl by class
    match process_info.terminal_type {
        TerminalType::LinuxGnome => activate_by_class_wmctrl("gnome-terminal"),
        TerminalType::LinuxKonsole => activate_by_class_wmctrl("konsole"),
        TerminalType::LinuxAlacritty => activate_by_class_wmctrl("Alacritty"),
        _ => false,
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

/// Activate window by PID using xdotool (most precise method)
fn activate_window_by_pid_xdotool(pid: u32) -> bool {
    // xdotool search --pid <pid> windowactivate
    // This activates only the specific window belonging to the PID
    // xdotool windowactivate automatically restores minimized windows
    // Also try to raise and focus the window
    let output = Command::new("xdotool")
        .args(["search", "--pid", &pid.to_string(), "windowactivate", "--sync"])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() && !result.stdout.is_empty() {
                tracing::info!("Successfully activated window by PID {} via xdotool", pid);
                // Get the window ID and ensure it's not minimized
                let window_ids = String::from_utf8_lossy(&result.stdout);
                for win_id in window_ids.lines() {
                    // Try to restore from minimized state
                    let _ = Command::new("xdotool")
                        .args(["windowstate", win_id, "remove", "MINIMIZED"])
                        .output();
                    // Raise and focus
                    let _ = Command::new("xdotool")
                        .args(["windowraise", win_id])
                        .output();
                    let _ = Command::new("xdotool")
                        .args(["windowfocus", win_id])
                        .output();
                }
                true
            } else {
                tracing::debug!("xdotool PID search failed or no window found");
                false
            }
        }
        Err(e) => {
            tracing::debug!("xdotool not available: {}", e);
            false
        }
    }
}

/// Activate window by searching for project name in window title
fn activate_window_by_title(project_name: &str) -> bool {
    // Use wmctrl to find and activate window by title
    // wmctrl -a <title> activates the first window matching the title
    // First try to restore any minimized windows matching the title
    let restore_output = Command::new("wmctrl")
        .args(["-r", project_name, "-b", "remove,MINIMIZED"])
        .output();

    // Now activate the window
    let output = Command::new("wmctrl")
        .args(["-a", project_name])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated window by title '{}' via wmctrl", project_name);
                true
            } else {
                // Try with "Claude" in title
                let _ = Command::new("wmctrl")
                    .args(["-r", "Claude", "-b", "remove,MINIMIZED"])
                    .output();
                let output2 = Command::new("wmctrl")
                    .args(["-a", "Claude"])
                    .output();
                match output2 {
                    Ok(r) => r.status.success(),
                    Err(_) => false
                }
            }
        }
        Err(e) => {
            tracing::debug!("wmctrl not available: {}", e);
            false
        }
    }
}

/// Activate window by class name using wmctrl
fn activate_by_class_wmctrl(class: &str) -> bool {
    // First restore any minimized windows of this class
    let _ = Command::new("wmctrl")
        .args(["-r", class, "-b", "remove,MINIMIZED"])
        .output();

    // wmctrl -a <class> activates the first window matching the class
    let output = Command::new("wmctrl")
        .args(["-a", class])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated {} window via wmctrl", class);
                true
            } else {
                tracing::debug!("wmctrl failed for class {}", class);
                false
            }
        }
        Err(e) => {
            tracing::debug!("wmctrl not available: {}", e);
            false
        }
    }
}

/// Detect terminal type from process tree on Linux
pub fn detect_terminal_type_linux(pid: u32) -> TerminalType {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut current_pid: Option<u32> = Some(pid);

    while let Some(p) = current_pid {
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name = process.name().to_string_lossy().to_lowercase();

            // Check for gnome-terminal
            if name.contains("gnome-terminal") {
                return TerminalType::LinuxGnome;
            }
            // Check for konsole
            if name.contains("konsole") {
                return TerminalType::LinuxKonsole;
            }
            // Check for alacritty
            if name.contains("alacritty") {
                return TerminalType::LinuxAlacritty;
            }

            current_pid = process.parent().map(|parent_pid| parent_pid.as_u32());
        } else {
            break;
        }
    }

    TerminalType::Unknown
}

/// Find terminal PID by walking up process tree
fn find_terminal_pid(start_pid: u32, sys: &sysinfo::System) -> u32 {
    let mut current_pid: Option<u32> = Some(start_pid);

    while let Some(p) = current_pid {
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name = process.name().to_string_lossy().to_lowercase();

            // These are terminal emulator processes
            if name.contains("gnome-terminal") || name.contains("konsole") ||
               name.contains("alacritty") || name.contains("terminal") {
                return p;
            }

            current_pid = process.parent().map(|parent_pid| parent_pid.as_u32());
        } else {
            break;
        }
    }

    start_pid
}

/// Find Claude process by working directory on Linux
pub fn find_claude_process_by_cwd(cwd: &str) -> Option<ProcessInfo> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        // Check for claude CLI or node process
        if name.contains("claude") || name.contains("node") {
            if let Some(process_cwd) = process.cwd() {
                if process_cwd.to_string_lossy() == cwd {
                    let pid_u32 = pid.as_u32();
                    let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
                    let terminal_type = detect_terminal_type_linux(pid_u32);
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

/// Find any Claude process on Linux
pub fn find_any_claude_process() -> Option<ProcessInfo> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name.contains("claude") {
            let pid_u32 = pid.as_u32();
            let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
            let terminal_type = detect_terminal_type_linux(pid_u32);
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