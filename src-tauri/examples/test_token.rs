use std::hash::{Hash, Hasher};
use twox_hash::XxHash64;

fn format_device_token(hash1: u64, hash2: u64) -> String {
    let bytes1 = hash1.to_be_bytes();
    let bytes2 = hash2.to_be_bytes();
    format!(
        "{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes1[0], bytes1[1], bytes1[2], bytes1[3],
        bytes1[4], bytes1[5], bytes1[6], bytes1[7],
        bytes2[0], bytes2[1], bytes2[2], bytes2[3],
        bytes2[4], bytes2[5], bytes2[6], bytes2[7]
    )
}

fn main() {
    let uuid = "B6A2EB8F-A56C-57B4-B317-47FE7707FA78";
    
    let mut hasher1 = XxHash64::with_seed(42);
    let mut hasher2 = XxHash64::with_seed(137);
    uuid.hash(&mut hasher1);
    uuid.hash(&mut hasher2);
    
    let token = format_device_token(hasher1.finish(), hasher2.finish());
    println!("UUID: {}", uuid);
    println!("Token from IOPlatformUUID: {}", token);
    
    println!("\nCurrent desktop token: acdecea68141104ac1120a796e4105f5");
    println!("Old token: 03683688390539acaf97e58a08fce95f");
    
    // 测试 hostname
    let hostname = "akkedeMac-mini";
    let mut hasher1 = XxHash64::with_seed(42);
    let mut hasher2 = XxHash64::with_seed(137);
    hostname.hash(&mut hasher1);
    hostname.hash(&mut hasher2);
    
    let token_hostname = format_device_token(hasher1.finish(), hasher2.finish());
    println!("\nHostname: {}", hostname);
    println!("Token from hostname: {}", token_hostname);
}
