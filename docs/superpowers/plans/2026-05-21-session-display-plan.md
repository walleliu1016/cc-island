# Session Display Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Claude session display with time info, status colors, activity history, archive tab, and layout mode switching

**Architecture:** Enhance InstanceList with two-row layout, add backend ToolActivity collection, create new components (ArchiveTab, SlideMenu, ActivityPopup, DesktopMode), extend IPC commands for activity history

**Tech Stack:** React + Zustand + Framer Motion + Tailwind CSS + Tauri IPC + Rust Axum

---

## File Structure

### Modified Files:
- `src-tauri/src/lib.rs` - Add ToolActivity struct and IPC commands
- `src-tauri/src/http_server.rs` - Collect tool activities on PreToolUse/PostToolUse
- `src-tauri/src/instance_manager.rs` - Add activities field to ClaudeInstance
- `src/types/index.ts` - Add ToolActivityDetail type
- `src/stores/appStore.ts` - Add layoutMode and archive state
- `src/components/InstanceList.tsx` - Two-row layout + status colors + buttons
- `src/components/StatusIcons.tsx` - Add status color constants
- `src/App.tsx` - Add desktop mode rendering

### Created Files:
- `src/components/ArchiveTab.tsx` - Archive/active tab switcher
- `src/components/SlideMenu.tsx` - Right-side slide menu
- `src/components/ActivityPopup.tsx` - Expanded activity details
- `src/components/DesktopMode.tsx` - Full desktop window view
- `src/components/SessionCard.tsx` - Individual session card component
- `src/utils/statusColors.ts` - Status color mapping constants

---

## Task 1: Backend - ToolActivity Data Collection

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/http_server.rs`
- Modify: `src-tauri/src/instance_manager.rs`

- [ ] **Step 1: Add ToolActivityDetail struct in lib.rs**

```rust
// Add after existing ToolActivity struct (around line 60)
/// Detailed tool activity for display (with result)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolActivityDetail {
    pub tool_name: String,
    pub content: String,       // Command/file path/question
    pub timestamp: u64,
    pub result: Option<String>, // Result summary
    pub status: String,        // "success", "error", "running"
}
```

- [ ] **Step 2: Add activities field to ClaudeInstance in instance_manager.rs**

Find `pub struct ClaudeInstance` and add field:
```rust
pub activities: Vec<crate::lib::ToolActivityDetail>, // Recent tool activities (max 10)
```

Update `ClaudeInstance::new()` to initialize:
```rust
activities: Vec::new(),
```

- [ ] **Step 3: Add activity collection in http_server.rs**

Add helper function to record tool activity:
```rust
fn record_tool_activity(
    state: &Arc<RwLock<AppState>>,
    session_id: &str,
    tool_name: String,
    content: String,
    status: String,
    result: Option<String>,
) {
    let activity = crate::lib::ToolActivityDetail {
        tool_name,
        content,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        result,
        status,
    };
    
    let mut state_guard = state.write();
    if let Some(instance) = state_guard.instances.get_mut(session_id) {
        instance.activities.push(activity);
        // Keep only last 10
        if instance.activities.len() > 10 {
            instance.activities.remove(0);
        }
    }
}
```

- [ ] **Step 4: Call record_tool_activity on PreToolUse hook**

In `handle_hook` function, after processing PreToolUse:
```rust
if hook_event == "PreToolUse" {
    let tool_name = input.tool_name.clone().unwrap_or_default();
    let content = extract_tool_content(&input.tool_input, &tool_name);
    record_tool_activity(&state, &input.session_id, tool_name, content, "running".to_string(), None);
}
```

- [ ] **Step 5: Call record_tool_activity on PostToolUse hook**

```rust
if hook_event == "PostToolUse" {
    let tool_name = input.tool_name.clone().unwrap_or_default();
    let content = extract_tool_content(&input.tool_input, &tool_name);
    // Determine success/error from tool_result
    let status = if input.tool_result.as_ref().map(|r| r.contains("error")).unwrap_or(false) {
        "error"
    } else {
        "success"
    };
    let result = input.tool_result.clone();
    record_tool_activity(&state, &input.session_id, tool_name, content, status.to_string(), result);
}
```

- [ ] **Step 6: Add IPC command get_activities**

In lib.rs invoke_handler:
```rust
.invoke_handler(tauri::Builder::default().invoke_handler(
    #[cfg(feature = "desktop")]
    tauri::generate_handler![
        // ... existing commands ...
        get_activities,
    ]
))

