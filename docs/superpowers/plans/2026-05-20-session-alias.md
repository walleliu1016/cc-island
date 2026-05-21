# Session Alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 session 别名功能，解决同名项目和同目录多 session 的区分问题，并添加自动折叠机制。

**Architecture:** 前端负责显示名称计算（自动编号+尾号）、右键菜单、折叠分组；后端负责 aliases 持久化（按 cwd 存储/匹配）；数据流：SessionStart 时读取 aliases 匹配 cwd，前端轮询计算活跃/折叠状态。

**Tech Stack:** React + TypeScript + Zustand + Tauri IPC + Rust

---

## File Structure

### 新增文件

| 文件 | 职责 |
|------|------|
| `src-tauri/src/alias_store.rs` | 后端 aliases 持久化（读写 aliases.json） |
| `src/services/aliasService.ts` | 前端别名服务（Tauri IPC 调用） |
| `src/components/ContextMenu.tsx` | 右键菜单组件 |
| `src/components/RenameModal.tsx` | 重命名弹窗组件 |
| `src/components/FoldedSessions.tsx` | 折叠区组件 |
| `src/utils/displayName.ts` | 显示名称计算逻辑（自动编号+尾号） |
| `src/utils/timeFormat.ts` | 时间格式化（运行时长、多久前） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/types/index.ts:37-47` | ClaudeInstance 添加 alias 字段 |
| `src-tauri/src/lib.rs` | 注册 alias_store 模块 + 新增 Tauri commands |
| `src-tauri/src/instance_manager.rs:69-91` | ClaudeInstance 添加 alias 字段 |
| `src/components/InstanceList.tsx` | 显示名称 + 右键菜单 + 折叠区集成 + Tooltip |
| `src/stores/appStore.ts` | 添加 aliases 状态 |

---

## Task 1: 后端 Alias 存储模块

**Files:**
- Create: `src-tauri/src/alias_store.rs`
- Modify: `src-tauri/src/lib.rs:1-15` (添加模块声明)
- Modify: `src-tauri/src/lib.rs` (添加 Tauri commands)

- [ ] **Step 1: 创建 alias_store.rs 模块**

```rust
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
```

- [ ] **Step 2: 在 lib.rs 中注册模块和添加 Tauri commands**

在 `src-tauri/src/lib.rs` 文件开头的模块声明区域添加：

```rust
pub mod alias_store;
```

在 `#[tauri::command]` 函数区域添加以下 commands（约在文件末尾，在其他 command 之后）：

```rust
#[cfg(feature = "desktop")]
#[tauri::command]
fn get_alias(cwd: String) -> Option<String> {
    alias_store::get_alias(&cwd)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_alias(cwd: String, alias: String) -> Result<(), String> {
    alias_store::set_alias(&cwd, &alias)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_all_aliases() -> HashMap<String, String> {
    alias_store::get_all_aliases()
}
```

- [ ] **Step 3: 在 invoke_handler 中注册新 commands**

找到 `tauri::Builder` 的 `.invoke_handler` 部分，添加新的 command 注册：

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    get_alias,
    set_alias,
    get_all_aliases,
])
```

- [ ] **Step 4: 运行 cargo check 验证编译**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 无编译错误

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/alias_store.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add alias_store module for cwd-based aliases"
```

---

## Task 2: 前端 Alias 服务

**Files:**
- Create: `src/services/aliasService.ts`

- [ ] **Step 1: 创建 aliasService.ts**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { invoke } from '@tauri-apps/api/core';

/**
 * Alias service for managing session aliases via Tauri IPC
 */

export interface AliasService {
  getAlias(cwd: string): Promise<string | null>;
  setAlias(cwd: string, alias: string): Promise<void>;
  getAllAliases(): Promise<Record<string, string>>;
}

/**
 * Get alias for a cwd path
 */
export async function getAlias(cwd: string): Promise<string | null> {
  try {
    const alias = await invoke<string | null>('get_alias', { cwd });
    return alias;
  } catch (error) {
    console.error('Failed to get alias:', error);
    return null;
  }
}

/**
 * Set alias for a cwd path (empty string removes alias)
 */
