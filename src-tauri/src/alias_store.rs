// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use crate::config::get_cc_island_dir;

/// Aliases storage structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AliasesStore {
    /// Map of cwd -> alias
    pub aliases: HashMap<String, String>,
}

/// Get aliases file path
fn get_aliases_file_path() -> PathBuf {
    get_cc_island_dir().join("aliases.json")
}

/// Load aliases from file
pub fn load_aliases() -> AliasesStore {
    let aliases_path = get_aliases_file_path();

    if !aliases_path.exists() {
        tracing::info!("No aliases file found, using empty store");
        return AliasesStore::default();
    }

    match fs::read_to_string(&aliases_path) {
        Ok(content) => {
            match serde_json::from_str::<AliasesStore>(&content) {
                Ok(store) => {
                    tracing::info!("Loaded {} aliases from {}", store.aliases.len(), aliases_path.display());
                    store
                }
                Err(e) => {
                    tracing::warn!("Failed to parse aliases, using empty store: {}", e);
                    AliasesStore::default()
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to read aliases file: {}", e);
            AliasesStore::default()
        }
    }
}

/// Save aliases to file
pub fn save_aliases(store: &AliasesStore) -> Result<(), String> {
    let cc_island_dir = get_cc_island_dir();

    // Create directory if not exists
    if !cc_island_dir.exists() {
        fs::create_dir_all(&cc_island_dir)
            .map_err(|e| format!("Failed to create cc-island directory: {}", e))?;
    }

    let aliases_path = get_aliases_file_path();
    let content = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize aliases: {}", e))?;

    fs::write(&aliases_path, content)
        .map_err(|e| format!("Failed to write aliases: {}", e))?;

    tracing::info!("Saved {} aliases to {}", store.aliases.len(), aliases_path.display());
    Ok(())
}

/// Get alias for a cwd
pub fn get_alias(cwd: &str) -> Option<String> {
    let store = load_aliases();
    store.aliases.get(cwd).cloned()
}

/// Set alias for a cwd
pub fn set_alias(cwd: &str, alias: &str) -> Result<(), String> {
    let mut store = load_aliases();

    if alias.is_empty() {
        // Remove alias if empty string provided
        store.aliases.remove(cwd);
    } else {
        store.aliases.insert(cwd.to_string(), alias.to_string());
    }

    save_aliases(&store)
}

/// Get all aliases
pub fn get_all_aliases() -> HashMap<String, String> {
    load_aliases().aliases
}