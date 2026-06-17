// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CONFIG_FILE: &str = "restart_config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestartConfig {
    #[serde(default)]
    pub default_args: Vec<String>,
    #[serde(default)]
    pub saved_presets: Vec<Preset>,
}

impl Default for RestartConfig {
    fn default() -> Self {
        Self {
            default_args: vec![],
            saved_presets: vec![],
        }
    }
}

pub fn load_restart_config() -> RestartConfig {
    let path = crate::config::get_cc_island_dir().join(CONFIG_FILE);
    if !path.exists() {
        let defaults = RestartConfig::default();
        if let Err(e) = save_restart_config_to(&path, &defaults) {
            tracing::warn!("Failed to create default restart config: {}", e);
        }
        return defaults;
    }
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<RestartConfig>(&content) {
            Ok(config) => config,
            Err(e) => {
                tracing::warn!("Failed to parse restart config, using defaults: {}", e);
                RestartConfig::default()
            }
        },
        Err(e) => {
            tracing::warn!("Failed to read restart config, using defaults: {}", e);
            RestartConfig::default()
        }
    }
}

fn save_restart_config(config: &RestartConfig) {
    let path = crate::config::get_cc_island_dir().join(CONFIG_FILE);
    if let Err(e) = save_restart_config_to(&path, config) {
        tracing::error!("Failed to save restart config: {}", e);
    }
}

fn save_restart_config_to(path: &PathBuf, config: &RestartConfig) -> Result<(), String> {
    let dir = path.parent().unwrap();
    if !dir.exists() {
        let _ = fs::create_dir_all(dir);
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, &content).map_err(|e| e.to_string())
}

pub fn get_restart_config_snapshot() -> RestartConfig {
    load_restart_config()
}

pub fn save_restart_preset(name: String, args: String) -> Result<(), String> {
    let mut config = load_restart_config();
    // Remove existing preset with same name
    config.saved_presets.retain(|p| p.name != name);
    config.saved_presets.push(Preset { name, args });
    save_restart_config(&config);
    Ok(())
}

pub fn delete_restart_preset(name: String) -> Result<(), String> {
    let mut config = load_restart_config();
    config.saved_presets.retain(|p| p.name != name);
    save_restart_config(&config);
    Ok(())
}