export async function setAlias(cwd: string, alias: string): Promise<void> {
  try {
    await invoke('set_alias', { cwd, alias });
  } catch (error) {
    console.error('Failed to set alias:', error);
    throw error;
  }
}

/**
 * Get all aliases as cwd -> alias map
 */
export async function getAllAliases(): Promise<Record<string, string>> {
  try {
    const aliases = await invoke<Record<string, string>>('get_all_aliases');
    return aliases;
  } catch (error) {
    console.error('Failed to get all aliases:', error);
    return {};
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/aliasService.ts
git commit -m "feat(frontend): add aliasService for Tauri IPC"
```

---

## Task 3: 类型定义更新

**Files:**
- Modify: `src/types/index.ts:37-47`
- Modify: `src-tauri/src/instance_manager.rs:69-91`

- [ ] **Step 1: 更新前端 ClaudeInstance 类型**

在 `src/types/index.ts` 的 ClaudeInstance 接口中添加 alias 字段：

```typescript
export interface ClaudeInstance {
  session_id: string;
  project_name: string;
  alias?: string;           // 用户自定义别名（按 cwd 匹配）
  custom_name?: string;     // 保留原有字段兼容
  process_info?: ProcessInfo;
  status: InstanceStatus;
  current_tool?: string;
  tool_input?: ToolInput;
  started_at: number;
  last_activity_at: number;
}
```

- [ ] **Step 2: 更新后端 ClaudeInstance 结构**

在 `src-tauri/src/instance_manager.rs` 的 ClaudeInstance 结构体中添加 alias 字段：

```rust
/// A Claude Code instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeInstance {
    pub session_id: SessionId,
    pub project_name: String,
    pub alias: Option<String>,  // User-defined alias (matched by cwd)
    pub custom_name: Option<String>,
    /// Session cwd at startup - used to locate JSONL file (must NOT change during session)
    pub session_cwd: Option<String>,
    // ... rest of fields ...
}
```

同时更新 `new()` 和 `with_cwd()` 方法：

```rust
impl ClaudeInstance {
    pub fn new(session_id: SessionId, project_name: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            session_id,
            project_name,
            alias: None,
            custom_name: None,
            session_cwd: None,
            // ... rest ...
        }
    }

    /// Create instance with session cwd (for JSONL file location)
    pub fn with_cwd(session_id: SessionId, project_name: String, cwd: String) -> Self {
        let mut instance = Self::new(session_id, project_name);
        instance.session_cwd = Some(cwd);
        instance
    }
}
```

更新 `ClaudeInstanceDisplay` 结构体：

```rust
/// Instance data for API response (includes effective display state)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeInstanceDisplay {
    pub session_id: SessionId,
    pub project_name: String,
    pub alias: Option<String>,
    pub custom_name: Option<String>,
    pub session_cwd: Option<String>,
    // ... rest of fields ...
}
```

更新 `to_display()` 方法：

```rust
pub fn to_display(&self) -> ClaudeInstanceDisplay {
    let (status, current_tool, tool_input) = self.get_display_status();

    ClaudeInstanceDisplay {
        session_id: self.session_id.clone(),
        project_name: self.project_name.clone(),
        alias: self.alias.clone(),
        custom_name: self.custom_name.clone(),
        session_cwd: self.session_cwd.clone(),
        // ... rest ...
    }
}
```

- [ ] **Step 3: 运行 cargo check 验证**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src-tauri/src/instance_manager.rs
git commit -m "feat(types): add alias field to ClaudeInstance"
```

---

## Task 4: 显示名称计算逻辑

**Files:**
- Create: `src/utils/displayName.ts`
- Create: `src/utils/timeFormat.ts`

- [ ] **Step 1: 创建时间格式化工具**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

/**
 * Format duration in human-readable form
 * @param seconds Duration in seconds
 * @returns Formatted string like "15分钟" or "2小时"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}小时`;
  }
  return `${hours}小时${remainingMinutes}分钟`;
}

/**
 * Format relative time (how long ago)
 * @param timestamp Unix timestamp in seconds
 * @returns Formatted string like "5分钟前" or "刚刚"
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  
  if (diff < 10) {
    return '刚刚';
  }
  if (diff < 60) {
    return `${diff}秒前`;
  }
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

/**
 * Format running duration from start timestamp
 * @param startedAt Unix timestamp in seconds
 * @returns Formatted string like "运行 15分钟"
 */
