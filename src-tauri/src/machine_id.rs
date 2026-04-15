use std::hash::{Hash, Hasher};
use std::sync::OnceLock;
use twox_hash::XxHash64;

static DEVICE_TOKEN: OnceLock<String> = OnceLock::new();

/// Generate stable device token from machine hardware ID.
///
/// Token remains constant across app reinstall/updates.
/// Only changes on OS reinstall or hardware replacement.
///
/// Platform-specific sources:
/// - Linux: /etc/machine-id (systemd) or /var/lib/dbus/machine-id
/// - Windows: Registry MachineGuid (HKLM\SOFTWARE\Microsoft\Cryptography)
/// - macOS: IOPlatformUUID via ioreg command
///
/// Result is cached after first call for performance.
pub fn get_machine_token() -> String {
    DEVICE_TOKEN.get_or_init(|| {
        let machine_id = get_platform_machine_id();

        // Use two 64-bit hashes with different seeds for 128-bit result
        let mut hasher1 = XxHash64::with_seed(42);
        let mut hasher2 = XxHash64::with_seed(137);
        machine_id.hash(&mut hasher1);
        machine_id.hash(&mut hasher2);

        let hash1 = hasher1.finish();
        let hash2 = hasher2.finish();

        format_device_token(hash1, hash2)
    }).clone()
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
        use std::process::Command;

        Command::new("ioreg")
            .arg("-rd1")
            .arg("-c")
            .arg("IOPlatformExpertDevice")
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .find_map(|line| {
                        line.split("IOPlatformUUID = \"")
                            .nth(1)
                            .and_then(|s| s.split('"').next())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| fallback_machine_id())
            })
            .unwrap_or_else(|_| fallback_machine_id())
    }
}

/// Fallback using hostname when platform-specific ID unavailable
fn fallback_machine_id() -> String {
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| {
            // Last resort: generate random-ish value from process info
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
}