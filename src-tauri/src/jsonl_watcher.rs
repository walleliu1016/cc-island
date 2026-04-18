// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
//! JSONL file watcher for real-time conversation updates.
//! Uses polling-based approach for reliability.
//!
//! Architecture:
//! - JsonlWatcherManager: manages all session watchers
//! - Polls every 100ms to check for file updates
//!
//! Key features:
//! - Debounced updates (100ms)
//! - Proper resource cleanup on session end or app shutdown
//! - Independent from hook events

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use tokio::sync::mpsc::{channel, Sender};
use tokio::task::JoinHandle;
use tracing::{info, debug};

use crate::AppState;
use crate::conversation_parser::ConversationParser;

/// Debounce interval in milliseconds
const DEBOUNCE_MS: u64 = 100;

/// Session tracking info
struct SessionInfo {
    cwd: String,
    last_sync: Instant,
}

/// Manager for all JSONL watchers with periodic polling
pub struct JsonlWatcherManager {
    /// Active sessions being tracked (shared with poll task)
    sessions: Arc<RwLock<HashMap<String, SessionInfo>>>,
    /// Background polling task
    poll_task: Option<JoinHandle<()>>,
    /// Stop signal channel
    stop_tx: Option<Sender<()>>,
    /// App state reference
    app_state: Arc<RwLock<AppState>>,
}

impl JsonlWatcherManager {
    /// Create a new manager (not started yet)
    pub fn new(app_state: Arc<RwLock<AppState>>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            poll_task: None,
            stop_tx: None,
            app_state,
        }
    }

    /// Start the polling task
    pub fn start(&mut self) {
        if self.poll_task.is_some() {
            debug!("JsonlWatcherManager already running");
            return;
        }

        let (stop_tx, mut stop_rx) = channel::<()>(1);
        self.stop_tx = Some(stop_tx);

        let sessions = self.sessions.clone();
        let app_state = self.app_state.clone();

        self.poll_task = Some(tokio::spawn(async move {
            info!("📁 JsonlWatcherManager polling task started");

            loop {
                tokio::select! {
                    _ = stop_rx.recv() => {
                        info!("📁 JsonlWatcherManager stop signal received");
                        break;
                    }

                    _ = tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)) => {
                        Self::poll_all_sessions(&sessions, &app_state);
                    }
                }
            }

            info!("📁 JsonlWatcherManager polling task ended");
        }));

        info!("📁 JsonlWatcherManager started");
    }

    /// Poll all sessions for updates
    fn poll_all_sessions(
        sessions: &Arc<RwLock<HashMap<String, SessionInfo>>>,
        app_state: &Arc<RwLock<AppState>>,
    ) {
        let now = Instant::now();

        // Collect sessions needing sync (avoid holding lock during sync)
        let to_sync: Vec<(String, String)> = {
            let guard = sessions.read();
            guard.iter()
                .filter(|(_, info)| now.duration_since(info.last_sync) >= Duration::from_millis(DEBOUNCE_MS))
                .map(|(id, info)| (id.clone(), info.cwd.clone()))
                .collect()
        };

        // Sync each session
        for (session_id, cwd) in to_sync {
            Self::sync_session(&session_id, &cwd, app_state, sessions);
        }
    }

    /// Sync a single session's JSONL file
    fn sync_session(
        session_id: &str,
        cwd: &str,
        app_state: &Arc<RwLock<AppState>>,
        sessions: &Arc<RwLock<HashMap<String, SessionInfo>>>,
    ) {
        // Parse incrementally
        let new_messages = {
            let mut state = app_state.write();
            state.conversation_parser.parse_incremental(session_id, cwd)
        };

        // Update last_sync regardless of whether there are new messages
        {
            let mut guard = sessions.write();
            if let Some(info) = guard.get_mut(session_id) {
                info.last_sync = Instant::now();
            }
        }

        if new_messages.is_empty() {
            return;
        }

        info!("📁 JSONL update: {} new messages for session {}", new_messages.len(), session_id);

        // Convert and push
        let chat_messages = ConversationParser::to_chat_messages(new_messages);
        let msg_count = chat_messages.len();

        let state = app_state.read();
        if let Some(ref cloud_client) = state.cloud_client {
            if let Ok(client) = cloud_client.try_read() {
                if client.is_connected() {
                    client.push_chat_history(session_id, chat_messages);
                    info!("📁 Pushed {} messages to cloud for session {}", msg_count, session_id);
                }
            }
        }
    }

    /// Add a session to watch
    pub fn watch_session(&mut self, session_id: String, cwd: String) {
        let mut guard = self.sessions.write();
        guard.insert(session_id.clone(), SessionInfo {
            cwd,
            last_sync: Instant::now(),
        });
        info!("📁 JsonlWatcherManager: watching session {}", session_id);
    }

    /// Remove a session
    pub fn unwatch_session(&mut self, session_id: &str) {
        let mut guard = self.sessions.write();
        if guard.remove(session_id).is_some() {
            info!("📁 JsonlWatcherManager: stopped watching session {}", session_id);
        }
    }

    /// Stop all watching and cleanup
    pub fn stop(&mut self) {
        // Send stop signal
        if let Some(tx) = &self.stop_tx {
            tx.try_send(()).ok();
        }

        // Wait for task to finish (with timeout)
        if let Some(task) = self.poll_task.take() {
            // Abort after short wait
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                task.abort();
            });
        }

        // Clear sessions
        let mut guard = self.sessions.write();
        guard.clear();

        self.stop_tx = None;
        info!("📁 JsonlWatcherManager stopped");
    }

    /// Check if a session is being watched
    pub fn is_watching(&self, session_id: &str) -> bool {
        let guard = self.sessions.read();
        guard.contains_key(session_id)
    }

    /// Get count of watched sessions
    pub fn watched_count(&self) -> usize {
        let guard = self.sessions.read();
        guard.len()
    }
}

impl Drop for JsonlWatcherManager {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Safe wrapper that can be stored in AppState
/// Handles the async start/stop properly
pub struct JsonlWatcherHandle {
    manager: Option<JsonlWatcherManager>,
}

impl JsonlWatcherHandle {
    pub fn new(app_state: Arc<RwLock<AppState>>) -> Self {
        Self {
            manager: Some(JsonlWatcherManager::new(app_state)),
        }
    }

    pub fn start(&mut self) {
        if let Some(ref mut m) = self.manager {
            m.start();
        }
    }

    pub fn watch_session(&mut self, session_id: String, cwd: String) {
        if let Some(ref mut m) = self.manager {
            m.watch_session(session_id, cwd);
        }
    }

    pub fn unwatch_session(&mut self, session_id: &str) {
        if let Some(ref mut m) = self.manager {
            m.unwatch_session(session_id);
        }
    }

    pub fn stop(&mut self) {
        if let Some(ref mut m) = self.manager {
            m.stop();
        }
    }

    pub fn is_watching(&self, session_id: &str) -> bool {
        self.manager.as_ref().map(|m| m.is_watching(session_id)).unwrap_or(false)
    }
}

impl Drop for JsonlWatcherHandle {
    fn drop(&mut self) {
        self.stop();
    }
}