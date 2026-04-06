use crate::instance_manager::{ProcessInfo, TerminalType};
use std::process::Command;

/// Jump to terminal window on Linux using xdotool or wmctrl
pub fn jump_to_terminal_linux(process_info: &ProcessInfo) -> bool {
    let terminal_pid = process_info.terminal_pid;

    // Try xdotool first (more reliable for PID-based activation)
    if activate_by_pid_xdotool(terminal_pid) {
        return true;
    }

    // Fallback to wmctrl
    match process_info.terminal_type {
        TerminalType::LinuxGnome => activate_by_class_wmctrl("gnome-terminal"),
        TerminalType::LinuxKonsole => activate_by_class_wmctrl("konsole"),
        TerminalType::LinuxAlacritty => activate_by_class_wmctrl("Alacritty"),
        _ => {
            // Generic fallback: try common terminal class names
            for class in &["gnome-terminal", "konsole", "Alacritty", "terminal"] {
                if activate_by_class_wmctrl(class) {
                    return true;
                }
            }
            false
        }
    }
}

/// Activate window by PID using xdotool
fn activate_by_pid_xdotool(pid: u32) -> bool {
    // xdotool search --pid <pid> windowactivate
    let output = Command::new("xdotool")
        .args(["search", "--pid", &pid.to_string(), "windowactivate"])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() && !result.stdout.is_empty() {
                tracing::info!("Successfully activated window by PID {} via xdotool", pid);
                true
            } else {
                tracing::debug!("xdotool PID search failed or no window found, trying class-based");
                false
            }
        }
        Err(e) => {
            // xdotool might not be installed
            tracing::debug!("xdotool not available: {}", e);
            false
        }
    }
}

/// Activate window by class name using wmctrl
fn activate_by_class_wmctrl(class: &str) -> bool {
    // wmctrl -a <class> activates the first window matching the class
    // Use -F for full match on window class
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
            // wmctrl might not be installed
            tracing::debug!("wmctrl not available: {}", e);
            false
        }
    }
}

/// Check if xdotool is available
fn xdotool_available() -> bool {
    Command::new("xdotool")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if wmctrl is available
fn wmctrl_available() -> bool {
    Command::new("wmctrl")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
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