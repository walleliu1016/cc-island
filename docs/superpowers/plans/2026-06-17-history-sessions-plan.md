# 历史会话功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增历史会话 tab，保存 SessionEnd 的会话并持久化，支持重启会话。

**Architecture:** 后端新增 `history_store.rs` 模块用 JSON 持久化已结束会话；前端 InstanceList 改为三 tab（活动/空闲/历史），新增 `HistorySessions` 和 `RestartDialog` 组件。

**Tech Stack:** Rust (Axum + tokio), TypeScript (React + Zustand + Framer Motion)

---

### Task 1: 后端 — HistoryStore 模块

**Files:**
- Create: `src-tauri/src/history_store.rs`
- Modify: `src-tauri/src/lib.rs:1-10` (add module declaration)

- [ ] **Step 1: 创建 `history_store.rs`**

```rust
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
use crate::instance_manager::ClaudeInstance;
use crate::instance_manager::SessionId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const HISTORY_FILE: &str = "history_sessions.json";
const DEFAULT_MAX_AGE_DAYS: u32 = 30;

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
        let data = HistoryData {
            sessions: self.sessions.clone(),
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

    pub fn cleanup(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let cutoff = now - (self.max_age_days as u64 * 86400);
        let before = self.sessions.len();
        self.sessions.retain(|_, inst| inst.last_activity_at >= cutoff);
        if self.sessions.len() != before {
            self.save();
            tracing::info!("Cleaned {} expired history sessions", before - self.sessions.len());
        }
    }
}
```

- [ ] **Step 2: 在 `lib.rs` 添加模块声明**

```rust
// 在 pub mod activity_store; 之后添加:
pub mod history_store;
```

- [ ] **Step 3: 编译验证**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: 编译通过，可能有 unused import 警告

---

### Task 2: 后端 — AppState 添加 HistoryStore

**Files:**
- Modify: `src-tauri/src/lib.rs` (AppState 结构体 + 初始化)

- [ ] **Step 1: 在 AppState 添加 history_store 字段**

在 `AppState` 结构体中 `pub jsonl_watcher` 之后添加:
```rust
pub history_store: history_store::HistoryStore,
```

- [ ] **Step 2: 在 AppState::new() 初始化**

```rust
// 在 jsonl_watcher: None, 之后添加:
history_store: history_store::HistoryStore::new(),
```

- [ ] **Step 3: 编译验证**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### Task 3: 后端 — SessionEnd 处理变更

**Files:**
- Modify: `src-tauri/src/http_server.rs:369-403` (SessionEnd 分支)

- [ ] **Step 1: 替换 SessionEnd 处理逻辑**

将 SessionEnd 分支从直接删除改为保存到 history_store:

```rust
"SessionEnd" => {
    let project_name = state_guard.instances.get_instance(&input.session_id)
        .map(|i| i.project_name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Cancel any pending popups for this session
    let cancelled = state_guard.popups.cancel_session_popups(&input.session_id);
    if !cancelled.is_empty() {
        tracing::info!("Session {} ended, cancelled {} pending popups",
            input.session_id, cancelled.len());
    }

    // Stop JSONL watcher for this session
    if let Some(ref mut watcher) = state_guard.jsonl_watcher {
        watcher.unwatch_session(&input.session_id);
    }

    // Save to history store before removing from active instances
    if let Some(mut instance) = state_guard.instances.get_instance(&input.session_id).cloned() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        instance.ended_at = Some(now);
        instance.status = instance_manager::InstanceStatus::Ended;
        state_guard.history_store.add(instance);
    }

    // Remove from active instances
    state_guard.instances.remove_instance(&input.session_id);

    // Clear chat history for this session
    state_guard.chat_history.clear_session(&input.session_id);

    // Set session notification
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let notification = crate::SessionNotification {
        project_name,
        notification_type: "ended".to_string(),
        timestamp: now,
    };
    state_guard.set_session_notification(notification.clone());
}
```

- [ ] **Step 2: 在 instance_manager.rs 的 ClaudeInstance 添加 ended_at 字段**

在 `ClaudeInstance` 结构体中 `pub first_prompt` 之后添加:
```rust
/// When the session ended (Unix timestamp in seconds)
#[serde(default)]
pub ended_at: Option<u64>,
```

在 `ClaudeInstance::new()` 中添加初始化:
```rust
// 在 first_prompt: None, 之后添加:
ended_at: None,
```

