// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "linux")]
pub mod linux;

use crate::instance_manager::{ProcessInfo, TerminalType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub bundle_id: String,
    pub display_name: String,
}

/// Jump to terminal window containing the Claude process
pub fn jump_to_terminal(process_info: &ProcessInfo) -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::jump_to_terminal_macos(process_info)
    }

    #[cfg(target_os = "windows")]
    {
        windows::jump_to_terminal_windows(process_info)
    }

    #[cfg(target_os = "linux")]
    {
        linux::jump_to_terminal_linux(process_info)
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

    #[cfg(target_os = "windows")]
    {
        windows::detect_terminal_type_windows(pid)
    }

    #[cfg(target_os = "linux")]
    {
        linux::detect_terminal_type_linux(pid)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
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

    #[cfg(target_os = "windows")]
    {
        windows::find_claude_process_by_cwd(cwd)
    }

    #[cfg(target_os = "linux")]
    {
        linux::find_claude_process_by_cwd(cwd)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
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

    #[cfg(target_os = "windows")]
    {
        windows::find_any_claude_process()
    }

    #[cfg(target_os = "linux")]
    {
        linux::find_any_claude_process()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

/// Get available terminals on the current system
pub fn get_available_terminals() -> Vec<TerminalInfo> {
    #[cfg(target_os = "macos")]
    {
        macos::get_available_terminals_macos()
    }
    #[cfg(target_os = "linux")]
    {
        linux::get_available_terminals_linux()
    }
    #[cfg(target_os = "windows")]
    {
        windows::get_available_terminals_windows()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![]
    }
}

/// Launch a command in the specified terminal
pub fn launch_in_terminal(terminal_bundle_id: &str, command: &str, cwd: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::launch_in_terminal_macos(terminal_bundle_id, command, cwd)
    }
    #[cfg(target_os = "linux")]
    {
        linux::launch_in_terminal_linux(terminal_bundle_id, command, cwd)
    }
    #[cfg(target_os = "windows")]
    {
        windows::launch_in_terminal_windows(terminal_bundle_id, command, cwd)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}

/// Check if a process with the given PID is still running
pub fn is_process_alive(pid: u32) -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::is_process_alive(pid)
    }
    #[cfg(target_os = "linux")]
    {
        linux::is_process_alive(pid)
    }
    #[cfg(target_os = "windows")]
    {
        windows::is_process_alive(pid)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        false
    }
}