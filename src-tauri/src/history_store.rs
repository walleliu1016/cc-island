// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use crate::instance_manager::ClaudeInstance;
use crate::instance_manager::SessionId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const HISTORY_FILE: &str = "sessions.json";
const DEFAULT_MAX_AGE_DAYS: u32 = 30;
const MAX_HISTORY_SESSIONS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryData {
    sessions: HashMap<SessionId, ClaudeInstance>,
}

pub struct HistoryStore {
    path: PathBuf,
    sessions: HashMap<SessionId, ClaudeInstance>,
    max_age_days: u32,
}

impl HistoryStore {
    pub fn new() -> Self {
        let path = crate::config::get_cc_island_dir().join(HISTORY_FILE);
        let mut store = Self {
            path,
            sessions: HashMap::new(),
            max_age_days: DEFAULT_MAX_AGE_DAYS,
        };
        store.load();
        store.cleanup();
        store
    }

    fn load(&mut self) {
        if !self.path.exists() {
            return;
        }
        match fs::read_to_string(&self.path) {
            Ok(content) => {
                match serde_json::from_str::<HistoryData>(&content) {
                    Ok(data) => {
                        self.sessions = data.sessions;
                        tracing::info!("Loaded {} history sessions", self.sessions.len());
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse history file: {}", e);
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Failed to read history file: {}", e);
            }
        }
    }

    fn save(&self) {
        let dir = self.path.parent().unwrap();
        if !dir.exists() {
            let _ = fs::create_dir_all(dir);
        }

        // Trim excess ended sessions to MAX_HISTORY_SESSIONS
        let mut sorted: Vec<_> = self.sessions.iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        sorted.sort_by_key(|(_, s)| std::cmp::Reverse(s.last_activity_at));

        let mut trimmed_sessions: HashMap<SessionId, ClaudeInstance> = HashMap::new();
        let mut ended_count = 0usize;
        for (id, inst) in sorted {
            let is_ended = matches!(inst.status, crate::instance_manager::InstanceStatus::Ended);
            if is_ended {
                if ended_count >= MAX_HISTORY_SESSIONS {
                    continue; // skip excess ended sessions
                }
                ended_count += 1;
            }
            trimmed_sessions.insert(id, inst);
        }

        let data = HistoryData {
            sessions: trimmed_sessions,
        };
        match serde_json::to_string_pretty(&data) {
            Ok(content) => {
                if let Err(e) = fs::write(&self.path, &content) {
                    tracing::error!("Failed to write history file: {}", e);
                }
            }
            Err(e) => {
                tracing::error!("Failed to serialize history data: {}", e);
            }
        }
    }

    pub fn add(&mut self, instance: ClaudeInstance) {
        self.sessions.insert(instance.session_id.clone(), instance);
        self.save();
    }

    pub fn upsert(&mut self, instance: ClaudeInstance) {
        self.sessions.insert(instance.session_id.clone(), instance);
        self.save();
    }

    pub fn remove(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
        self.save();
    }

    pub fn get_all(&self) -> Vec<ClaudeInstance> {
        let mut sessions: Vec<_> = self.sessions.values().cloned().collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));
        sessions
    }

    pub fn get(&self, session_id: &str) -> Option<&ClaudeInstance> {
        self.sessions.get(session_id)
    }

    pub fn get_ended(&self) -> Vec<ClaudeInstance> {
        let mut sessions: Vec<_> = self.sessions.values()
            .filter(|s| matches!(s.status, crate::instance_manager::InstanceStatus::Ended))
            .cloned()
            .collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity_at));
        sessions.truncate(MAX_HISTORY_SESSIONS);
        sessions
    }

    pub fn cleanup(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let cutoff = now - (self.max_age_days as u64 * 86400);
        let before = self.sessions.len();
        self.sessions.retain(|_, inst| {
            !matches!(inst.status, crate::instance_manager::InstanceStatus::Ended) || inst.last_activity_at >= cutoff
        });
        if self.sessions.len() != before {
            self.save();
            tracing::info!("Cleaned {} expired history sessions", before - self.sessions.len());
        }
    }
}