在 `ClaudeInstance::with_cwd()` 中也添加:
```rust
// 该方法通常在 new() 基础上设置 cwd，因为使用 new() 所以 ended_at 已经初始化
// 不需要额外修改
```

- [ ] **Step 3: 移除不再需要的 cleanup_ended 方法**

在 `InstanceManager` impl 中，删除 `cleanup_ended` 方法（lines 308-326）。

- [ ] **Step 4: 编译验证**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### Task 4: 后端 — Tauri Commands

**Files:**
- Modify: `src-tauri/src/lib.rs` (添加 4 个新 Tauri command)
- Modify: `src-tauri/src/platform/mod.rs` (添加终端检测函数)
- Modify: `src-tauri/src/platform/macos.rs` (添加 macOS 终端检测 + 启动)

- [ ] **Step 1: 在 platform/mod.rs 添加 `get_available_terminals` 和 `launch_in_terminal`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub bundle_id: String,
    pub display_name: String,
}

/// Get available terminals on the current system
pub fn get_available_terminals() -> Vec<TerminalInfo> {
    #[cfg(target_os = "macos")]
    {
        macos::get_available_terminals_macos()
    }
    #[cfg(target_os = "linux")]
    {
        linux::get_available_terminals_linux()
    }
    #[cfg(target_os = "windows")]
    {
        windows::get_available_terminals_windows()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        vec![]
    }
}

/// Launch a command in the specified terminal
pub fn launch_in_terminal(terminal_bundle_id: &str, command: &str, cwd: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::launch_in_terminal_macos(terminal_bundle_id, command, cwd)
    }
    #[cfg(target_os = "linux")]
    {
        linux::launch_in_terminal_linux(terminal_bundle_id, command, cwd)
    }
    #[cfg(target_os = "windows")]
    {
        windows::launch_in_terminal_windows(terminal_bundle_id, command, cwd)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Unsupported platform".to_string())
    }
}
```

- [ ] **Step 2: 在 platform/macos.rs 添加终端检测和启动函数**

在 macos.rs 末尾添加:

```rust
use crate::platform::TerminalInfo;

const KNOWN_TERMINALS: &[(&str, &str, &str)] = &[
    ("com.apple.Terminal", "Terminal", "Terminal.app"),
    ("com.googlecode.iterm2", "iTerm2", "iTerm.app"),
    ("dev.warp.Warp-Stable", "Warp", "Warp.app"),
    ("org.alacritty", "Alacritty", "Alacritty.app"),
    ("com.mitchellh.ghostty", "Ghostty", "Ghostty.app"),
];

pub fn get_available_terminals_macos() -> Vec<TerminalInfo> {
    let mut terminals: Vec<TerminalInfo> = Vec::new();

    let search_dirs = [
        std::path::PathBuf::from("/Applications"),
        dirs::home_dir().unwrap_or_default().join("Applications"),
    ];

    for &(bundle_id, display_name, app_name) in KNOWN_TERMINALS {
        for dir in &search_dirs {
            let app_path = dir.join(app_name);
            if app_path.exists() {
                terminals.push(TerminalInfo {
                    bundle_id: bundle_id.to_string(),
                    display_name: display_name.to_string(),
                });
                break;
            }
        }
    }

    // Terminal.app always exists on macOS
    if terminals.is_empty() {
        terminals.push(TerminalInfo {
            bundle_id: "com.apple.Terminal".to_string(),
            display_name: "Terminal".to_string(),
        });
    }

    terminals
}

pub fn launch_in_terminal_macos(terminal_bundle_id: &str, command: &str, _cwd: &str) -> Result<(), String> {
    let escaped_command = command.replace('"', "\\\"");

    let script = match terminal_bundle_id {
        "com.apple.Terminal" => format!(
            r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
            escaped_command
        ),
        "com.googlecode.iterm2" => format!(
            r#"tell application "iTerm2"
    tell current window
        create tab with default profile
        tell current session
            write text "{}"
        end tell
    end tell
    activate
end tell"#,
            escaped_command
        ),
        _ => format!(
            r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
            escaped_command
        ),
    };

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to execute osascript: {}", e))?;

    if output.status.success() {
        tracing::info!("Launched in terminal: {}", command);
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to launch terminal: {}", stderr))
    }
}
```

- [ ] **Step 3: 在 platform/linux.rs 添加终端检测和启动函数（stub）**

```rust
use crate::platform::TerminalInfo;