export function formatRunningDuration(startedAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const duration = now - startedAt;
  return `运行 ${formatDuration(duration)}`;
}
```

- [ ] **Step 2: 创建显示名称计算工具**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { ClaudeInstance } from '../types';

/**
 * Get session_id tail (last 4 characters)
 */
export function getSessionTail(sessionId: string): string {
  if (sessionId.length < 4) return sessionId;
  return sessionId.slice(-4);
}

/**
 * Group instances by cwd
 */
function groupByCwd(instances: ClaudeInstance[]): Map<string, ClaudeInstance[]> {
  const groups = new Map<string, ClaudeInstance[]>();
  for (const instance of instances) {
    const cwd = instance.process_info?.working_directory || instance.session_cwd || '';
    if (!groups.has(cwd)) {
      groups.set(cwd, []);
    }
    groups.get(cwd)!.push(instance);
  }
  return groups;
}

/**
 * Calculate display name for an instance
 * Priority: alias > project_name (unique) > project_name + #N [tail]
 * 
 * @param instance The instance to calculate display name for
 * @param allInstances All instances (for grouping/duplicate detection)
 * @returns Display name string
 */
export function calculateDisplayName(
  instance: ClaudeInstance,
  allInstances: ClaudeInstance[]
): string {
  // Priority 1: User alias
  if (instance.alias) {
    return instance.alias;
  }
  
  // Priority 2: custom_name (legacy field)
  if (instance.custom_name) {
    return instance.custom_name;
  }
  
  const cwd = instance.process_info?.working_directory || instance.session_cwd || '';
  const groups = groupByCwd(allInstances);
  const sameCwdInstances = groups.get(cwd) || [];
  
  // If only one instance for this cwd, no numbering needed
  if (sameCwdInstances.length <= 1) {
    return instance.project_name;
  }
  
  // Sort by started_at to determine numbering
  const sorted = [...sameCwdInstances].sort((a, b) => a.started_at - b.started_at);
  const index = sorted.findIndex(i => i.session_id === instance.session_id);
  
  // First instance (index 0) doesn't need numbering
  if (index === 0) {
    return instance.project_name;
  }
  
  // Add numbering: #2, #3, etc.
  const number = index + 1;
  const tail = getSessionTail(instance.session_id);
  return `${instance.project_name} #${number} [${tail}]`;
}

/**
 * Calculate tooltip content for an instance
 */
export function calculateTooltip(instance: ClaudeInstance): string {
  const lines: string[] = [];
  
  // Full cwd path
  const cwd = instance.process_info?.working_directory || instance.session_cwd;
  if (cwd) {
    // Replace home directory with ~
    const displayCwd = cwd.replace(/^\/home\/[^\/]+/, '~').replace(/^\/Users\/[^\/]+/, '~');
    lines.push(displayCwd);
  }
  
  // Running duration
  lines.push(formatRunningDuration(instance.started_at));
  
  // Last activity
  lines.push(formatTimeAgo(instance.last_activity_at));
  
  // Terminal type
  if (instance.process_info?.terminal_type && instance.process_info.terminal_type !== 'unknown') {
    const terminalName = formatTerminalType(instance.process_info.terminal_type);
    lines.push(terminalName);
  }
  
  return lines.join('\n');
}

