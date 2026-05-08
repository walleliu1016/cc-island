//! Session detection - watch for JSONL file creation to get session_id

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::time::Duration;
use tracing::{debug, info, warn};

/// Compute cwd_hash using same algorithm as Claude Code
///
/// Claude Code transforms paths like:
/// - "/Users/bruceliu/work" → "Users-bruceliu-work"
/// - "C:/Users/bruceliu" → "C--Users-bruceliu"
/// - "G:/work/cc-island" → "G--work-cc-island"
pub fn compute_cwd_hash(cwd: &PathBuf) -> String {
    let cwd_str = cwd.to_string_lossy();

    cwd_str
        .replace(':', "-")
        .replace('/', "-")
        .replace('\\', "-")
        .replace(' ', "-")
        .trim_start_matches('-')
        .trim_end_matches('-')
        .to_string()
}

/// Get Claude projects directory path
fn get_claude_projects_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Failed to get home directory")
        .join(".claude")
        .join("projects")
}

/// Watch for JSONL file creation and extract session_id
///
/// Claude Code creates: ~/.claude/projects/<cwd-hash>/<session-id>.jsonl
pub fn wait_for_session_id(cwd: &PathBuf, timeout: Duration) -> String {
    let cwd_hash = compute_cwd_hash(cwd);
    let claude_dir = get_claude_projects_dir().join(&cwd_hash);

    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir).ok();
    }

    info!("Watching for JSONL in: {}", claude_dir.display());
    info!("cwd_hash: {}", cwd_hash);

    // Check for existing JSONL files first
    if let Ok(entries) = std::fs::read_dir(&claude_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "jsonl") {
                let session_id = extract_session_id(&path);
                info!("Found existing session: {}", session_id);
                return session_id;
            }
        }
    }

    // Create watcher with correct channel type
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();

    let mut watcher: RecommendedWatcher = Watcher::new(
        tx,
        notify::Config::default()
    ).expect("Failed to create file watcher");

    watcher
        .watch(&claude_dir, RecursiveMode::NonRecursive)
        .expect("Failed to watch directory");

    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            warn!("Timeout waiting for session_id, using fallback");

            if let Ok(entries) = std::fs::read_dir(&claude_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().is_some_and(|e| e == "jsonl") {
                        return extract_session_id(&path);
                    }
                }
            }

            return format!("ease-pty-temp-{}", uuid::Uuid::new_v4());
        }

        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(result) => {
                match result {
                    Ok(event) => {
                        debug!("File event: {:?}", event.kind);

                        if let notify::EventKind::Create(_) = event.kind {
                            for path in &event.paths {
                                debug!("Created file: {}", path.display());

                                if path.extension().is_some_and(|e| e == "jsonl") {
                                    let session_id = extract_session_id(path);
                                    info!("Detected new session: {}", session_id);
                                    return session_id;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Watch error: {}", e);
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                warn!("Watcher disconnected");
                break;
            }
        }
    }

    format!("ease-pty-temp-{}", uuid::Uuid::new_v4())
}

/// Extract session_id from JSONL file path
fn extract_session_id(path: &PathBuf) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.replace(".jsonl", ""))
        .expect("Failed to extract session_id from path")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cwd_hash_unix() {
        let cwd = PathBuf::from("/Users/bruceliu/work");
        assert_eq!(compute_cwd_hash(&cwd), "Users-bruceliu-work");
    }

    #[test]
    fn test_cwd_hash_windows() {
        let cwd = PathBuf::from("C:/Users/bruceliu/work");
        assert_eq!(compute_cwd_hash(&cwd), "C--Users-bruceliu-work");
    }

    #[test]
    fn test_cwd_hash_windows_backslash() {
        let cwd = PathBuf::from("G:\\work\\cc-island");
        assert_eq!(compute_cwd_hash(&cwd), "G--work-cc-island");
    }
}