pub fn get_available_terminals_linux() -> Vec<TerminalInfo> {
    let mut terminals: Vec<TerminalInfo> = Vec::new();

    let known: &[(&str, &str, &str)] = &[
        ("gnome-terminal", "GNOME Terminal", "gnome-terminal"),
        ("konsole", "Konsole", "konsole"),
        ("alacritty", "Alacritty", "alacritty"),
        ("xterm", "XTerm", "xterm"),
        ("wezterm", "WezTerm", "wezterm"),
    ];

    for &(bundle_id, display_name, binary) in known {
        if std::process::Command::new("which")
            .arg(binary)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            terminals.push(TerminalInfo {
                bundle_id: bundle_id.to_string(),
                display_name: display_name.to_string(),
            });
        }
    }

    if terminals.is_empty() {
        terminals.push(TerminalInfo {
            bundle_id: "xterm".to_string(),
            display_name: "XTerm".to_string(),
        });
    }

    terminals
}

pub fn launch_in_terminal_linux(terminal_bundle_id: &str, command: &str, _cwd: &str) -> Result<(), String> {
    let args = match terminal_bundle_id {
        "gnome-terminal" => vec!["--", "bash", "-c", command],
        "konsole" => vec!["-e", "bash", "-c", command],
        "alacritty" => vec!["-e", "bash", "-c", command],
        "xterm" => vec!["-e", "bash", "-c", command],
        "wezterm" => vec!["start", "--", "bash", "-c", command],
        _ => vec!["-e", "bash", "-c", command],
    };

    std::process::Command::new(terminal_bundle_id)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to launch terminal: {}", e))?;

    Ok(())
}
```

- [ ] **Step 4: 在 platform/windows.rs 添加 stub（如果存在）**

```rust
use crate::platform::TerminalInfo;

pub fn get_available_terminals_windows() -> Vec<TerminalInfo> {
    vec![
        TerminalInfo {
            bundle_id: "wt.exe".to_string(),
            display_name: "Windows Terminal".to_string(),
        },
        TerminalInfo {
            bundle_id: "cmd.exe".to_string(),
            display_name: "Command Prompt".to_string(),
        },
        TerminalInfo {
            bundle_id: "powershell.exe".to_string(),
            display_name: "PowerShell".to_string(),
        },
    ]
}

