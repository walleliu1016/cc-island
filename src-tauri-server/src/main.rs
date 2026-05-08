// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! Server binary entry point (no UI)
//!
//! This binary runs in background mode without Tauri GUI dependencies.
//! Suitable for server/headless deployment on any Linux system.
//!
//! # Build
//!
//! ```bash
//! cargo build --release --bin cc-island-server
//! ```
//!
//! # Usage
//!
//! ```bash
//! # Show help
//! cc-island-server --help
//!
//! # Show device token for Mobile pairing
//! cc-island-server --device-token
//!
//! # Show full pairing info (token + server URL)
//! cc-island-server --pair-info
//!
//! # Configure and run
//! cc-island-server --config --cloud-mode --cloud-server-url ws://server:17528
//! cc-island-server
//!
//! # Show current config
//! cc-island-server --show-config
//! ```

use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    // Show help
    if args.contains(&"--help".to_string()) || args.contains(&"-h".to_string()) {
        print_help();
        return;
    }

    // Show version
    if args.contains(&"--version".to_string()) || args.contains(&"-V".to_string()) {
        println!("cc-island-server {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    // Show device token
    if args.contains(&"--device-token".to_string()) {
        let token = cc_island_lib::machine_id::get_machine_token();
        println!("Device Token: {}", token);
        println!();
        println!("Usage:");
        println!("1. In Mobile App Settings, click '+'");
        println!("2. Enter this Device Token");
        println!("3. Ensure Cloud Server is running");
        println!("4. Desktop needs cloud_mode enabled");
        return;
    }

    // Show pairing info
    if args.contains(&"--pair-info".to_string()) {
        cc_island_lib::show_pair_info();
        return;
    }

    // Show config
    if args.contains(&"--show-config".to_string()) {
        cc_island_lib::show_config();
        return;
    }

    // Config mode
    if args.contains(&"--config".to_string()) {
        cc_island_lib::run_config(&args);
        return;
    }

    // Default: run in background mode
    println!("Starting CC-Island Server in background mode...");
    println!("Press Ctrl+C to stop.");
    println!();
    cc_island_lib::run_background_with_args(&args);
}

fn print_help() {
    println!("CC-Island Server - Claude Code Instance Monitor (Background Mode)");
    println!("Version: {}", env!("CARGO_PKG_VERSION"));
    println!();
    println!("USAGE:");
    println!("  cc-island-server [OPTIONS]");
    println!();
    println!("RUN MODE:");
    println!("  (no flags)            Run in background mode (no UI)");
    println!();
    println!("PAIRING (Mobile App):");
    println!("  --device-token        Show device token for Mobile pairing");
    println!("  --pair-info           Show full pairing info (token + server URL)");
    println!();
    println!("CONFIGURATION:");
    println!("  --show-config         Show current configuration");
    println!("  --config [OPTIONS]    Update configuration and save");
    println!();
    println!("CONFIG OPTIONS:");
    println!("  --cloud-mode                    Enable cloud relay mode");
    println!("  --no-cloud-mode                 Disable cloud relay mode");
    println!("  --cloud-server-url <URL>        Cloud server WebSocket URL");
    println!("  --device-name <NAME>            Device name for identification");
    println!("  --enable-logging                Enable file logging");
    println!("  --permission-timeout <SECS>     Permission request timeout (default: 300)");
    println!("  --ask-timeout <SECS>            Ask question timeout (default: 120)");
    println!("  --auto-deny-on-timeout          Auto deny on timeout (default: true)");
    println!("  --no-auto-deny-on-timeout       Disable auto deny on timeout");
    println!("  --auto-allow-permissions        Auto allow all permissions");
    println!("  --poll-interval <MS>            Poll interval (default: 500)");
    println!("  --max-instances <N>             Max concurrent instances (default: 10)");
    println!("  --max-popup-queue <N>           Max pending popups (default: 5)");
    println!("  --hook-forward-url <URL>        Forward hooks to HTTP URL");
    println!("  --enabled-hooks <HOOKS>         Enabled hooks (comma-separated)");
    println!("  --show-thinking-messages        Show thinking messages");
    println!("  --no-show-thinking-messages     Hide thinking messages");
    println!();
    println!("OTHER OPTIONS:");
    println!("  --help, -h                      Show this help message");
    println!("  --version, -V                   Show version");
    println!();
    println!("EXAMPLES:");
    println!("  # Show device token for Mobile pairing");
    println!("  cc-island-server --device-token");
    println!();
    println!("  # Show full pairing info");
    println!("  cc-island-server --pair-info");
    println!();
    println!("  # Configure and run");
    println!("  cc-island-server --config --cloud-mode --cloud-server-url ws://server:17528");
    println!("  cc-island-server");
    println!();
    println!("  # Show current config");
    println!("  cc-island-server --show-config");
    println!();
    println!("COMPATIBILITY:");
    println!("  This binary can be built with:");
    println!("  - musl static linking (recommended): runs on any Linux system");
    println!("  - glibc dynamic linking: runs on systems with compatible glibc");
    println!();
    println!("  musl static build (recommended for servers):");
    println!("    cargo build --release --target x86_64-unknown-linux-musl");
    println!();
}