// Add command function
#[tauri::command]
fn get_activities(session_id: String) -> Vec<ToolActivityDetail> {
    let state = SHARED_STATE.read();
    state.instances.get(&session_id)
        .map(|i| i.activities.clone())
        .unwrap_or_default()
}
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/http_server.rs src-tauri/src/instance_manager.rs
git commit -m "feat(backend): add ToolActivityDetail collection and IPC command"
```

---

## Task 2: Frontend Types and Store Updates

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/stores/appStore.ts`

- [ ] **Step 1: Add ToolActivityDetail type in types/index.ts**

```typescript
// Add after existing ToolActivity interface
export interface ToolActivityDetail {
  tool_name: string;
  content: string;
  timestamp: number;
  result?: string;
  status: 'success' | 'error' | 'running';
}

// Add to ClaudeInstance interface
export interface ClaudeInstance {
  // ... existing fields ...
  activities?: ToolActivityDetail[];
}
```

- [ ] **Step 2: Update appStore.ts with new state**

```typescript
interface AppState {
  // ... existing fields ...
  layoutMode: 'island' | 'desktop';
  showArchiveTab: boolean;
  setIslandMode: () => void;
  setDesktopMode: () => void;
  setShowArchiveTab: (show: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // ... existing state ...
  layoutMode: 'island',
  showArchiveTab: false,
  setIslandMode: () => set({ layoutMode: 'island' }),
  setDesktopMode: () => set({ layoutMode: 'desktop' }),
  setShowArchiveTab: (showArchiveTab) => set({ showArchiveTab }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/stores/appStore.ts
git commit -m "feat(frontend): add ToolActivityDetail type and layoutMode state"
```

---

## Task 3: Status Colors Constants

**Files:**
- Create: `src/utils/statusColors.ts`

- [ ] **Step 1: Create statusColors.ts**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

export const StatusColors = {
  running: {
    border: '#4caf50',
    text: '#4caf50',
    bg: 'rgba(76,175,80,0.08)',
    icon: '⚡',
  },
  thinking: {
    border: '#ffb700',
    text: '#ffb700',
    bg: 'rgba(255,183,0,0.08)',
    icon: '💭',
  },
  idle: {
    border: '#9e9e9e',
    text: '#9e9e9e',
    bg: 'rgba(158,158,158,0.05)',
    icon: '●',
  },
  ended: {
    border: '#ff9800',
    text: '#ff9800',
    bg: 'rgba(255,152,0,0.08)',
    icon: '●',
  },
  error: {
    border: '#f44336',
    text: '#f44336',
    bg: 'rgba(244,67,54,0.08)',
    icon: '⚠',
  },
};

export type StatusType = keyof typeof StatusColors;

export function getStatusColor(status: InstanceStatus): StatusColorsConfig {
  switch (status.type) {
    case 'working':
    case 'waiting':
      return StatusColors.running;
    case 'thinking':
      return StatusColors.thinking;
    case 'idle':
      return StatusColors.idle;
    case 'ended':
      return StatusColors.ended;
    case 'error':
      return StatusColors.error;
    case 'waitingforapproval':
      return StatusColors.running;
    case 'compacting':
      return StatusColors.thinking;
    default:
      return StatusColors.idle;
  }
}