pub fn launch_in_terminal_windows(terminal_bundle_id: &str, command: &str, _cwd: &str) -> Result<(), String> {
    match terminal_bundle_id {
        "wt.exe" => {
            std::process::Command::new("wt.exe")
                .args(["-w", "0", "nt", "cmd", "/c", command])
                .spawn()
                .map_err(|e| format!("Failed to launch: {}", e))?;
        }
        _ => {
            std::process::Command::new("cmd.exe")
                .args(["/c", "start", terminal_bundle_id, "/c", command])
                .spawn()
                .map_err(|e| format!("Failed to launch: {}", e))?;
        }
    }
    Ok(())
}
```

- [ ] **Step 5: 在 lib.rs 添加 4 个新 Tauri command**

在 `get_stats` 函数之后，`update_settings` 之前添加:

```rust
#[cfg(feature = "desktop")]
#[tauri::command]
fn get_history_sessions() -> Vec<instance_manager::ClaudeInstance> {
    SHARED_STATE.read().history_store.get_all()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn remove_history_session(session_id: String) -> Result<(), String> {
    let mut state = SHARED_STATE.write();
    state.history_store.remove(&session_id);
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_available_terminals() -> Vec<platform::TerminalInfo> {
    platform::get_available_terminals()
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn restart_session(session_id: String, terminal_bundle_id: String, extra_args: String) -> Result<(), String> {
    let (cwd, _project_name) = {
        let state = SHARED_STATE.read();
        match state.history_store.get(&session_id) {
            Some(instance) => (
                instance.session_cwd.clone().unwrap_or_default(),
                instance.project_name.clone(),
            ),
            None => return Err("Session not found in history".to_string()),
        }
    };

    let args = if extra_args.trim().is_empty() {
        String::new()
    } else {
        format!(" {}", extra_args.trim())
    };

    // claude --resume handles the new session creation
    let command = format!("claude --resume {}{}", session_id, args);

    if !cwd.is_empty() {
        let command = format!("cd {} && {}", cwd, command);
        platform::launch_in_terminal(&terminal_bundle_id, &command, &cwd)
    } else {
        platform::launch_in_terminal(&terminal_bundle_id, &command, "")
    }
}
```

- [ ] **Step 6: 注册新 command 到 invoke_handler**

在 `tauri::generate_handler![]` 中添加:
```rust
get_history_sessions,
remove_history_session,
get_available_terminals,
restart_session,
```

- [ ] **Step 7: 编译验证**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

---

### Task 5: 前端 — 类型定义

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 添加新类型定义**

在 `ClaudeInstance` interface 的 `first_prompt` 之后添加:
```typescript
  ended_at?: number;  // When the session ended
```

在文件末尾添加:
```typescript
// Terminal info for restart dialog
export interface TerminalInfo {
  bundle_id: string;
  display_name: string;
}
```

---

### Task 6: 前端 — appStore 添加历史会话状态

**Files:**
- Modify: `src/stores/appStore.ts`

- [ ] **Step 1: 添加 historySessions 状态**

在 `showArchiveTab` 之后、setter 之前添加:
```typescript
  historySessions: ClaudeInstance[];
```

在 set 中添加:
```typescript
  historySessions: [],
```

在 AppState interface 的 setter 区域添加:
```typescript
  setHistorySessions: (historySessions: ClaudeInstance[]) => void;
```

在 create 的 set 中添加:
```typescript
  setHistorySessions: (historySessions) => set({ historySessions }),
```

---

### Task 7: 前端 — RestartDialog 组件

**Files:**
- Create: `src/components/RestartDialog.tsx`

- [ ] **Step 1: 创建 RestartDialog**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TerminalInfo } from '../types';

interface RestartDialogProps {
  sessionId: string;
  projectName: string;
  onClose: () => void;
}

const COMMON_ARGS = [
  '--model sonnet',
  '--model opus',
  '--model haiku',
  '--verbose',
  '--debug',
  '--dangerously-skip-permissions',
];

export function RestartDialog({ sessionId, projectName, onClose }: RestartDialogProps) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState('');
  const [selectedArgs, setSelectedArgs] = useState<string[]>([]);
  const [customArgs, setCustomArgs] = useState('');

  useEffect(() => {
    invoke<TerminalInfo[]>('get_available_terminals')
      .then((t) => {
        setTerminals(t);
        if (t.length > 0) setSelectedTerminal(t[0].bundle_id);
      })
      .catch(console.error);
  }, []);

  const toggleArg = (arg: string) => {
    setSelectedArgs((prev) =>
      prev.includes(arg) ? prev.filter((a) => a !== arg) : [...prev, arg]
    );
  };

  const extraArgs = [...selectedArgs, customArgs.trim()].filter(Boolean).join(' ');
  const previewCmd = `claude --resume ${sessionId}${extraArgs ? ' ' + extraArgs : ''}`;

  const handleLaunch = async () => {
    try {
      await invoke('restart_session', {
        sessionId,
        terminalBundleId: selectedTerminal,
        extraArgs,
      });
      onClose();
    } catch (e) {
      console.error('Failed to restart session:', e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl p-5"
        style={{
          width: 380,
          background: '#1a1a2e',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div className="text-sm font-semibold mb-4">
          {'\u{1F504}'} 重启会话 — {projectName}
        </div>

        {/* Terminal select */}
        <div className="text-xs text-white/50 mb-1.5">终端类型</div>
        <select
          value={selectedTerminal}
          onChange={(e) => setSelectedTerminal(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white text-xs outline-none cursor-pointer mb-4"
        >
          {terminals.map((t) => (
            <option key={t.bundle_id} value={t.bundle_id}>
              {t.display_name}
            </option>
          ))}
        </select>

        {/* Common args chips */}
        <div className="text-xs text-white/50 mb-1.5">Claude 参数（可选）</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {COMMON_ARGS.map((arg) => (
            <button
              key={arg}
              onClick={() => toggleArg(arg)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                selectedArgs.includes(arg)
                  ? 'bg-purple-500/25 text-purple-400 border border-purple-500/40'
                  : 'bg-white/[0.06] text-white/50 hover:bg-white/10 border border-transparent'
              }`}
            >
              {arg}
            </button>
          ))}
        </div>

        {/* Custom args */}
        <input
          value={customArgs}
          onChange={(e) => setCustomArgs(e.target.value)}
          placeholder="自定义参数，如 --model opus --verbose"
          className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white text-xs font-mono outline-none mb-3 placeholder:text-white/20"
        />

        {/* Preview */}
        <div className="text-xs text-white/50 mb-1.5">预览命令</div>
        <div className="px-3 py-2 rounded-md bg-black/40 border border-white/[0.06] font-mono text-xs text-green-400 break-all mb-5">
          {previewCmd}
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-white/60 bg-white/[0.06] hover:bg-white/10"
          >
            取消
          </button>
          <button
            onClick={handleLaunch}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700"
          >
            启动
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 8: 前端 — HistorySessions 组件