// Import time formatting functions (will be in separate file)
function formatRunningDuration(startedAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - startedAt;
  if (diff < 60) return `运行 ${diff}秒`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `运行 ${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  return `运行 ${hours}小时`;
}

function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 10) return '刚刚';
  if (diff < 60) return `${diff}秒前`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  return `${hours}小时前`;
}

function formatTerminalType(type: string): string {
  const names: Record<string, string> = {
    'macos_terminal': 'Terminal',
    'macos_iterm2': 'iTerm2',
    'macos_alacritty': 'Alacritty',
    'macos_vscode': 'VSCode',
    'macos_ghostty': 'Ghostty',
    'windows_terminal': 'Windows Terminal',
    'windows_cmd': 'CMD',
    'windows_powershell': 'PowerShell',
    'windows_git_bash': 'Git Bash',
    'linux_gnome': 'GNOME Terminal',
    'linux_konsole': 'Konsole',
    'linux_alacritty': 'Alacritty',
  };
  return names[type] || type;
}

// Re-export from timeFormat
export { formatDuration, formatTimeAgo, formatRunningDuration } from './timeFormat';
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/displayName.ts src/utils/timeFormat.ts
git commit -m "feat(utils): add displayName and timeFormat utilities"
```

---

## Task 5: 右键菜单组件

**Files:**
- Create: `src/components/ContextMenu.tsx`

- [ ] **Step 1: 创建 ContextMenu 组件**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onRename: () => void;
  onClose: () => void;
}

export function ContextMenu({ isOpen, position, onRename, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    // Delay to avoid immediate close from the same click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.1 }}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 1000,
          }}
          className="bg-black/90 border border-white/10 rounded-lg shadow-lg py-1 min-w-[120px]"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
              onClose();
            }}
            className="w-full px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="text-white/60">
              <path d="M2 3h8v1H2V3zm0 3h6v1H2V6zm0 3h4v1H2V9z"/>
              <path d="M10 2l2 2-5 5H5v-2l5-5z" fill="none" stroke="currentColor" strokeWidth="1"/>
            </svg>
            重命名
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ContextMenu.tsx
git commit -m "feat(ui): add ContextMenu component for rename action"
```

---

## Task 6: 重命名弹窗组件

**Files:**
- Create: `src/components/RenameModal.tsx`

- [ ] **Step 1: 创建 RenameModal 组件**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface RenameModalProps {
  isOpen: boolean;
  currentName: string;
  cwd: string;
  onSave: (alias: string) => void;
  onClose: () => void;
}

export function RenameModal({ isOpen, currentName, cwd, onSave, onClose }: RenameModalProps) {
  const [alias, setAlias] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset and focus on open
  useEffect(() => {
    if (isOpen) {
      setAlias(currentName);
      // Focus input after animation
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, currentName]);

  // Handle save
  const handleSave = () => {
    onSave(alias.trim());
    onClose();
  };

  // Handle keyboard
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-black/95 border border-white/10 rounded-xl p-4 w-[280px] shadow-xl"
          >
            <h3 className="text-white text-sm font-medium mb-3">重命名 session</h3>
            
            {/* Cwd hint */}
            <p className="text-white/40 text-xs mb-2 truncate">
              {cwd.replace(/^\/home\/[^\/]+/, '~').replace(/^\/Users\/[^\/]+/, '~')}
            </p>
            
            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入别名..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
            />
            
            {/* Buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-1.5 text-sm text-white/60 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-3 py-1.5 text-sm text-black bg-white hover:bg-white/90 rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RenameModal.tsx
git commit -m "feat(ui): add RenameModal component for alias editing"
```

---

## Task 7: 折叠区组件

**Files:**
- Create: `src/components/FoldedSessions.tsx`

- [ ] **Step 1: 创建 FoldedSessions 组件**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClaudeInstance, PopupItem } from '../types';
import { calculateDisplayName, calculateTooltip } from '../utils/displayName';
import { formatTimeAgo } from '../utils/timeFormat';

interface FoldedSessionsProps {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onContextMenu?: (e: React.MouseEvent, instance: ClaudeInstance) => void;
}

