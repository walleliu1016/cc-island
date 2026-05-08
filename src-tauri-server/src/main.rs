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
//! # Run with temporary parameters (not saved to config)
//! cc-island-server run --cloud-mode --cloud-server-url ws://server:17528
//!
//! # Shorthand (default subcommand = run)
//! cc-island-server --cloud-mode --cloud-server-url ws://server:17528
//!
//! # Configuration management (persistent)
//! cc-island-server config show                          # Show current config
//! cc-island-server config set --cloud-mode              # Set and save
//! cc-island-server config reset                         # Reset to defaults
//!
//! # Pairing info
//! cc-island-server pair-info                            # Show full pairing info
//! cc-island-server device-token                         # Show device token only
//! ```

use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    // No arguments -> default run
    if args.len() == 1 {
        run_server(&args[1..]);
        return;
    }

    let first_arg = &args[1];

    // Global flags (handled before subcommands)
    if first_arg == "--help" || first_arg == "-h" {
        print_help();
        return;
    }
    if first_arg == "--version" || first_arg == "-V" {
        println!("cc-island-server {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    // Subcommand parsing
    match first_arg.as_str() {
        "run" => {
            // run subcommand: temporary startup, parameters NOT saved
            run_server(&args[2..]);
        }
        "config" => {
            handle_config_subcommand(&args[2..]);
        }
        "pair-info" => {
            cc_island_lib::show_pair_info();
        }
        "device-token" => {
            show_device_token();
        }
        _ => {
            // Shorthand mode: treat as run arguments
            // e.g., cc-island-server --cloud-mode -> run --cloud-mode
            run_server(&args[1..]);
        }
    }
}

/// Handle config subcommand: show, set, reset
fn handle_config_subcommand(args: &[String]) {
    if args.is_empty() {
        println!("Usage: cc-island-server config <show|set|reset> [OPTIONS]");
        println!();
        println!("Subcommands:");
        println!("  show          Show current configuration");
        println!("  set [OPTIONS] Set configuration options and save");
        println!("  reset         Reset to default configuration");
        return;
    }

    let subcmd = &args[0];
    match subcmd.as_str() {
        "show" => {
            cc_island_lib::show_config();
        }
        "set" => {
            // config set: parse args and save to config file
            cc_island_lib::config_set(&args[1..]);
        }
        "reset" => {
            cc_island_lib::config_reset();
        }
        "--help" | "-h" => {
            println!("Config subcommand - manage persistent configuration");
            println!();
            println!("Usage:");
            println!("  cc-island-server config show                      Show current config");
            println!("  cc-island-server config set [OPTIONS]             Set and save");
            println!("  cc-island-server config reset                     Reset to defaults");
            println!();
            println!("Available OPTIONS for 'set':");
            println!("  --cloud-mode                      Enable cloud relay mode");
            println!("  --no-cloud-mode                   Disable cloud relay mode");
            println!("  --cloud-server-url <URL>          Cloud server WebSocket URL");
            println!("  --device-name <NAME>              Device name");
            println!("  --enable-logging                  Enable file logging");
            println!("  --no-enable-logging               Disable file logging");
            println!("  --permission-timeout <SECS>       Permission timeout (default: 300)");
            println!("  --ask-timeout <SECS>              Ask timeout (default: 120)");
            println!("  --auto-deny-on-timeout            Auto deny on timeout");
            println!("  --no-auto-deny-on-timeout         Disable auto deny");
            println!("  --auto-allow-permissions          Auto allow all permissions");
            println!("  --no-auto-allow-permissions       Disable auto allow");
            println!("  --poll-interval <MS>              Poll interval (default: 500)");
            println!("  --max-instances <N>               Max instances (default: 10)");
            println!("  --max-popup-queue <N>             Max popup queue (default: 5)");
            println!("  --hook-forward-url <URL>          Forward hooks to URL");
            println!("  --enabled-hooks <HOOKS>           Enabled hooks (comma-separated)");
            println!("  --show-thinking-messages          Show thinking messages");
            println!("  --no-show-thinking-messages       Hide thinking messages");
        }
        _ => {
            println!("Unknown config subcommand: {}", subcmd);
            println!("Available: show, set, reset");
        }
    }
}

/// Run server with temporary parameters (not saved to config file)
fn run_server(args: &[String]) {
    println!("Starting CC-Island Server in background mode...");
    println!("Press Ctrl+C to stop.");
    println!();

    // Use temporary parameters (priority: CLI args > config file > defaults)
    cc_island_lib::run_background_temporary(args);
}

/// Show device token only
fn show_device_token() {
    let token = cc_island_lib::machine_id::get_machine_token();
    println!("Device Token: {}", token);
    println!();
    println!("Usage:");
    println!("1. In Mobile App Settings, click '+'");
    println!("2. Enter this Device Token");
    println!("3. Ensure Cloud Server is running");
    println!("4. Desktop needs cloud_mode enabled");
}

fn print_help() {
    println!("CC-Island Server - Claude Code Instance Monitor (Background Mode)");
    println!("Version: {}", env!("CARGO_PKG_VERSION"));
    println!();
    println!("USAGE:");
    println!("  cc-island-server [SUBCOMMAND] [OPTIONS]");
    println!();
    println!("SUBCOMMANDS:");
    println!("  run [OPTIONS]              Run in background mode (default subcommand)");
    println!("  config <show|set|reset>    Manage configuration");
    println!("  pair-info                  Show full pairing info (token + server URL)");
    println!("  device-token               Show device token only");
    println!();
    println!("RUN OPTIONS (temporary, not saved):");
    println!("  --cloud-mode                      Enable cloud relay mode");
    println!("  --no-cloud-mode                   Disable cloud relay mode");
    println!("  --cloud-server-url <URL>          Cloud server WebSocket URL");
    println!("  --device-name <NAME>              Device name");
    println!("  --enable-logging                  Enable file logging");
    println!("  --no-enable-logging               Disable file logging");
    println!("  --permission-timeout <SECS>       Permission timeout (default: 300)");
    println!("  --ask-timeout <SECS>              Ask timeout (default: 120)");
    println!("  --auto-deny-on-timeout            Auto deny on timeout");
    println!("  --no-auto-deny-on-timeout         Disable auto deny");
    println!("  --auto-allow-permissions          Auto allow all permissions");
    println!("  --no-auto-allow-permissions       Disable auto allow");
    println!("  --poll-interval <MS>              Poll interval (default: 500)");
    println!("  --max-instances <N>               Max instances (default: 10)");
    println!("  --max-popup-queue <N>             Max popup queue (default: 5)");
    println!("  --hook-forward-url <URL>          Forward hooks to URL");
    println!("  --enabled-hooks <HOOKS>           Enabled hooks (comma-separated)");
    println!("  --show-thinking-messages          Show thinking messages");
    println!("  --no-show-thinking-messages       Hide thinking messages");
    println!();
    println!("GLOBAL OPTIONS:");
    println!("  --help, -h                        Show this help message");
    println!("  --version, -V                     Show version");
    println!();
    println!("EXAMPLES:");
    println!("  # Run with temporary parameters");
    println!("  cc-island-server --cloud-mode --cloud-server-url ws://server:17528");
    println!();
    println!("  # Run with explicit subcommand");
    println!("  cc-island-server run --cloud-mode");
    println!();
    println!("  # Show current configuration");
    println!("  cc-island-server config show");
    println!();
    println!("  # Set configuration (persistent)");
    println!("  cc-island-server config set --cloud-mode --cloud-server-url ws://server:17528");
    println!();
    println!("  # Reset to default configuration");
    println!("  cc-island-server config reset");
    println!();
    println!("  # Show pairing info");
    println!("  cc-island-server pair-info");
    println!();
    println!("PARAMETER PRIORITY:");
    println!("  run subcommand:   CLI args > config file > defaults (temporary)");
    println!("  config set:       Save to config file (persistent)");
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