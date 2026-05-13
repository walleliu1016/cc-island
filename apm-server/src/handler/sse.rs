// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! SSE real-time stream handler
//!
//! Broadcasts hook events to connected clients

use axum::{
    extract::State,
    http::HeaderMap,
    response::sse::{Event, Sse},
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::debug;

/// SSE broadcaster
pub struct SseBroadcaster {
    sender: broadcast::Sender<String>,
}

impl SseBroadcaster {
    pub fn new() -> Arc<Self> {
        let (sender, _) = broadcast::channel(100);
        Arc::new(Self { sender })
    }

    /// Subscribe to broadcasts
    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.sender.subscribe()
    }

    /// Broadcast event to all subscribers
    pub fn broadcast(&self, data: &str) {
        if let Err(_) = self.sender.send(data.to_string()) {
            // No subscribers, ignore
        }
    }
}

/// Handle GET /api/stream
pub async fn handle_sse(
    State(_state): State<crate::handler::AppState>,
    headers: HeaderMap,
) -> Sse<impl futures::Stream<Item = Result<Event, axum::Error>>> {
    // Extract tenant info
    let user_id = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    debug!("SSE client connected: user={}", user_id);

    // Create a simple heartbeat stream using interval
    use futures::StreamExt;

    let stream = tokio_stream::wrappers::IntervalStream::new(
        tokio::time::interval(Duration::from_secs(15))
    ).map(|_| Ok(Event::default().data("{\"type\":\"heartbeat\"}")));

    Sse::new(stream)
}