// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tokio::sync::oneshot;
use std::fmt;

/// Popup type
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PopupType {
    Permission,
    Ask,
    Notification,
}

impl fmt::Display for PopupType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PopupType::Permission => write!(f, "permission"),
            PopupType::Ask => write!(f, "ask"),
            PopupType::Notification => write!(f, "notification"),
        }
    }
}

/// Popup status
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PopupStatus {
    Pending,
    Processing,
    Resolved,
    AutoClose,
}

impl fmt::Display for PopupStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PopupStatus::Pending => write!(f, "pending"),
            PopupStatus::Processing => write!(f, "processing"),
            PopupStatus::Resolved => write!(f, "resolved"),
            PopupStatus::AutoClose => write!(f, "autoclose"),
        }
    }
}

/// Permission request data (re-export from hook_handler)
pub use crate::hook_handler::PermissionData;

/// Ask question option
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskOption {
    pub label: String,
    pub description: Option<String>,
}

/// Single question in ask
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskQuestion {
    pub header: String,
    pub question: String,
    pub multi_select: bool,
    pub options: Vec<AskOption>,
}

/// Ask question data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskData {
    pub questions: Vec<AskQuestion>,
}

/// Notification data (re-export from hook_handler)
pub use crate::hook_handler::NotificationData;

/// A popup item in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PopupItem {
    pub id: String,
    pub session_id: String,
    pub project_name: String,
    #[serde(rename = "type")]
    pub popup_type: PopupType,
    pub permission_data: Option<crate::hook_handler::PermissionData>,
    pub ask_data: Option<AskData>,
    pub notification_data: Option<crate::hook_handler::NotificationData>,
    pub status: PopupStatus,
    pub created_at: u64,
    pub auto_close_at: Option<u64>,
    pub timeout_at: Option<u64>,
}

/// Response from user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PopupResponse {
    pub popup_id: String,
    pub decision: Option<String>,  // "allow" or "deny" for permission
    pub answer: Option<String>,    // answer for ask (JSON string for multi-question)
    pub answers: Option<Vec<Vec<String>>>,  // answers for multi-question ask (array of selected options per question)
}

/// Waiting context for blocking responses
pub struct WaitingContext {
    pub popup_id: String,
    pub responder: oneshot::Sender<PopupResponse>,
    pub timeout: std::time::Instant,
}

/// Manages popup queue
pub struct PopupQueue {
    queue: VecDeque<PopupItem>,
    waiting: HashMap<String, WaitingContext>,
    max_displayed: usize,
}

use std::collections::HashMap;

impl PopupQueue {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            waiting: HashMap::new(),
            max_displayed: 5,
        }
    }

    pub fn add(&mut self, popup: PopupItem) {
        self.queue.push_back(popup);
    }

    pub fn get(&self, id: &str) -> Option<&PopupItem> {
        self.queue.iter().find(|p| p.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut PopupItem> {
        self.queue.iter_mut().find(|p| p.id == id)
    }

    pub fn remove(&mut self, id: &str) {
        self.queue.retain(|p| p.id != id);
    }

    pub fn get_pending(&self) -> Vec<&PopupItem> {
        self.queue
            .iter()
            .filter(|p| p.status == PopupStatus::Pending)
            .collect()
    }

    pub fn count_pending(&self) -> usize {
        self.queue
            .iter()
            .filter(|p| p.status == PopupStatus::Pending)
            .count()
    }

    pub fn get_displayed(&self) -> Vec<&PopupItem> {
        self.queue
            .iter()
            .filter(|p| p.status == PopupStatus::Pending)
            .take(self.max_displayed)
            .collect()
    }

    pub fn get_all(&self) -> Vec<PopupItem> {
        self.queue.iter().cloned().collect()
    }

    /// Register a waiter for blocking response
    pub fn register_waiter(&mut self, popup_id: String, responder: oneshot::Sender<PopupResponse>, timeout_secs: u64) {
        let timeout = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
        self.waiting.insert(popup_id.clone(), WaitingContext {
            popup_id,
            responder,
            timeout,
        });
    }

    /// Resolve a waiting popup
    pub fn resolve(&mut self, response: PopupResponse) -> bool {

        if let Some(waiting) = self.waiting.remove(&response.popup_id) {
            // Update popup status
            if let Some(popup) = self.get_mut(&response.popup_id) {
                popup.status = PopupStatus::Resolved;
            }

            // Send response
            let _ = waiting.responder.send(response);
            return true;
        }

        false
    }

    /// Check for timeouts and auto-resolve
    pub fn check_timeouts(&mut self) -> Vec<String> {
        let now = std::time::Instant::now();
        let timed_out: Vec<String> = self.waiting
            .iter()
            .filter(|(_, w)| now >= w.timeout)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &timed_out {
            if let Some(waiting) = self.waiting.remove(id) {
                // Auto-deny permission, empty answer for ask
                let auto_response = PopupResponse {
                    popup_id: id.clone(),
                    decision: Some("deny".to_string()),
                    answer: None,
                    answers: None,
                };
                let _ = waiting.responder.send(auto_response);

                if let Some(popup) = self.get_mut(id) {
                    popup.status = PopupStatus::AutoClose;
                }
            }
        }

        timed_out
    }

    /// Cleanup resolved/auto-closed popups
    pub fn cleanup(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        self.queue.retain(|p| {
            if p.status == PopupStatus::Resolved || p.status == PopupStatus::AutoClose {
                // Keep for 1 second for UI feedback
                if let Some(auto_close) = p.auto_close_at {
                    return now < auto_close + 1000;
                }
                return now < p.created_at + 1000;
            }
            true
        });
    }

    /// Cancel all pending popups for a session (when session ends)
    pub fn cancel_session_popups(&mut self, session_id: &str) -> Vec<String> {
        let cancelled_ids: Vec<String> = self.queue
            .iter()
            .filter(|p| p.session_id == session_id && p.status == PopupStatus::Pending)
            .map(|p| p.id.clone())
            .collect();

        for id in &cancelled_ids {
            // Send deny response to waiting hooks
            if let Some(waiting) = self.waiting.remove(id) {
                let auto_response = PopupResponse {
                    popup_id: id.clone(),
                    decision: Some("deny".to_string()),
                    answer: None,
                    answers: None,
                };
                let _ = waiting.responder.send(auto_response);
            }

            // Update popup status
            if let Some(popup) = self.get_mut(id) {
                popup.status = PopupStatus::Resolved;
            }
        }

        cancelled_ids
    }
}

impl Default for PopupQueue {
    fn default() -> Self {
        Self::new()
    }
}