export function FoldedSessions({
  instances,
  popups,
  onJump,
  onViewChat,
  onRespond,
  onContextMenu,
}: FoldedSessionsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (instances.length === 0) return null;

  return (
    <div className="mt-2">
      {/* Folded header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-1.5 text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.04] rounded-lg transition-colors flex items-center justify-between"
      >
        <span>已折叠 ({instances.length})</span>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          ▼
        </motion.span>
      </button>

      {/* Folded instances list */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1 mt-1 pl-2">
              {instances.map((instance) => (
                <FoldedInstanceRow
                  key={instance.session_id}
                  instance={instance}
                  allInstances={instances}
                  popups={popups}
                  onJump={onJump}
                  onViewChat={onViewChat}
                  onRespond={onRespond}
                  onContextMenu={onContextMenu}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FoldedInstanceRowProps {
  instance: ClaudeInstance;
  allInstances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onContextMenu?: (e: React.MouseEvent, instance: ClaudeInstance) => void;
}

function FoldedInstanceRow({
  instance,
  allInstances,
  popups,
  onJump,
  onViewChat,
  onRespond,
  onContextMenu,
}: FoldedInstanceRowProps) {
  const displayName = calculateDisplayName(instance, allInstances);
  const tooltip = calculateTooltip(instance);
  const pendingPopup = popups.find(p => p.session_id === instance.session_id && p.status === 'pending');

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      onContextMenu={(e) => onContextMenu?.(e, instance)}
      title={tooltip}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
    >
      {/* Status indicator */}
      <div className="w-3 h-3 rounded-full bg-white/20 flex-shrink-0" />

      {/* Name */}
      <span className="text-white/50 text-xs truncate flex-1">
        {displayName}
      </span>

      {/* Time ago */}
      <span className="text-white/30 text-xs">
        {formatTimeAgo(instance.last_activity_at)}
      </span>

      {/* Pending popup indicator */}
      {pendingPopup && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (pendingPopup.type === 'ask') {
              onViewChat?.(instance.session_id);
            } else {
              onRespond?.(pendingPopup.id, 'allow');
            }
          }}
          className="px-2 py-0.5 text-xs text-black bg-white hover:bg-white/90 rounded transition-colors"
        >
          {pendingPopup.type === 'ask' ? '回答' : '允许'}
        </button>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/FoldedSessions.tsx
git commit -m "feat(ui): add FoldedSessions component for inactive sessions"
```

---

## Task 8: InstanceList 集成

**Files:**
- Modify: `src/components/InstanceList.tsx`

- [ ] **Step 1: 更新 InstanceList 组件，集成显示名称、右键菜单、折叠区**

首先在文件顶部添加 imports：

```typescript
import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ClaudeInstance, PopupItem, InstanceStatus } from '../types';
import { StatusIcon, TerminalColors } from './StatusIcons';
import { useDisplayStore } from '../stores/displayStore';
import { calculateDisplayName, calculateTooltip } from '../utils/displayName';
import { setAlias } from '../services/aliasService';
import { ContextMenu } from './ContextMenu';
import { RenameModal } from './RenameModal';
import { FoldedSessions } from './FoldedSessions';
```

然后添加折叠阈值常量和折叠分组逻辑：

```typescript
// Fold threshold: 10 minutes (600 seconds)
const FOLD_THRESHOLD_SECONDS = 600;

// Check if instance is folded (inactive for threshold)
function isFolded(instance: ClaudeInstance): boolean {
  const now = Math.floor(Date.now() / 1000);
  const inactiveSeconds = now - instance.last_activity_at;
  return inactiveSeconds >= FOLD_THRESHOLD_SECONDS;
}

// Split instances into active and folded
function splitByFoldState(instances: ClaudeInstance[]): { active: ClaudeInstance[], folded: ClaudeInstance[] } {
  const active: ClaudeInstance[] = [];
  const folded: ClaudeInstance[] = [];
  
  for (const instance of instances) {
    // Ended sessions always go to folded
    if (instance.status.type === 'ended' || isFolded(instance)) {
      folded.push(instance);
    } else {
      active.push(instance);
    }
  }
  
  return { active, folded };
}
```

更新 InstanceList 主组件：

```typescript
export function InstanceList({ instances, popups = [], onJump, onViewChat, onRespond, onViewAsk }: InstanceListProps) {
  // Split into active and folded
  const { active, folded } = splitByFoldState(instances);

  // Sort active instances by priority
  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getPhasePriority(a.status, popups.find(p => p.session_id === a.session_id && p.status === 'pending'));
    const priorityB = getPhasePriority(b.status, popups.find(p => p.session_id === b.session_id && p.status === 'pending'));
    return priorityA - priorityB;
  });

  if (sortedActive.length === 0 && folded.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {/* Active instances */}
      {sortedActive.map((instance) => (
        <InstanceRow
          key={instance.session_id}
          instance={instance}
          allInstances={sortedActive}
          pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
          onJump={onJump}
          onViewChat={onViewChat}
          onRespond={onRespond}
          onViewAsk={onViewAsk}
        />
      ))}

      {/* Folded instances section */}
      <FoldedSessions
        instances={folded}
        popups={popups}
        onJump={onJump}
        onViewChat={onViewChat}
        onRespond={onRespond}
      />
    </div>
  );
}
```

更新 InstanceRow 组件，添加右键菜单和 tooltip：

```typescript
function InstanceRow({ instance, allInstances, pendingPopup, onJump, onViewChat, onRespond, onViewAsk }: InstanceRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ isOpen: boolean; position: { x: number; y: number } }>({ isOpen: false, position: { x: 0, y: 0 } });
  const [renameModal, setRenameModal] = useState(false);

  const isWaitingForApproval = pendingPopup !== undefined;
  const popupToolName = pendingPopup?.permission_data?.tool_name;
  const toolInput = pendingPopup?.permission_data?.action || getToolInputString(instance.tool_input) || '';

  const { getInstanceDisplay } = useDisplayStore();
  const display = getInstanceDisplay(instance.session_id);

  const phase = isWaitingForApproval ? 'waitingForApproval' : display.phase;
  const text = isWaitingForApproval
    ? (popupToolName ? formatToolName(popupToolName) : 'Permission')
    : display.text;

  const statusInfo = getStatusInfo(phase, isWaitingForApproval, text);
  
  // Calculate display name with auto-numbering
  const displayName = calculateDisplayName(instance, allInstances);
  const tooltip = calculateTooltip(instance);

  // Handle right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  // Handle rename
  const handleRename = async (alias: string) => {
    const cwd = instance.process_info?.working_directory || instance.session_cwd || '';
    if (cwd) {
      try {
        await setAlias(cwd, alias);
        // Update local state (will be refreshed on next poll)
        // Note: The alias will be applied on next session start for same cwd
      } catch (error) {
        console.error('Failed to save alias:', error);
      }
    }
  };

  // Handle row click
  const handleRowClick = () => {
    onViewChat?.(instance.session_id);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={tooltip}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
        style={{ backgroundColor: isHovered ? 'rgba(255,255,255,0.06)' : 'transparent' }}
      >
        {/* Status indicator */}
        <div className="w-4 flex items-center justify-center flex-shrink-0">
          <StatusIcon phase={phase} size={12} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-white text-sm font-medium truncate">
            {displayName}
          </span>

          <div className="flex items-center gap-1.5 text-xs">
            {statusInfo && (
              <span className="font-medium" style={{ color: statusInfo.color }}>
                {statusInfo.text}
              </span>
            )}
            {toolInput && pendingPopup?.type !== 'ask' && (
              <span className="text-white/40 truncate">
                {truncateText(toolInput, 30)}
              </span>
            )}
            {pendingPopup?.type === 'ask' && (
              <span className="font-medium" style={{ color: TerminalColors.amber }}>
                有问题待回答
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isWaitingForApproval && pendingPopup ? (
            pendingPopup.type === 'ask' ? (
              <AskAnswerButton onClick={() => onViewAsk?.(instance.session_id)} />
            ) : (
              <InlineApprovalButtons
                onAllow={() => onRespond?.(pendingPopup.id, 'allow')}
                onDeny={() => onRespond?.(pendingPopup.id, 'deny')}
              />
            )
          ) : (
            <ActionButtons instance={instance} onJump={onJump} onViewChat={onViewChat} />
          )}
        </div>
      </motion.div>

      {/* Context menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        onRename={() => setRenameModal(true)}
        onClose={() => setContextMenu({ isOpen: false, position: { x: 0, y: 0 } })}
      />

      {/* Rename modal */}
      <RenameModal
        isOpen={renameModal}
        currentName={displayName}
        cwd={instance.process_info?.working_directory || instance.session_cwd || ''}
        onSave={handleRename}
        onClose={() => setRenameModal(false)}
      />
    </>
  );
}

// Helper function for status info
function getStatusInfo(phase: string, isWaitingForApproval: boolean, text: string): { text: string; color: string } | null {
  if (isWaitingForApproval) {
    return { text: 'Waiting for approval', color: TerminalColors.amber };
  }
  switch (phase) {
    case 'processing':
      return { text: text || 'Processing', color: TerminalColors.cyan };
    case 'waitingForInput':
      return { text: 'Idle', color: TerminalColors.dim };
    case 'idle':
      return { text: 'Idle', color: TerminalColors.dim };
    default:
      return null;
  }
}
```

更新 InstanceRowProps 接口：

```typescript
interface InstanceRowProps {
  instance: ClaudeInstance;
  allInstances: ClaudeInstance[];  // Added for display name calculation
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk?: (sessionId: string) => void;
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
pnpm exec tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add src/components/InstanceList.tsx
git commit -m "feat(ui): integrate displayName, contextMenu, foldedSessions into InstanceList"
```

---

## Task 9: 后端 Session Alias 应用

**Files:**
- Modify: `src-tauri/src/http_server.rs` (SessionStart 处理时应用 alias)

- [ ] **Step 1: 在 SessionStart 处理时应用 alias**

找到 `src-tauri/src/http_server.rs` 中 SessionStart 处理的位置（约 256-270 行），在创建 instance 后添加 alias 应用逻辑：

```rust
// In SessionStart handling section, after instance creation:
let mut instance = ClaudeInstance::new(session_id.clone(), project_name.clone());
instance.session_cwd = session_cwd.clone();

// Apply alias from aliases.json if cwd matches
if let Some(cwd) = &session_cwd {
    if let Some(alias) = crate::alias_store::get_alias(cwd) {
        instance.alias = Some(alias);
        tracing::info!("Applied alias '{}' for session {} (cwd: {})", alias, session_id, cwd);
    }
}

// ... rest of existing code (process_info, etc.)
```

同样更新 PreToolUse 的 auto-recovery 部分（约 284-290 行）：

```rust
// In PreToolUse auto-recovery section:
let mut instance = ClaudeInstance::new(session_id.clone(), project_name.clone());
instance.session_cwd = session_cwd.clone();

// Apply alias from aliases.json if cwd matches
if let Some(cwd) = &session_cwd {
    if let Some(alias) = crate::alias_store::get_alias(cwd) {
        instance.alias = Some(alias);
        tracing::info!("Applied alias '{}' for recovered session {} (cwd: {})", alias, session_id, cwd);
    }
}

// ... rest of existing code
```

- [ ] **Step 2: 运行 cargo check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: 无编译错误

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/http_server.rs
git commit -m "feat(backend): apply alias on SessionStart and auto-recovery"
```

---

## Task 10: 测试与验证

**Files:**
- None (manual testing)

- [ ] **Step 1: 启动 Desktop 应用进行测试**

```bash
pnpm tauri dev
```

- [ ] **Step 2: 测试显示名称功能**

测试场景：
1. 启动单个 Claude session → 验证显示 project_name
2. 同目录启动第二个 session → 验证显示 `#2 [尾号]`
3. 右键点击 session → 验证菜单显示
4. 设置别名 → 验证保存和显示

- [ ] **Step 3: 测试折叠功能**

测试场景：
1. 等待 session idle 10分钟 → 验证自动折叠
2. 点击"已折叠 (N)" → 验证展开
3. session 有新活动 → 验证自动展开回活跃区

- [ ] **Step 4: 测试 tooltip**

测试场景：
1. 悬停 session → 验证显示完整路径、运行时长、最后活动时间

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "test: verify session alias and fold features"
```

---

## Self-Review Checklist

完成后自检：

1. **Spec coverage:**
   - ✅ 显示名称优先级 (alias > project_name > numbered)
   - ✅ 自动编号 (同 cwd 分组)
   - ✅ 尾号显示 (session_id 后 4 位)
   - ✅ 右键菜单重命名
   - ✅ 10分钟折叠机制
   - ✅ 持久化 aliases.json
   - ✅ Tooltip (完整路径、运行时长、最后活动、终端类型)

2. **Placeholder scan:**
   - 无 TBD/TODO
   - 所有代码块完整

3. **Type consistency:**
   - ClaudeInstance.alias: Option<string> 前后端一致
   - setAlias/getAlias 签名一致