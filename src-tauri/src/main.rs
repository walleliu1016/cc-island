// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.contains(&"--background".to_string()) {
        // 后台模式：无 UI
        cc_island_lib::run_background();
    } else {
        // 默认模式：带 UI
        cc_island_lib::run();
    }
}