use std::collections::HashMap;
use parking_lot::RwLock;
use crate::messages::{SessionState, PopupState};

/// In-memory cache of device state for quick access
#[derive(Clone)]
pub struct DeviceState {
    pub sessions: Vec<SessionState>,
    pub popups: Vec<PopupState>,
}

/// State cache managing all device states
pub struct StateCache {
    devices: RwLock<HashMap<String, DeviceState>>,
}

impl StateCache {
    pub fn new() -> Self {
        Self {
            devices: RwLock::new(HashMap::new()),
        }
    }

    /// Update device state (sessions and popups)
    pub fn update_state(&self, device_token: &str, sessions: Vec<SessionState>, popups: Vec<PopupState>) {
        let mut devices = self.devices.write();
        devices.insert(device_token.to_string(), DeviceState { sessions, popups });
    }

    /// Get device state
    pub fn get_state(&self, device_token: &str) -> Option<DeviceState> {
        let devices = self.devices.read();
        devices.get(device_token).cloned()
    }

    /// Add a popup to device state
    pub fn add_popup(&self, device_token: &str, popup: PopupState) {
        let mut devices = self.devices.write();
        if let Some(state) = devices.get_mut(device_token) {
            // Remove existing popup with same id
            state.popups.retain(|p| p.id != popup.id);
            state.popups.push(popup);
        } else {
            devices.insert(device_token.to_string(), DeviceState {
                sessions: vec![],
                popups: vec![popup],
            });
        }
    }

    /// Remove a popup from device state
    pub fn remove_popup(&self, device_token: &str, popup_id: &str) {
        let mut devices = self.devices.write();
        if let Some(state) = devices.get_mut(device_token) {
            state.popups.retain(|p| p.id != popup_id);
        }
    }

    /// Remove device from cache (when disconnected)
    pub fn remove_device(&self, device_token: &str) {
        let mut devices = self.devices.write();
        devices.remove(device_token);
    }
}

impl Default for StateCache {
    fn default() -> Self {
        Self::new()
    }
}