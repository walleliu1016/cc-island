use crate::instance_manager::{ProcessInfo, TerminalType};
use std::process::Command;

/// Jump to terminal window on Windows
/// Only activate the specific window containing the Claude session
pub fn jump_to_terminal_windows(process_info: &ProcessInfo) -> bool {
    let terminal_pid = process_info.terminal_pid;
    let project_name = extract_project_name_from_cwd(&process_info.working_directory);

    match process_info.terminal_type {
        TerminalType::WindowsTerminal => activate_window_by_title(&project_name, terminal_pid),
        TerminalType::WindowsPowershell => activate_window_by_title(&project_name, terminal_pid),
        TerminalType::WindowsCmd => activate_window_by_title(&project_name, terminal_pid),
        TerminalType::WindowsGitBash => activate_window_by_title(&project_name, terminal_pid),
        _ => activate_by_pid(terminal_pid),
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

/// Activate window by searching for project name in window title
/// This ensures only the specific window is activated, not all windows of the app
fn activate_window_by_title(project_name: &str, fallback_pid: u32) -> bool {
    // Use PowerShell to find and activate the specific window by title
    // Window title typically contains the project path or name
    // Also handles minimized windows by restoring them first
    let ps_script = format!(
        r#"
$projectName = "{}"
$found = $false

# Get all processes that might be terminal windows
$terminals = Get-Process -Name 'WindowsTerminal', 'powershell', 'cmd', 'mintty' -ErrorAction SilentlyContinue

foreach ($proc in $terminals) {{
    $title = $proc.MainWindowTitle
    if ($title -and ($title -like "*$projectName*" -or $title -like "*Claude*")) {{
        # Restore window from minimized state if needed
        $wshell = New-Object -ComObject WScript.Shell
        $wshell.AppActivate($title) | Out-Null
        Start-Sleep -Milliseconds 100
        # Send restore keystroke if still minimized
        $wshell.SendKeys("% r")  # Alt+Space then R (Restore)
        $found = $true
        break
    }}
}}

# Fallback: try to activate by the specific PID
if (-not $found) {{
    $proc = Get-Process -Id {} -ErrorAction SilentlyContinue
    if ($proc) {{
        $wshell = New-Object -ComObject WScript.Shell
        if ($proc.MainWindowTitle) {{
            $wshell.AppActivate($proc.MainWindowTitle) | Out-Null
            Start-Sleep -Milliseconds 100
            $wshell.SendKeys("% r")
        }}
    }}
}}
"#,
        project_name, fallback_pid
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                tracing::info!("Successfully activated window for project {}", project_name);
                true
            } else {
                tracing::warn!("PowerShell failed: {}", String::from_utf8_lossy(&result.stderr));
                activate_by_pid(fallback_pid)
            }
        }
        Err(e) => {
            tracing::warn!("Failed to run PowerShell: {}", e);
            activate_by_pid(fallback_pid)
        }
    }
}

/// Activate window by PID using PowerShell
fn activate_by_pid(pid: u32) -> bool {
    // Use PowerShell to find and activate window by PID
    let ps_script = format!(
        r#"
$proc = Get-Process -Id {} -ErrorAction SilentlyContinue
if ($proc) {{
    $wshell = New-Object -ComObject WScript.Shell
    if ($proc.MainWindowTitle) {{
        $wshell.AppActivate($proc.MainWindowTitle) | Out-Null
    }} else {{
        # Try parent process
        try {{
            $parent = Get-Process -Id $proc.Parent.Id -ErrorAction SilentlyContinue
            if ($parent -and $parent.MainWindowTitle) {{
                $wshell.AppActivate($parent.MainWindowTitle) | Out-Null
            }}
        }} catch {{}}
    }}
}}
"#,
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