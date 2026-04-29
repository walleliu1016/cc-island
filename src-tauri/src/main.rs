// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    // 显示帮助
    if args.contains(&"--help".to_string()) || args.contains(&"-h".to_string()) {
        print_help();
        return;
    }

    // 检查是否是配置模式
    if args.contains(&"--config".to_string()) {
        // 配置模式：更新 settings.json 并退出
        cc_island_lib::run_config(&args);
        return;
    }

    // 检查是否是显示配置
    if args.contains(&"--show-config".to_string()) {
        cc_island_lib::show_config();
        return;
    }

    // 运行模式
    if args.contains(&"--background".to_string()) {
        // 后台模式：无 UI，应用命令行参数覆盖
        cc_island_lib::run_background_with_args(&args);
    } else {
        // 默认模式：带 UI
        cc_island_lib::run();
    }
}

fn print_help() {
    println!("CC-Island - Claude Code Instance Monitor");
    println!();
    println!("USAGE:");
    println!("  cc-island [OPTIONS]");
    println!();
    println!("RUN MODES:");
    println!("  (no flags)          Run with UI (default)");
    println!("  --background        Run in background mode (no UI)");
    println!();
    println!("CONFIGURATION:");
    println!("  --show-config       Show current configuration");
    println!("  --config [OPTIONS]  Update configuration and save");
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
    println!("EXAMPLES:");
    println!("  # Show current config");
    println!("  cc-island --show-config");
    println!();
    println!("  # Configure cloud mode");
    println!("  cc-island --config --cloud-mode --cloud-server-url ws://server:17528");
    println!();
    println!("  # Run in background with cloud mode");
    println!("  cc-island --background --cloud-mode --cloud-server-url ws://server:17528");
    println!();
    println!("  # Configure auto-allow permissions");
    println!("  cc-island --config --auto-allow-permissions");
}