export type StatusColorsConfig = typeof StatusColors.running;
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/statusColors.ts
git commit -m "feat(utils): add statusColors constants for session display"
```

---

## Task 4: SessionCard Component (Two-row Layout)

**Files:**
- Create: `src/components/SessionCard.tsx`

- [ ] **Step 1: Create SessionCard.tsx with two-row layout**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';
import { useState } from 'react';
import { ClaudeInstance, PopupItem, ToolActivityDetail } from '../types';
import { getStatusColor, StatusColors } from '../utils/statusColors';
import { calculateDisplayName, calculateTooltip } from '../utils/displayName';
import { formatDuration, formatTimeAgo } from '../utils/timeFormat';
import { ActivityPopup } from './ActivityPopup';

interface SessionCardProps {
  instance: ClaudeInstance;
  allInstances: ClaudeInstance[];
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
  onViewChat: (sessionId: string) => void;
  isDesktopMode?: boolean;
}

export function SessionCard({ 
  instance, 
  allInstances, 
  pendingPopup, 
  onJump, 
  onViewChat,
  isDesktopMode = false 
}: SessionCardProps) {
  const [showActivityPopup, setShowActivityPopup] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  
  const displayName = calculateDisplayName(instance, allInstances);
  const statusColor = getStatusColor(instance.status);
  const activities = instance.activities || [];
  
  // Current activity (last one if running)
  const currentActivity = activities.find(a => a.status === 'running');
  const historyActivities = activities.filter(a => a.status !== 'running').slice(-3);
  const hasMore = activities.filter(a => a.status !== 'running').length > 3;
  
  // Time display
  const startTime = formatTimeAgo(instance.started_at);
  const runningTime = formatDuration(Date.now() / 1000 - instance.started_at);
  
  // Status text
  const statusText = getStatusText(instance.status);
  
  const buttonSize = isDesktopMode ? 'normal' : 'compact';
  
  return (
    <motion.div
      className="relative overflow-hidden"
      style={{
        borderLeft: `${isDesktopMode ? 4 : 3}px solid ${statusColor.border}`,
        background: statusColor.bg,
        borderRadius: isDesktopMode ? '0 12px 12px 0' : '0 10px 10px 0',
        padding: isDesktopMode ? '12px 16px' : '10px 14px',
      }}
      onClick={() => onViewChat(instance.session_id)}
    >
      {/* Row 1: Name + Status + Time */}
      <div className="flex items-center justify-between">
        <span className="text-white font-medium truncate" style={{ fontSize: isDesktopMode ? 15 : 14 }}>
          {displayName}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: statusColor.text, fontSize: isDesktopMode ? 12 : 11 }}>
            {statusColor.icon} {statusText}
          </span>
          <span className="text-gray-400" style={{ fontSize: isDesktopMode ? 12 : 11 }}>
            {runningTime}
          </span>
          <span className="text-gray-500" style={{ fontSize: isDesktopMode ? 11 : 10 }}>
            {instance.status.type === 'ended' 
              ? `${formatTimeAgo(instance.started_at)}-${formatTimeAgo(instance.last_activity_at)}`
              : startTime
            }
          </span>
        </div>
      </div>
      
      {/* Row 2: Current Command + History + Buttons */}
      <div className="flex items-center gap-2 mt-2" style={{ fontSize: isDesktopMode ? 11 : 10 }}>
        {/* Current command (if running) */}
        {currentActivity && (
          <div 
            className="flex items-center gap-1 px-2 rounded"
            style={{
              background: `rgba(${hexToRgb(statusColor.border)},0.15)`,
              border: `1px solid rgba(${hexToRgb(statusColor.border)},0.3)`,
              padding: isDesktopMode ? '4px 12px' : '3px 10px',
            }}
          >
            <span style={{ color: statusColor.text }}>{statusColor.icon}</span>
            <span className="font-semibold" style={{ color: statusColor.text }}>
              {currentActivity.tool_name}
            </span>
            <span style={{ color: '#aaa' }}>:</span>
            <span className="truncate max-w-32" style={{ color: '#e0e0e0' }}>
              {truncateContent(currentActivity.content)}
            </span>
          </div>
        )}
        
        {/* Separator */}
        {currentActivity && historyActivities.length > 0 && (
          <span style={{ color: '#555' }}>|</span>
        )}
        
        {/* History tags */}
        {historyActivities.slice(0, 3).map((act, i) => (
          <span 
            key={i}
            className="px-1 rounded"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#aaa', padding: isDesktopMode ? '3px 8px' : '2px 5px' }}
          >
            {act.tool_name}
          </span>
        ))}
        
        {/* Expand button */}
        {hasMore && (
          <button 
            onClick={(e) => { e.stopPropagation(); setShowActivityPopup(true); }}
            className="rounded"
            style={{ 
              background: 'rgba(255,255,255,0.06)', 
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#888',
              padding: isDesktopMode ? '3px 10px' : '2px 8px',
            }}
          >
            +{activities.length - 3} ▾
          </button>
        )}
        
        {/* Flexible space */}
        <div className="flex-1" />
        
        {/* Action buttons */}
        <SessionButtons
          sessionId={instance.session_id}
          status={instance.status.type}
          onJump={onJump}
          onViewChat={onViewChat}
          size={buttonSize}
        />
      </div>
      
      {/* Activity popup */}
      {showActivityPopup && (
        <ActivityPopup
          activities={activities}
          onClose={() => setShowActivityPopup(false)}
        />
      )}
    </motion.div>
  );
}

// Helper components and functions
function SessionButtons({ sessionId, status, onJump, onViewChat, size }: {
  sessionId: string;
  status: string;
  onJump: (id: string) => void;
  onViewChat: (id: string) => void;
  size: 'normal' | 'compact';
}) {
  const isEnded = status === 'ended';
  
  if (size === 'compact') {
    return (
      <>
        <button 
          onClick={(e) => { e.stopPropagation(); onViewChat(sessionId); }}
          className="rounded px-1"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', padding: '4px 8px' }}
        >
          💬
        </button>
        {!isEnded && (
          <button 
            onClick={(e) => { e.stopPropagation(); onJump(sessionId); }}
            className="rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: '#888', padding: '4px' }}
          >
            ⌨️
          </button>
        )}
      </>
    );
  }
  
  return (
    <>
      <button 
        onClick={(e) => { e.stopPropagation(); onViewChat(sessionId); }}
        className="flex items-center gap-1 rounded"
        style={{ 
          background: 'rgba(255,255,255,0.1)', 
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff',
          padding: '5px 10px',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M2 2h8v5H4l-2 2V2z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
        会话
      </button>
      {!isEnded && (
        <button 
          onClick={(e) => { e.stopPropagation(); onJump(sessionId); }}
          className="rounded"
          style={{ 
            background: 'rgba(255,255,255,0.06)', 
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#888',
            padding: '5px',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 4 L6 6 L4 8" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
        </button>
      )}
    </>
  );
}

function getStatusText(status: InstanceStatus): string {
  switch (status.type) {
    case 'working': return '运行中';
    case 'thinking': return '思考中';
    case 'waiting': return '运行中';
    case 'idle': return '空闲';
    case 'ended': return '已结束';
    case 'error': return '报错';
    case 'waitingforapproval': return '等待授权';
    case 'compacting': return '压缩中';
    default: return '未知';
  }
}

function truncateContent(content: string, maxLen = 30): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '...';
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '255,255,255';
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SessionCard.tsx
git commit -m "feat(ui): add SessionCard component with two-row layout"
```

