// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! APM Collector module
//!
//! Collects APM data from hooks and JSONL parsing,
//! then sends to APM Server via HTTP.

mod collector;
mod sender;

pub use collector::ApmCollector;
pub use sender::ApmSender;