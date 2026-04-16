// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    cc_island_lib::run();
}