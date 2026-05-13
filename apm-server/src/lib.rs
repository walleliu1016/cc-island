// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! APM Server core library
//!
//! Provides modules for:
//! - GreptimeDB client (HTTP SQL API)
//! - API handlers (hooks, query, SSE)
//! - Tenant management
//! - Configuration

pub mod config;
pub mod greptime;
pub mod handler;
pub mod tenant;

pub use config::Config;
pub use greptime::GreptimeDBClient;