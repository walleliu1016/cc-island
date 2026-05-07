fn main() {
    // Tauri build script only needed for desktop mode
    #[cfg(feature = "desktop")]
    tauri_build::build();

    // Server mode doesn't need special build script
    #[cfg(not(feature = "desktop"))]
    println!("cargo:rerun-if-changed=Cargo.toml");
}