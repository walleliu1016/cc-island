use crate::instance_manager::{ProcessInfo, TerminalType};
use std::process::Command;

/// Jump to terminal window on Windows
pub fn jump_to_terminal_windows(process_info: &ProcessInfo) -> bool {
    let terminal_pid = process_info.terminal_pid;

    match process_info.terminal_type {
        TerminalType::WindowsTerminal => activate_by_process_name("WindowsTerminal", terminal_pid),
        TerminalType::WindowsPowershell => activate_by_process_name("powershell", terminal_pid),
        TerminalType::WindowsCmd => activate_by_process_name("cmd", terminal_pid),
        TerminalType::WindowsGitBash => activate_by_process_name("mintty", terminal_pid),
        _ => activate_by_pid(terminal_pid),
    }
}

/// Activate window by process name using PowerShell
fn activate_by_process_name(process_name: &str, fallback_pid: u32) -> bool {
    // Use PowerShell to activate window by process name
    let ps_script = format!(
        "$proc = Get-Process -Name '{}' -ErrorAction SilentlyContinue; \
         if ($proc) { \
             $wshell = New-Object -ComObject WScript.Shell; \
             $wshell.AppActivate($proc.MainWindowTitle); \
             $wshell.SendKeys('~'); \
         }",
        process_name
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated {} window", process_name);
                true
            } else {
                tracing::warn!("PowerShell failed, trying PID fallback: {}",
                    String::from_utf8_lossy(&result.stderr));
                activate_by_pid(fallback_pid)
            }
        }
        Err(e) => {
            tracing::warn!("Failed to run PowerShell: {}, trying PID fallback", e);
            activate_by_pid(fallback_pid)
        }
    }
}

/// Activate window by PID using Win32 API
fn activate_by_pid(pid: u32) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, SetForegroundWindow, IsWindowVisible};
    use windows::Win32::Foundation::HWND;

    // Find window belonging to this PID
    let target_pid = pid;
    let mut found_hwnd: Option<HWND> = None;

    // Enumerate windows to find one belonging to target PID
    // Note: We use a simple approach - call EnumWindows with a callback
    // In Rust, we need to use a closure through raw pointer

    // For simplicity, use PowerShell as fallback for PID activation
    let ps_script = format!(
        "$proc = Get-Process -Id {} -ErrorAction SilentlyContinue; \
         if ($proc) { \
             $wshell = New-Object -ComObject WScript.Shell; \
             if ($proc.MainWindowTitle) { \
                 $wshell.AppActivate($proc.MainWindowTitle); \
             } else { \
                 # Try parent process \
                 $parent = Get-Process -Id $proc.Parent.ProcessId -ErrorAction SilentlyContinue; \
                 if ($parent) { \
                     $wshell.AppActivate($parent.MainWindowTitle); \
                 } \
             } \
         }",
        pid
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated window by PID {}", pid);
                true
            } else {
                tracing::warn!("Failed to activate window: {}", String::from_utf8_lossy(&result.stderr));
                false
            }
        }
        Err(e) => {
            tracing::error!("Failed to execute PowerShell: {}", e);
            false
        }
    }
}

/// Detect terminal type from process tree on Windows
pub fn detect_terminal_type_windows(pid: u32) -> TerminalType {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut current_pid: Option<u32> = Some(pid);

    while let Some(p) = current_pid {
        if let Some(process) = sys.process(sysinfo::Pid::from_u32(p)) {
            let name = process.name().to_string_lossy().to_lowercase();

            // Check for Windows Terminal
            if name.contains("windowsterminal") || name.contains("wt") {
                return TerminalType::WindowsTerminal;
            }
            // Check for PowerShell
            if name.contains("powershell") {
                return TerminalType::WindowsPowershell;
            }
            // Check for CMD
            if name == "cmd.exe" || name == "cmd" {
                return TerminalType::WindowsCmd;
            }
            // Check for Git-Bash / Mintty
            if name.contains("mintty") {
                return TerminalType::WindowsGitBash;
            }
            // Git bash running in bash
            if name.contains("bash") {
                // Check if it's Git bash by looking at parent process
                if let Some(parent_pid) = process.parent() {
                    if let Some(parent) = sys.process(parent_pid) {
                        let parent_name = parent.name().to_string_lossy().to_lowercase();
                        if parent_name.contains("mintty") || parent_name.contains("git") {
                            return TerminalType::WindowsGitBash;
                        }
                    }
                }
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

            // These are terminal processes
            if name.contains("windowsterminal") || name.contains("wt") ||
               name.contains("powershell") || name == "cmd" ||
               name.contains("mintty") || name.contains("conhost") ||
               name.contains("bash") {
                return p;
            }

            current_pid = process.parent().map(|parent_pid| parent_pid.as_u32());
        } else {
            break;
        }
    }

    start_pid
}

/// Find Claude process by working directory on Windows
pub fn find_claude_process_by_cwd(cwd: &str) -> Option<ProcessInfo> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        // Check for claude CLI or node process
        if name.contains("claude") || name.contains("node") {
            if let Some(process_cwd) = process.cwd() {
                // Normalize paths for comparison (Windows uses backslashes)
                let process_cwd_str = process_cwd.to_string_lossy().replace("\\", "/");
                let target_cwd = cwd.replace("\\", "/");

                if process_cwd_str == target_cwd {
                    let pid_u32 = pid.as_u32();
                    let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
                    let terminal_type = detect_terminal_type_windows(pid_u32);
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

/// Find any Claude process on Windows
pub fn find_any_claude_process() -> Option<ProcessInfo> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name.contains("claude") {
            let pid_u32 = pid.as_u32();
            let ppid = process.parent().map(|p| p.as_u32()).unwrap_or(0);
            let terminal_type = detect_terminal_type_windows(pid_u32);
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