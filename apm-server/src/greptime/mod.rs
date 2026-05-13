// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! GreptimeDB HTTP SQL API client
//!
//! Provides:
//! - INSERT batch writing
//! - SELECT query returning JSON
//! - DDL execution (table creation)
//! - Flow creation

mod client;
pub mod schema;
pub mod flows;

pub use client::GreptimeDBClient;
pub use schema::{HookEventRecord, MessageRecord};