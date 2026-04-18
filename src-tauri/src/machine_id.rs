// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;
use twox_hash::XxHash64;

static DEVICE_TOKEN: OnceLock<String> = OnceLock::new();

/// Generate stable device token from network interface MAC address.
///
/// Token remains constant across app reinstall/updates/reboots.
/// Only changes when network hardware is replaced.
///
/// Uses the first active network interface's MAC address.
/// Result is cached after first call for performance.
pub fn get_machine_token() -> String {
    DEVICE_TOKEN.get_or_init(|| {
        let mac_address = get_mac_address();

        // Use two 64-bit hashes with different seeds for 128-bit result
        let mut hasher1 = XxHash64::with_seed(42);
        let mut hasher2 = XxHash64::with_seed(137);
        mac_address.hash(&mut hasher1);
        mac_address.hash(&mut hasher2);

        let hash1 = hasher1.finish();
        let hash2 = hasher2.finish();

        format_device_token(hash1, hash2)
    }).clone()
}

/// Get the MAC address of the first active network interface
fn get_mac_address() -> String {
    #[cfg(target_os = "macos")]
    {
        get_macos_mac_address()
    }

    #[cfg(target_os = "linux")]
    {
        get_linux_mac_address()
    }

    #[cfg(target_os = "windows")]
    {
        get_windows_mac_address()
    }
}

#[cfg(target_os = "macos")]
fn get_macos_mac_address() -> String {
    use std::process::Command;

    // Use networksetup to get MAC address of primary interface
    let output = Command::new("networksetup")
        .arg("-listallhardwareports")
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse output to find MAC address
        // Format: "Ethernet Address: xx:xx:xx:xx:xx:xx"
        for line in stdout.lines() {
            if line.contains("Ethernet Address:") || line.contains("Wi-Fi") {
                // Look for MAC address pattern in next lines or current
                if let Some(mac) = extract_mac_from_line(line) {
                    if mac != "00:00:00:00:00:00" && !mac.starts_with("00:") {
                        return mac.replace(':', "").replace('-', "").to_lowercase();
                    }
                }
            }
        }

        // Alternative: parse through the whole output for valid MAC
        for line in stdout.lines() {
            if let Some(mac) = extract_mac_from_line(line) {
                // Skip invalid MAC addresses
                if mac != "00:00:00:00:00:00" && !mac.starts_with("00:") {
                    return mac.replace(':', "").replace('-', "").to_lowercase();
                }
            }
        }
    }

    // Fallback: use ifconfig
    let ifconfig = Command::new("ifconfig")
        .output();

    if let Ok(output) = ifconfig {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Look for en0 (primary ethernet/WiFi interface)
        let mut current_interface = String::new();
        for line in stdout.lines() {
            if line.starts_with("en0") || line.starts_with("en1") {
                current_interface = line.split(':').next().unwrap_or("").to_string();
            }
            if !current_interface.is_empty() && line.contains("ether ") {
                if let Some(mac) = line.split("ether ").nth(1) {
                    let mac_clean = mac.trim().split_whitespace().next().unwrap_or("");
                    if mac_clean != "00:00:00:00:00:00" {
                        return mac_clean.replace(':', "").replace('-', "").to_lowercase();
                    }
                }
            }
        }
    }

    // Last resort fallback
    fallback_machine_id()
}

#[cfg(target_os = "linux")]
fn get_linux_mac_address() -> String {
    // Try to read from /sys/class/net/
    use std::fs;

    // Common interface names: eth0, enp0s3, wlan0
    let interfaces = ["eth0", "enp0s3", "wlan0", "wlp2s0", "eno1"];

    for iface in interfaces {
        let path = format!("/sys/class/net/{}/address", iface);
        if let Ok(mac) = fs::read_to_string(&path) {
            let mac_clean = mac.trim().replace(':', "").replace('-', "");
            if mac_clean != "000000000000" {
                return mac_clean.to_lowercase();
            }
        }
    }

    // Try to find any available interface
    if let Ok(entries) = fs::read_dir("/sys/class/net") {
        for entry in entries.flatten() {
            let iface_name = entry.file_name().to_string_lossy().to_string();
            if iface_name == "lo" { continue; }

            let path = format!("/sys/class/net/{}/address", iface_name);
            if let Ok(mac) = fs::read_to_string(&path) {
                let mac_clean = mac.trim().replace(':', "").replace('-', "");
                if mac_clean != "000000000000" {
                    return mac_clean.to_lowercase();
                }
            }
        }
    }

    fallback_machine_id()
}

#[cfg(target_os = "windows")]
fn get_windows_mac_address() -> String {
    use std::process::Command;

    let output = Command::new("ipconfig")
        .arg("/all")
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);

        // Look for "Physical Address" lines
        for line in stdout.lines() {
            if line.contains("Physical Address") || line.contains("物理地址") {
                if let Some(mac) = extract_mac_from_line(line) {
                    if mac != "00-00-00-00-00-00" && mac != "00:00:00:00:00:00" {
                        return mac.replace(':', "").replace('-', "").to_lowercase();
                    }
                }
            }
        }
    }

    fallback_machine_id()
}

/// Extract MAC address from a line containing "xx:xx:xx:xx:xx:xx" or "xx-xx-xx-xx-xx-xx"
fn extract_mac_from_line(line: &str) -> Option<String> {
    // MAC address patterns: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX
    let patterns = [':', '-'];

    for sep in patterns {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for part in parts {
            // Check if this looks like a MAC address
            let segments = part.split(sep).collect::<Vec<&str>>();
            if segments.len() == 6 {
                let is_valid_mac = segments.iter().all(|s| {
                    s.len() == 2 && s.chars().all(|c| c.is_ascii_hexdigit())
                });
                if is_valid_mac {
                    return Some(part.to_string());
                }
            }
        }
    }

    None
}

/// Fallback using hostname when MAC address unavailable
fn fallback_machine_id() -> String {
    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| {
            format!("unknown-{}", std::process::id())
        });

    hostname
}

/// Format two 64-bit hashes as a 32-char hex string (not UUID format, just unique identifier)
fn format_device_token(hash1: u64, hash2: u64) -> String {
    let bytes1 = hash1.to_be_bytes();
    let bytes2 = hash2.to_be_bytes();

    // Concatenate to form 16-byte unique identifier
    format!(
        "{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes1[0], bytes1[1], bytes1[2], bytes1[3],
        bytes1[4], bytes1[5], bytes1[6], bytes1[7],
        bytes2[0], bytes2[1], bytes2[2], bytes2[3],
        bytes2[4], bytes2[5], bytes2[6], bytes2[7]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_machine_token_format() {
        let token = get_machine_token();
        // Should be a 32-char hex string (16 bytes = 32 hex chars)
        assert_eq!(token.len(), 32);
        assert!(!token.contains('-'));
    }

    #[test]
    fn test_token_stability() {
        // Same machine should produce same token
        let token1 = get_machine_token();
        let token2 = get_machine_token();
        assert_eq!(token1, token2);
    }

    #[test]
    fn test_print_token() {
        let token = get_machine_token();
        println!("MAC Address: {}", get_mac_address());
        println!("Device Token: {}", token);
    }
}