**Files:**
- Create: `src/components/HistorySessions.tsx`

- [ ] **Step 1: 创建 HistorySessions**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClaudeInstance } from '../types';
import { calculateDisplayName } from '../utils/displayName';
import { formatTimeAgo } from '../utils/timeFormat';
import { RestartDialog } from './RestartDialog';

interface HistorySessionsProps {
  instances: ClaudeInstance[];
  onViewChat?: (sessionId: string) => void;
}

export function HistorySessions({ instances, onViewChat }: HistorySessionsProps) {
  const [restartSession, setRestartSession] = useState<ClaudeInstance | null>(null);

  if (instances.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {instances.map((instance) => (
        <motion.div
          key={instance.session_id}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
          onClick={() => onViewChat?.(instance.session_id)}
        >
          {/* Status dot */}
          <div className="w-3 h-3 rounded-full bg-white/20 flex-shrink-0" />

          {/* Name + prompt */}
          <div className="flex-1 min-w-0">
            <span className="text-white/50 text-xs">{calculateDisplayName(instance, instances)}</span>
            {instance.first_prompt && (
              <span className="text-white/25 text-xs ml-1.5 truncate">
                · {instance.first_prompt.slice(0, 30)}
              </span>
            )}
          </div>

          {/* Time range */}
          <span className="text-white/25 text-xs flex-shrink-0">
            {formatTimeAgo(instance.last_activity_at)}
          </span>

          {/* Ended badge */}
          <span className="text-white/20 text-xs flex-shrink-0">已结束</span>

          {/* Restart button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRestartSession(instance);
            }}
            className="px-2 py-1 rounded-md text-xs text-purple-400 bg-purple-500/15 hover:bg-purple-500/25 flex-shrink-0 transition-colors"
          >
            {'↻'} 重启
          </button>
        </motion.div>
      ))}

      {/* Restart Dialog */}
      {restartSession && (
        <RestartDialog
          sessionId={restartSession.session_id}
          projectName={calculateDisplayName(restartSession, instances)}
          onClose={() => setRestartSession(null)}
        />
      )}
    </div>
  );
}
```

---

### Task 9: 前端 — InstanceList 改为三 Tab

**Files:**
- Modify: `src/components/InstanceList.tsx`
- Modify: `src/components/FoldedSessions.tsx` (文本 "已折叠" → "空闲会话")

- [ ] **Step 1: 修改 FoldedSessions.tsx 文本**

将 line 37 的:
```typescript
<span>已折叠 ({instances.length})</span>
```
改为:
```typescript
<span>空闲会话 ({instances.length})</span>
```

- [ ] **Step 2: 修改 InstanceList.tsx**

按设计将 `splitByFoldState` 改为三路拆分，添加 tab 切换逻辑:

```typescript
// Replace splitByFoldState with:
function splitByState(instances: ClaudeInstance[]): {
  active: ClaudeInstance[];
  idle: ClaudeInstance[];
} {
  const active: ClaudeInstance[] = [];
  const idle: ClaudeInstance[] = [];

  for (const instance of instances) {
    const now = Math.floor(Date.now() / 1000);
    const inactiveSeconds = now - instance.last_activity_at;
    if (inactiveSeconds >= FOLD_THRESHOLD_SECONDS) {
      idle.push(instance);
    } else {
      active.push(instance);
    }
  }

  return { active, idle };
}

// Replace InstanceList component body:
export function InstanceList({ instances, popups = [], onJump, onViewChat, onRespond, onViewAsk }: InstanceListProps) {
  const [activeTab, setActiveTab] = useState<'active' | 'idle' | 'history'>('active');

  const historySessions = useAppStore((s) => s.historySessions);
  const { active, idle } = splitByState(instances);

  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getPhasePriority(a.status, popups.find(p => p.session_id === a.session_id && p.status === 'pending'));
    const priorityB = getPhasePriority(b.status, popups.find(p => p.session_id === b.session_id && p.status === 'pending'));
    return priorityA - priorityB;
  });

  return (
    <div className="flex flex-col gap-1">
      {/* Tabs */}
      <div className="flex gap-1.5 mb-1 px-0">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-3 py-1 rounded-lg text-xs transition-colors ${
            activeTab === 'active' ? 'bg-white/12 text-white font-semibold' : 'bg-white/[0.04] text-white/40'
          }`}
        >
          活动 ({sortedActive.length})
        </button>
        <button
          onClick={() => setActiveTab('idle')}
          className={`px-3 py-1 rounded-lg text-xs transition-colors ${
            activeTab === 'idle' ? 'bg-white/12 text-white font-semibold' : 'bg-white/[0.04] text-white/40'
          }`}
        >
          空闲 ({idle.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-3 py-1 rounded-lg text-xs transition-colors ${
            activeTab === 'history' ? 'bg-white/12 text-white font-semibold' : 'bg-white/[0.04] text-white/40'
          }`}
        >
          历史 ({historySessions.length})
        </button>
      </div>

      {/* Active Tab */}
      {activeTab === 'active' && sortedActive.length > 0 && (
        sortedActive.map((instance) => (
          <SessionCard
            key={instance.session_id}
            instance={instance}
            allInstances={sortedActive}
            pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
            onJump={onJump}
            onViewChat={onViewChat}
            onRespond={onRespond}
            onViewAsk={onViewAsk}
            isDesktopMode={false}
          />
        ))
      )}

      {/* Idle Tab */}
      {activeTab === 'idle' && (
        <FoldedSessions
          instances={idle}
          popups={popups}
          onJump={onJump}
          onViewChat={onViewChat}
          onRespond={onRespond}
        />
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <HistorySessions
          instances={historySessions}
          onViewChat={onViewChat}
        />
      )}

      {/* Empty states */}
      {activeTab === 'active' && sortedActive.length === 0 && (
        <div className="text-white/30 text-xs text-center py-4">暂无活动会话</div>
      )}
      {activeTab === 'history' && historySessions.length === 0 && (
        <div className="text-white/30 text-xs text-center py-4">暂无历史会话</div>
      )}
    </div>
  );
}
```

不要忘记导入 `HistorySessions` 组件。

- [ ] **Step 3: 修改 App.tsx 拉取历史会话**

在 `fetchData` 的 `Promise.all` 中添加 `get_history_sessions`:

```typescript
const [instancesData, popupsData, sessionNotif, cloudStatusRaw, historyData] = await Promise.all([
  invoke<ClaudeInstance[]>('get_instances'),
  invoke<PopupItem[]>('get_popups'),
  invoke<SessionNotification | null>('get_session_notification'),
  invoke<string>('get_cloud_connection_status'),
  invoke<ClaudeInstance[]>('get_history_sessions'),
]);
```

然后调用 `useAppStore` 的 `setHistorySessions`:
```typescript
setHistorySessions(historyData);
```

---

### Task 10: 前端 — 桌面模式 tab 更新

**Files:**
- Modify: `src/components/DesktopMode.tsx`

- [ ] **Step 1: 更新 DesktopMode 的 tab 结构**

将 `ArchiveTab` 替换为三 tab 结构，参考灵动岛模式的 tab 实现。同时导入 `HistorySessions` 组件。

关键改动：将 `ArchiveTab` 组件替换为内联的三 tab 按钮 + 条件渲染:
- 活动 tab → SessionCard 列表
- 空闲 tab → idle 实例的简单列表
- 历史 tab → HistorySessions 组件

---

### Task 11: 清理与验证

**Files:**
- 无需修改

- [ ] **Step 1: 移除 instance_manager.rs 中不再使用的 `cleanup_ended` 方法**

Task 3 Step 3 已覆盖。

- [ ] **Step 2: 确保 `InstanceStatus::Ended` 在 JSON 序列化/反序列化中正确工作**

验证 `#[serde(rename_all = "lowercase")]` 下 `Ended` → `"ended"` 正确。

- [ ] **Step 3: 前端编译检查**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: 后端编译检查**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: 全量编译**

```bash
pnpm tauri:build --debug
```
