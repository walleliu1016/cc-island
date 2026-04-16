// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "linux")]
pub mod linux;

use crate::instance_manager::{ProcessInfo, TerminalType};

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