---

## Task 5: ActivityPopup Component

**Files:**
- Create: `src/components/ActivityPopup.tsx`

- [ ] **Step 1: Create ActivityPopup.tsx**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion, AnimatePresence } from 'framer-motion';
import { ToolActivityDetail } from '../types';
import { StatusColors } from '../utils/statusColors';

interface ActivityPopupProps {
  activities: ToolActivityDetail[];
  onClose: () => void;
}

export function ActivityPopup({ activities, onClose }: ActivityPopupProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute left-0 right-0 z-10 mt-2"
        style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '8px',
        }}
      >
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="text-gray-400" style={{ fontSize: 11 }}>最近10条活动</span>
          <span className="text-gray-500" style={{ fontSize: 10 }}>点击查看完整内容</span>
        </div>
        
        <div className="flex flex-col gap-1">
          {activities.map((act, i) => (
            <ActivityRow key={i} activity={act} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ActivityRow({ activity }: { activity: ToolActivityDetail }) {
  const time = new Date(activity.timestamp * 1000).toLocaleTimeString(undefined, { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
  
  const statusStyle = activity.status === 'running'
    ? { bg: 'rgba(76,175,80,0.1)', color: StatusColors.running.text }
    : activity.status === 'error'
    ? { bg: 'rgba(244,67,54,0.08)', color: StatusColors.error.text }
    : { bg: 'rgba(255,255,255,0.03)', color: '#aaa' };
  
  return (
    <div 
      className="flex items-start gap-2 p-1 rounded"
      style={{ background: statusStyle.bg, fontSize: 11 }}
    >
      <span className="text-gray-500" style={{ fontSize: 10, width: '50px' }}>{time}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium" style={{ color: statusStyle.color }}>
            {activity.tool_name}
          </span>
          <span className="text-gray-400 truncate max-w-48">
            {truncateContent(activity.content, 40)}
          </span>
        </div>
        {activity.result && (
          <div className="text-gray-400 mt-0.5" style={{ fontSize: 10 }}>
            {activity.status === 'success' && <span style={{ color: '#4caf50' }}>✓</span>}
            {activity.status === 'error' && <span style={{ color: '#f44336' }}>✗</span>}
            {activity.status === 'running' && <span style={{ color: '#4caf50' }}>●</span>}
            {' '}{truncateContent(activity.result, 50)}
          </div>
        )}
      </div>
    </div>
  );
}

function truncateContent(content: string, maxLen: number): string {
  if (!content) return '';
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '...';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ActivityPopup.tsx
git commit -m "feat(ui): add ActivityPopup for expanded activity details"
```

---

## Task 6: ArchiveTab Component

**Files:**
- Create: `src/components/ArchiveTab.tsx`

- [ ] **Step 1: Create ArchiveTab.tsx**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';
import { ClaudeInstance } from '../types';
import { useAppStore } from '../stores/appStore';
import { StatusColors, getStatusColor } from '../utils/statusColors';
import { calculateDisplayName } from '../utils/displayName';
import { formatTimeAgo, formatDuration } from '../utils/timeFormat';

interface ArchiveTabProps {
  activeCount: number;
  archivedInstances: ClaudeInstance[];
  onSelectTab: (tab: 'active' | 'archive') => void;
  onViewChat: (sessionId: string) => void;
}

export function ArchiveTab({ activeCount, archivedInstances, onSelectTab, onViewChat }: ArchiveTabProps) {
  const { showArchiveTab } = useAppStore();
  const archiveCount = archivedInstances.length;
  
  return (
    <div className="flex flex-col gap-2">
      {/* Tab buttons */}
      <div className="flex gap-2 px-0 py-1">
        <motion.button
          onClick={() => onSelectTab('active')}
          className="rounded-lg font-medium"
          style={{
            background: showArchiveTab ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)',
            color: showArchiveTab ? '#888' : '#fff',
            padding: '8px 16px',
            fontSize: 12,
          }}
          whileHover={{ scale: 1.02 }}
        >
          活动会话 ({activeCount})
        </motion.button>
        <motion.button
          onClick={() => onSelectTab('archive')}
          className="rounded-lg flex items-center gap-1"
          style={{
            background: showArchiveTab ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
            color: showArchiveTab ? '#fff' : '#888',
            padding: '8px 16px',
            fontSize: 12,
          }}
          whileHover={{ scale: 1.02 }}
        >
          归档 ({archiveCount}) ▾
        </motion.button>
      </div>
      
      {/* Archived list (if showing) */}
      {showArchiveTab && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col gap-1 p-1 rounded-lg"
          style={{ background: 'rgba(0,0,0,0.2)' }}
        >
          {archivedInstances.map((instance) => (
            <ArchivedRow
              key={instance.session_id}
              instance={instance}
              onClick={() => onViewChat(instance.session_id)}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function ArchivedRow({ instance, onClick }: { instance: ClaudeInstance; onClick: () => void }) {
  const displayName = calculateDisplayName(instance, [instance]);
  const statusColor = getStatusColor(instance.status);
  const timeRange = `${formatTimeAgo(instance.started_at)}-${formatTimeAgo(instance.last_activity_at)}`;
  const duration = formatDuration(instance.last_activity_at - instance.started_at);
  
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between cursor-pointer rounded-r-lg"
      style={{
        borderLeft: `2px solid ${statusColor.border}`,
        background: statusColor.bg,
        padding: '6px 10px',
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: statusColor.text, fontSize: 9 }}>●</span>
        <span className="text-gray-300" style={{ fontSize: 12 }}>{displayName}</span>
        <span className="text-gray-500" style={{ fontSize: 10 }}>{timeRange}</span>
        <span className="text-gray-400" style={{ fontSize: 10 }}>{duration}</span>
      </div>
      <div className="text-gray-500" style={{ fontSize: 9 }}>
        {instance.status.type === 'error' ? '报错' : `历史 ${instance.activities?.length || 0}`}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ArchiveTab.tsx
git commit -m "feat(ui): add ArchiveTab for active/archive session switching"
```

---

## Task 7: DesktopMode Component

**Files:**
- Create: `src/components/DesktopMode.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create DesktopMode.tsx**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';
import { useAppStore } from '../stores/appStore';
import { ClaudeInstance, PopupItem } from '../types';
import { SessionCard } from './SessionCard';
import { ArchiveTab } from './ArchiveTab';

interface DesktopModeProps {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat: (sessionId: string) => void;
}

export function DesktopMode({ instances, popups, onJump, onViewChat }: DesktopModeProps) {
  const { setIslandMode, showArchiveTab, setShowArchiveTab } = useAppStore();
  
  // Split active and archived (ended + idle > 10min)
  const { active, archived } = splitInstances(instances);
  
  // Sort active by priority
  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getStatusPriority(a.status, popups.find(p => p.session_id === a.session_id));
    const priorityB = getStatusPriority(b.status, popups.find(p => p.session_id === b.session_id));
    return priorityA - priorityB;
  });
  
  const displayedInstances = showArchiveTab ? archived : sortedActive;
  
  return (
    <div 
      className="h-full flex flex-col rounded-xl"
      style={{
        background: 'rgba(20,20,20,0.98)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      {/* Title bar */}
      <div 
        className="flex items-center justify-between px-4 py-3"
        style={{
          background: 'rgba(30,30,30,0.5)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="#d97857">
            <circle cx="9" cy="9" r="7" fill="#d97857"/>
          </svg>
          <span className="text-white font-semibold" style={{ fontSize: 14 }}>CC-Island</span>
          <span className="text-green-400" style={{ fontSize: 11 }}>● {active.length}个会话运行中</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Layout switch button */}
          <button
            onClick={() => setIslandMode()}
            className="rounded-lg"
            style={{
              background: 'rgba(76,175,80,0.1)',
              border: '1px solid rgba(76,175,80,0.3)',
              color: '#4caf50',
              padding: '6px 10px',
              fontSize: 11,
            }}
          >
            Island 模式
          </button>
          {/* Settings button placeholder */}
          <button
            className="rounded-lg"
            style={{
              background: 'rgba(255,255,255,0.1)',
              padding: '6px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="#888">
              <circle cx="7" cy="3" r="1.5"/>
              <circle cx="7" cy="7" r="1.5"/>
              <circle cx="7" cy="11" r="1.5"/>
            </svg>
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 flex flex-col p-3 overflow-y-auto gap-2">
        {/* Archive tab */}
        <ArchiveTab
          activeCount={active.length}
          archivedInstances={archived}
          onSelectTab={(tab) => setShowArchiveTab(tab === 'archive')}
          onViewChat={onViewChat}
        />
        
        {/* Session cards */}
        <div className="flex flex-col gap-2">
          {displayedInstances.map((instance) => (
            <SessionCard
              key={instance.session_id}
              instance={instance}
              allInstances={displayedInstances}
              pendingPopup={popups.find(p => p.session_id === instance.session_id)}
              onJump={onJump}
              onViewChat={onViewChat}
              isDesktopMode={true}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper functions
function splitInstances(instances: ClaudeInstance[]): { active: ClaudeInstance[], archived: ClaudeInstance[] } {
  const FOLD_THRESHOLD = 600; // 10 minutes
  const now = Math.floor(Date.now() / 1000);
  
  const active: ClaudeInstance[] = [];
  const archived: ClaudeInstance[] = [];
  
  for (const inst of instances) {
    const isEnded = inst.status.type === 'ended';
    const isIdleTooLong = inst.status.type === 'idle' && (now - inst.last_activity_at) >= FOLD_THRESHOLD;
    
    if (isEnded || isIdleTooLong) {
      archived.push(inst);
    } else {
      active.push(inst);
    }
  }
  
  return { active, archived };
}

function getStatusPriority(status: InstanceStatus, popup?: PopupItem): number {
  if (popup) return 0;
  if (status.type === 'working' || status.type === 'thinking' || status.type === 'waiting') return 1;
  if (status.type === 'compacting') return 1;
  if (status.type === 'idle') return 2;
  return 3;
}
```

- [ ] **Step 2: Update App.tsx to support desktop mode**

Find the main render section and add layout mode check:
```typescript
// Inside App component, after existing state declarations
const { layoutMode, setDesktopMode, setIslandMode } = useAppStore();

// Add layout mode toggle button in expanded view (after settings button)
// And add desktop mode rendering:

// In the main return, wrap with layout mode check:
if (layoutMode === 'desktop') {
  return (
    <div className="h-screen w-screen bg-transparent p-2">
      <DesktopMode
        instances={instances}
        popups={popups}
        onJump={handleJump}
        onViewChat={handleViewChat}
      />
    </div>
  );
}

// Add layout mode button in island expanded view
// (in the header section, add button)
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DesktopMode.tsx src/App.tsx
git commit -m "feat(ui): add DesktopMode component and layout switching"
```

---

## Task 8: Update InstanceList to Use SessionCard

**Files:**
- Modify: `src/components/InstanceList.tsx`

- [ ] **Step 1: Refactor InstanceList to use SessionCard**

Replace the existing InstanceRow with SessionCard:
```typescript
// In InstanceList.tsx, replace the sortedActive.map section with:

{sortedActive.map((instance) => (
  <SessionCard
    key={instance.session_id}
    instance={instance}
    allInstances={sortedActive}
    pendingPopup={popups.find(p => p.session_id === instance.session_id)}
    onJump={onJump}
    onViewChat={onViewChat}
    isDesktopMode={false}
  />
))}
```

Import SessionCard at top:
```typescript
import { SessionCard } from './SessionCard';
```

- [ ] **Step 2: Commit**

```bash
git add src/components/InstanceList.tsx
git commit -m "refactor(ui): update InstanceList to use SessionCard component"
```

---

## Task 9: Update Window Size for Desktop Mode

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add desktop mode window configuration**

In tauri.conf.json, add minWidth/minHeight for resizing:
```json
{
  "windows": [
    {
      "label": "main",
      "width": 480,
      "height": 400,
      "minWidth": 300,
      "minHeight": 300,
      "resizable": true,
      ...
    }
  ]
}
```

- [ ] **Step 2: Handle window resize in App.tsx**

Add logic to resize window on mode switch:
```typescript
// In the layout mode switch handler
import { getCurrentWindow } from '@tauri-apps/api/window';

const handleDesktopMode = async () => {
  setDesktopMode();
  const win = getCurrentWindow();
  await win.setSize({ width: 480, height: 600 });
};

const handleIslandMode = async () => {
  setIslandMode();
  const win = getCurrentWindow();
  await win.setSize({ width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT });
};
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src/App.tsx
git commit -m "feat(config): add window resizing for desktop mode"
```

---

## Task 10: Add Slide Menu for Delete/Archive

**Files:**
- Create: `src/components/SlideMenu.tsx`
- Modify: `src/components/SessionCard.tsx`

- [ ] **Step 1: Create SlideMenu.tsx**

```typescript
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';

interface SlideMenuProps {
  onDelete: () => void;
  onArchive: () => void;
}

export function SlideMenu({ onDelete, onArchive }: SlideMenuProps) {
  return (
    <motion.div
      initial={{ x: 80 }}
      animate={{ x: 0 }}
      className="flex flex-col gap-1 justify-center"
      style={{
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '8px',
        width: '80px',
      }}
    >
      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="flex items-center gap-1"
        style={{ 
          background: 'none', 
          border: 'none', 
          color: '#f44336', 
          fontSize: 11,
          padding: '4px',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        </svg>
        删除
      </button>
      
      {/* Archive button */}
      <button
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
        className="flex items-center gap-1"
        style={{ 
          background: 'none', 
          border: 'none', 
          color: '#888', 
          fontSize: 11,
          padding: '4px',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M2 3h10v2H2V3zm0 3h10v6H2V6zm2 2v2h6V8H4z" fill="none" stroke="currentColor" strokeWidth="1"/>
        </svg>
        归档
      </button>
    </motion.div>
  );
}
```

- [ ] **Step 2: Add slide detection in SessionCard.tsx**

Add touch/pointer event handling:
```typescript
// In SessionCard, add:
const [slideOffset, setSlideOffset] = useState(0);
const [isSliding, setIsSliding] = useState(false);
const SLIDE_THRESHOLD = 80;

const handlePointerDown = (e: React.PointerEvent) => {
  setIsSliding(true);
};

const handlePointerMove = (e: React.PointerEvent) => {
  if (!isSliding) return;
  const offset = Math.max(0, -e.movementX);
  setSlideOffset(offset);
};

const handlePointerUp = () => {
  setIsSliding(false);
  if (slideOffset > SLIDE_THRESHOLD) {
    setShowSlideMenu(true);
  } else {
    setSlideOffset(0);
  }
};

// In the motion.div wrapper:
<motion.div
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  style={{ 
    transform: `translateX(-${slideOffset}px)`,
  }}
>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SlideMenu.tsx src/components/SessionCard.tsx
git commit -m "feat(ui): add SlideMenu for delete/archive actions"
```

---

## Task 11: Final Integration and Testing

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript compilation**

```bash
pnpm exec tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: Run Rust compilation**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: No errors

- [ ] **Step 3: Start development server**

```bash
pnpm tauri dev
```

- [ ] **Step 4: Test UI features**

1. Check two-row layout displays correctly
2. Check status colors are applied
3. Check current command shows for running sessions
4. Check history tags display
5. Click expand button to see activity popup
6. Check archive tab switching
7. Test layout mode switching (island/desktop)
8. Test slide menu on touch/drag

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete session display improvement with all components"
```

---

## Self-Review Checklist

**Spec Coverage:**
- ✓ Two-row layout with name+status+time on row1
- ✓ Status colors: green/amber/gray/orange/red
- ✓ Current command display with tool name and content
- ✓ History tags with expand popup
- ✓ Activity details with result summary
- ✓ Action buttons: view chat + jump to terminal
- ✓ Slide menu: delete + archive
- ✓ Archive tab: active/archive switching
- ✓ Layout mode: island + desktop

**Placeholder Scan:**
- No TBD/TODO found
- No vague "add error handling" without code
- All code blocks contain complete implementation

**Type Consistency:**
- ToolActivityDetail type matches between frontend and backend
- StatusColors type used consistently
- InstanceStatus type from existing types