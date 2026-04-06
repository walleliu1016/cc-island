pub mod macos;
// pub mod windows;
// pub mod linux;

use crate::instance_manager::{ProcessInfo, TerminalType};

/// Jump to terminal window containing the Claude process
pub fn jump_to_terminal(process_info: &ProcessInfo) -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::jump_to_terminal_macos(process_info)
    }

    #[cfg(target_os = "windows")]
    {
        // windows::jump_to_terminal_windows(process_info)
        false
    }

    #[cfg(target_os = "linux")]
    {
        // linux::jump_to_terminal_linux(process_info)
        false
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        false
    }
}

/// Detect terminal type from process tree
pub fn detect_terminal_type(pid: u32) -> TerminalType {
    #[cfg(target_os = "macos")]
    {
        macos::detect_terminal_type_macos(pid)
    }

    #[cfg(not(target_os = "macos"))]
    {
        TerminalType::Unknown
    }
}

/// Find Claude process by working directory
pub fn find_claude_process_by_cwd(cwd: &str) -> Option<ProcessInfo> {
    #[cfg(target_os = "macos")]
    {
        macos::find_claude_process_by_cwd(cwd)
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Find any Claude process
pub fn find_any_claude_process() -> Option<ProcessInfo> {
    #[cfg(target_os = "macos")]
    {
        macos::find_any_claude_process()
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}