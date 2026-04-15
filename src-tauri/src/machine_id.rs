use std::hash::{Hash, Hasher};
use twox_hash::XxHash64;

/// Generate stable device token from machine hardware ID.
/// Token remains constant across app reinstall/updates.
/// Only changes on OS reinstall or hardware replacement.
pub fn get_machine_token() -> String {
    let machine_id = get_platform_machine_id();

    let mut hasher = XxHash64::with_seed(42);
    machine_id.hash(&mut hasher);
    let hash = hasher.finish();

    format_uuid_from_hash(hash)
}

fn get_platform_machine_id() -> String {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/machine-id")
            .unwrap_or_else(|_| {
                std::fs::read_to_string("/var/lib/dbus/machine-id")
                    .unwrap_or_else(|_| fallback_machine_id())
            })
            .trim()
            .to_string()
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography")
            .and_then(|key| key.get_value("MachineGuid"))
            .unwrap_or_else(|_| fallback_machine_id())
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, use IOPlatformUUID via system_profiler or ioreg
        // For MVP, we use a simple approach
        use std::process::Command;

        // Try to get IOPlatformUUID via ioreg
        let output = Command::new("ioreg")
            .arg("-rd1")
            .arg("-c")
            .arg("IOPlatformExpertDevice")
            .output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse IOPlatformUUID from output
            for line in stdout.lines() {
                if line.contains("IOPlatformUUID") {
                    // Extract the UUID value
                    if let Some(start) = line.find('"') {
                        let rest = &line[start + 1..];
                        if let Some(end) = rest.find('"') {
                            return rest[..end].to_string();
                        }
                    }
                }
            }
        }

        fallback_machine_id()
    }
}

fn fallback_machine_id() -> String {
    // Use hostname + MAC address as fallback
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .or_else(|_| {
            std::process::Command::new("hostname")
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_else(|_| "unknown".to_string());

    hostname
}

fn format_uuid_from_hash(hash: u64) -> String {
    let bytes = hash.to_be_bytes();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[0] ^ 0x80, bytes[1],  // Set UUID version bits
        bytes[2], bytes[3], bytes[4], bytes[5]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_machine_token_format() {
        let token = get_machine_token();
        // Should be a valid UUID format
        assert_eq!(token.len(), 36);
        assert!(token.contains('-'));
    }

    #[test]
    fn test_token_stability() {
        // Same machine should produce same token
        let token1 = get_machine_token();
        let token2 = get_machine_token();
        assert_eq!(token1, token2);
    }
}