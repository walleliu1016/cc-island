# Mobile UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign mobile app UI as a lightweight notification center with dual-tone colors and expandable popup cards.

**Architecture:** Dark background (`#0f0f0f`) + light popup cards (`#ffffff`), expandable cards with animation, Ask multi-question navigation.

**Tech Stack:** React, TypeScript, Tailwind CSS, Capacitor

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `mobile-app/src/index.css` | Modify | Update CSS variables for dual-tone colors |
| `mobile-app/src/components/Toast.tsx` | Create | Toast notification component |
| `mobile-app/src/components/DeviceListPage.tsx` | Modify | Device cards with badges, header buttons |
| `mobile-app/src/components/DeviceDetailPage.tsx` | Modify | Sessions + popups layout with sections |
| `mobile-app/src/components/PopupCard.tsx` | Rewrite | Expandable popup card + Ask navigation |
| `mobile-app/src/components/AddDeviceModal.tsx` | Modify | Light card styling |
| `mobile-app/src/components/SettingsPage.tsx` | Rename from SettingsModal.tsx | Full page with auto-allow toggle |
| `mobile-app/src/App.tsx` | Modify | Add SettingsPage routing, Toast context |
| `mobile-app/src/hooks/useToast.ts` | Create | Toast state management hook |

---

### Task 1: Update CSS Variables for Dual-Tone Colors

**Files:**
- Modify: `mobile-app/src/index.css`

- [ ] **Step 1: Update index.css with new color palette**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Dark theme colors (background) */
  --bg-dark: #0f0f0f;
  --bg-card-dark: #1a1a1a;
  
  /* Light theme colors (popup cards) */
  --bg-card-light: #ffffff;
  --text-light: #1a1a1a;
  
  /* Status colors */
  --status-online: #22c55e;
  --status-offline: #737373;
  --status-warning: #f59e0b;
  
  /* Button colors */
  --btn-allow: #22c55e;
  --btn-deny: #ef4444;
  --badge-bg: #ef4444;
  
  /* Text colors (dark background) */
  --text-primary: #f5f5f5;
  --text-secondary: #a3a3a3;
  --text-muted: #737373;
  
  /* Border colors */
  --border-dark: #262626;
  --border-light: #e5e5e5;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-dark);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
}

#root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
```

- [ ] **Step 2: Build and verify CSS changes**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds with no CSS errors

- [ ] **Step 3: Commit CSS changes**

```bash
git add mobile-app/src/index.css
git commit -m "style: Update mobile app CSS with dual-tone color palette"
```

---

### Task 2: Create Toast Component

**Files:**
- Create: `mobile-app/src/components/Toast.tsx`
- Create: `mobile-app/src/hooks/useToast.ts`

- [ ] **Step 1: Create useToast hook**

```tsx
// mobile-app/src/hooks/useToast.ts
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'warning'

interface ToastState {
  visible: boolean
  message: string
  type: ToastType
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'success',
  })

  const showToast = useCallback((message: string, type: ToastType = 'success', duration: number = 2000) => {
    setToast({ visible: true, message, type })
    setTimeout(() => {
      setToast({ visible: false, message: '', type: 'success' })
    }, duration)
  }, [])

  const showSuccess = useCallback((message: string) => showToast(message, 'success', 2000), [showToast])
  const showError = useCallback((message: string) => showToast(message, 'error', 2000), [showToast])
  const showWarning = useCallback((message: string) => showToast(message, 'warning', 3000), [showToast])

  const hideToast = useCallback(() => {
    setToast({ visible: false, message: '', type: 'success' })
  }, [])

  return { toast, showSuccess, showError, showWarning, hideToast }
}
```

- [ ] **Step 2: Create Toast component**

```tsx
// mobile-app/src/components/Toast.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type ToastType = 'success' | 'error' | 'warning'

interface ToastProps {
  visible: boolean
  message: string
  type: ToastType
}

const toastStyles: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: 'bg-[#22c55e]', icon: '✓' },
  error: { bg: 'bg-[#ef4444]', icon: '✗' },
  warning: { bg: 'bg-[#f59e0b]', icon: '⚠' },
}

export function Toast({ visible, message, type }: ToastProps) {
  const style = toastStyles[type]

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50"
        >
          <div className={`${style.bg} text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2`}>
            <span>{style.icon}</span>
            <span className="text-sm font-medium">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 3: Build and verify Toast component**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit Toast components**

```bash
git add mobile-app/src/components/Toast.tsx mobile-app/src/hooks/useToast.ts
git commit -m "feat: Add Toast notification component with useToast hook"
```

---

### Task 3: Update DeviceListPage with Badges and Header Buttons

**Files:**
- Modify: `mobile-app/src/components/DeviceListPage.tsx`
- Modify: `mobile-app/src/App.tsx`

- [ ] **Step 1: Update DeviceListPage with new layout**

```tsx
// mobile-app/src/components/DeviceListPage.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'

interface DeviceInfo {
  token: string
  name: string
  online: boolean
  pendingCount: number
  lastActivity: string | null
}

interface DeviceListPageProps {
  devices: string[]
  onSelectDevice: (token: string) => void
  onAddDevice: () => void
  onOpenSettings: () => void
  serverConnected: boolean
}

export function DeviceListPage({ 
  devices, 
  onSelectDevice, 
  onAddDevice, 
  onOpenSettings,
  serverConnected 
}: DeviceListPageProps) {
  // Mock device info for now - will be replaced with real data from WebSocket
  const [deviceInfos, setDeviceInfos] = useState<DeviceInfo[]>([])
  
  useEffect(() => {
    // Convert tokens to DeviceInfo objects
    const infos: DeviceInfo[] = devices.map(token => ({
      token,
      name: token.slice(0, 8) + '...',
      online: false, // Will be updated by WebSocket
      pendingCount: 0,
      lastActivity: null,
    }))
    setDeviceInfos(infos)
  }, [devices])

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${serverConnected ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
          <span className="text-[#a3a3a3] text-sm">
            {serverConnected ? '云服务器已连接' : '未连接'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onOpenSettings} className="text-[#a3a3a3] hover:text-[#f5f5f5] text-lg">
            ⚙
          </button>
          <button onClick={onAddDevice} className="text-[#a3a3a3] hover:text-[#f5f5f5] text-lg">
            +
          </button>
        </div>
      </div>

      {/* Device List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {deviceInfos.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[#737373] text-sm mb-4">暂无设备</div>
            <button
              onClick={onAddDevice}
              className="px-4 py-2 bg-[#1a1a1a] rounded-[12px] text-[#a3a3a3] text-sm border border-[#262626]"
            >
              添加设备
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {deviceInfos.map(info => (
              <DeviceCard
                key={info.token}
                info={info}
                onClick={() => onSelectDevice(info.token)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DeviceCard({ info, onClick }: { info: DeviceInfo; onClick: () => void }) {
  const timeText = info.lastActivity 
    ? `最后: ${formatTime(info.lastActivity)}` 
    : ''

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between p-4 rounded-[12px] bg-[#1a1a1a] border border-[#262626] cursor-pointer"
    >
      <div className="flex items-center gap-3">
        <span className="text-[#f5f5f5] text-[16px] font-medium">{info.name}</span>
        <div className={`w-2 h-2 rounded-full ${info.online ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
        <span className="text-[#a3a3a3] text-[14px]">
          {info.online ? '在线' : '离线'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {info.pendingCount > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-5 h-5 rounded-full bg-[#ef4444] flex items-center justify-center">
              <span className="text-white text-xs font-medium">{info.pendingCount}</span>
            </div>
          </div>
        )}
        {timeText && (
          <span className="text-[#737373] text-xs">{timeText}</span>
        )}
      </div>
    </div>
  )
}

function formatTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diff = Math.floor((now - then) / 1000 / 60)
  
  if (diff < 1) return '刚刚'
  if (diff < 60) return `${diff}分钟`
  if (diff < 24 * 60) return `${Math.floor(diff / 60)}小时`
  return `${Math.floor(diff / 24 / 60)}天`
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit DeviceListPage changes**

```bash
git add mobile-app/src/components/DeviceListPage.tsx
git commit -m "feat: Update DeviceListPage with badges and header buttons"
```

---

### Task 4: Create SettingsPage with Auto-Allow Toggle

**Files:**
- Rename: `mobile-app/src/components/SettingsModal.tsx` → `mobile-app/src/components/SettingsPage.tsx`

- [ ] **Step 1: Rename file and rewrite SettingsPage**

```tsx
// mobile-app/src/components/SettingsPage.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'

interface DeviceSettings {
  token: string
  autoAllow: boolean
}

interface SettingsPageProps {
  serverUrl: string
  serverConnected: boolean
  devices: string[]
  onSaveServer: (url: string) => void
  onDeleteDevice: (token: string) => void
  onToggleAutoAllow: (token: string, enabled: boolean) => void
  onBack: () => void
}

export function SettingsPage({
  serverUrl,
  serverConnected,
  devices,
  onSaveServer,
  onDeleteDevice,
  onToggleAutoAllow,
  onBack,
}: SettingsPageProps) {
  const [url, setUrl] = useState(serverUrl)
  const [error, setError] = useState<string | null>(null)
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings[]>([])

  useEffect(() => {
    // Load device settings from localStorage
    const saved = localStorage.getItem('cc-device-settings')
    if (saved) {
      setDeviceSettings(JSON.parse(saved))
    } else {
      // Initialize with defaults
      const initial: DeviceSettings[] = devices.map(token => ({ token, autoAllow: false }))
      setDeviceSettings(initial)
    }
  }, [devices])

  useEffect(() => {
    localStorage.setItem('cc-device-settings', JSON.stringify(deviceSettings))
  }, [deviceSettings])

  const handleSave = () => {
    setError(null)
    if (url.trim() && !url.startsWith('ws://') && !url.startsWith('wss://')) {
      setError('地址必须以 ws:// 或 wss:// 开头')
      return
    }
    onSaveServer(url.trim())
  }

  const toggleAutoAllow = (token: string) => {
    setDeviceSettings(prev => 
      prev.map(s => s.token === token ? { ...s, autoAllow: !s.autoAllow } : s)
    )
    const settings = deviceSettings.find(s => s.token === token)
    if (settings) {
      onToggleAutoAllow(token, !settings.autoAllow)
    }
  }

  const getAutoAllow = (token: string) => {
    const s = deviceSettings.find(d => d.token === token)
    return s?.autoAllow ?? false
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[#262626]">
        <button onClick={onBack} className="text-[#a3a3a3] mr-3 text-lg">←</button>
        <span className="text-[#f5f5f5] text-lg font-medium">设置</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Server Section */}
        <div className="mb-6">
          <div className="text-[#a3a3a3] text-xs mb-2">云服务器地址</div>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="wss://cloud.example.com:17528"
            className="w-full px-4 py-3 bg-[#1a1a1a] border border-[#262626] rounded-[12px] text-[#f5f5f5] text-[14px]"
          />
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-2 h-2 rounded-full ${serverConnected ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
            <span className="text-[#a3a3a3] text-xs">
              {serverConnected ? '已连接' : '未连接'}
            </span>
          </div>
          {error && (
            <div className="text-[#ef4444] text-xs mt-2">{error}</div>
          )}
          <button
            onClick={handleSave}
            className="w-full mt-3 py-2 bg-[#1a1a1a] border border-[#262626] rounded-[8px] text-[#f5f5f5] text-[14px]"
          >
            保存并重新连接
          </button>
        </div>

        {/* Auto-allow Section */}
        <div className="mb-6">
          <div className="text-[#a3a3a3] text-xs mb-2">权限设置</div>
          {devices.map(token => (
            <div key={token} className="flex items-center justify-between py-3 border-b border-[#262626]">
              <div>
                <div className="text-[#f5f5f5] text-sm">{token.slice(0, 8)}...</div>
                <div className="text-[#737373] text-xs">自动允许所有权限</div>
              </div>
              <button
                onClick={() => toggleAutoAllow(token)}
                className={`w-12 h-6 rounded-full relative transition-colors ${
                  getAutoAllow(token) ? 'bg-[#22c55e]' : 'bg-[#262626]'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                  getAutoAllow(token) ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>

        {/* Device List */}
        <div>
          <div className="text-[#a3a3a3] text-xs mb-2">已添加设备 ({devices.length})</div>
          {devices.map(token => (
            <div key={token} className="flex items-center justify-between py-3 border-b border-[#262626]">
              <span className="text-[#f5f5f5] text-sm">{token.slice(0, 8)}...</span>
              <button
                onClick={() => onDeleteDevice(token)}
                className="text-[#ef4444] text-xs"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove old SettingsModal.tsx**

```bash
rm mobile-app/src/components/SettingsModal.tsx
```

- [ ] **Step 3: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit SettingsPage changes**

```bash
git add mobile-app/src/components/SettingsPage.tsx
git commit -m "feat: Create SettingsPage with auto-allow toggle and device management"
```

---

### Task 5: Rewrite PopupCard with Expandable Cards

**Files:**
- Rewrite: `mobile-app/src/components/PopupCard.tsx`

- [ ] **Step 1: Rewrite PopupCard component**

```tsx
// mobile-app/src/components/PopupCard.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PopupState, PermissionData, AskData } from '../types'

interface PopupCardProps {
  popup: PopupState
  onRespond: (popupId: string, decision?: string | null, answers?: string[][]) => void
  onDismiss: (popupId: string) => void
}

export function PopupCard({ popup, onRespond, onDismiss }: PopupCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[][]>(() =>
    popup.data?.type === 'ask' ? (popup.data as AskData).questions.map(() => []) : []
  )

  // Auto-dismiss animation
  const handleRespond = (decision?: string | null, answers?: string[][]) => {
    onRespond(popup.id, decision, answers)
  }

  // Permission popup
  if (popup.type === 'permission') {
    const data = popup.data as PermissionData
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20, height: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-[12px] p-4 shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[#f59e0b]">⚠</span>
            <span className="text-[#1a1a1a] font-medium text-[16px]">{data?.tool_name || '权限请求'}</span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[#737373] text-sm"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>

        {/* Content */}
        <div className="text-[#1a1a1a] text-[14px] mb-3">
          {expanded ? (
            <div className="space-y-2">
              <div><span className="text-[#737373]">操作:</span> {data?.action}</div>
              {data?.details && <div className="text-[14px] text-[#737373] truncate">{data.details}</div>}
              <div><span className="text-[#737373]">项目:</span> {popup.project_name}</div>
            </div>
          ) : (
            <div className="truncate">{data?.action || ''}</div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => handleRespond('deny')}
            className="flex-1 py-2 bg-[#ef4444] text-white rounded-[8px] font-medium text-[14px]"
          >
            拒绝
          </button>
          <button
            onClick={() => handleRespond('allow')}
            className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] font-medium text-[14px]"
          >
            允许
          </button>
        </div>
      </motion.div>
    )
  }

  // Ask popup (multi-question)
  const askData = popup.data as AskData
  if (!askData?.questions) return null

  const questions = askData.questions
  const totalQuestions = questions.length
  const isLastQuestion = currentQuestion === totalQuestions - 1
  const isFirstQuestion = currentQuestion === 0
  const currentQ = questions[currentQuestion]

  const handleOptionSelect = (optionLabel: string) => {
    setSelectedAnswers(prev => {
      const newAnswers = [...prev]
      if (currentQ.multi_select) {
        const current = newAnswers[currentQuestion]
        if (current.includes(optionLabel)) {
          newAnswers[currentQuestion] = current.filter(o => o !== optionLabel)
        } else {
          newAnswers[currentQuestion] = [...current, optionLabel]
        }
      } else {
        newAnswers[currentQuestion] = [optionLabel]
      }
      return newAnswers
    })
  }

  const handleNext = () => {
    if (currentQuestion < totalQuestions - 1) {
      setCurrentQuestion(currentQuestion + 1)
    }
  }

  const handlePrev = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1)
    }
  }

  const handleSubmit = () => {
    handleRespond(null, selectedAnswers)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20, height: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-white rounded-[12px] p-4 shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[#3b82f6]">❓</span>
          <span className="text-[#1a1a1a] font-medium text-[16px]">AskUserQuestion</span>
        </div>
        <span className="text-[#737373] text-sm">问题 {currentQuestion + 1}/{totalQuestions}</span>
      </div>

      {/* Question */}
      <div className="mb-3">
        <div className="text-[#1a1a1a] text-[14px] mb-2">
          {currentQ.header}: {currentQ.question}
        </div>
        <div className="space-y-2">
          {currentQ.options.map((opt, idx) => {
            const isSelected = selectedAnswers[currentQuestion]?.includes(opt.label)
            return (
              <button
                key={idx}
                onClick={() => handleOptionSelect(opt.label)}
                className={`w-full text-left py-2 px-3 rounded-[8px] border text-[14px] ${
                  isSelected
                    ? 'bg-[#22c55e] border-[#22c55e] text-white'
                    : 'bg-[#f5f5f5] border-[#e5e5e5] text-[#1a1a1a]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{currentQ.multi_select ? (isSelected ? '☑' : '□') : (isSelected ? '●' : '○')}</span>
                  <span>{opt.label}</span>
                </div>
                {opt.description && (
                  <div className="text-xs mt-1 opacity-70">{opt.description}</div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={handlePrev}
          disabled={isFirstQuestion}
          className={`py-2 px-4 rounded-[8px] text-[14px] ${
            isFirstQuestion
              ? 'bg-[#f5f5f5] text-[#737373] cursor-not-allowed'
              : 'bg-[#1a1a1a] text-white'
          }`}
        >
          ◀ 上一题
        </button>

        {isLastQuestion ? (
          <button
            onClick={handleSubmit}
            className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] font-medium text-[14px]"
          >
            提交全部答案
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="py-2 px-4 bg-[#1a1a1a] text-white rounded-[8px] text-[14px]"
          >
            下一题 ▶
          </button>
        )}
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit PopupCard rewrite**

```bash
git add mobile-app/src/components/PopupCard.tsx
git commit -m "feat: Rewrite PopupCard with expandable cards and Ask multi-question navigation"
```

---

### Task 6: Update DeviceDetailPage with New Layout

**Files:**
- Modify: `mobile-app/src/components/DeviceDetailPage.tsx`

- [ ] **Step 1: Update DeviceDetailPage layout**

```tsx
// mobile-app/src/components/DeviceDetailPage.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCloudWebSocket } from '../hooks/useCloudWebSocket'
import { PopupState, SessionState } from '../types'
import { ChatView } from './ChatView'
import { PopupCard } from './PopupCard'

interface DeviceDetailPageProps {
  deviceToken: string
  deviceName: string
  onBack: () => void
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void
}

export function DeviceDetailPage({ deviceToken, deviceName, onBack, showToast }: DeviceDetailPageProps) {
  const { state, respondPopup, requestChatHistory } = useCloudWebSocket(deviceToken)
  const [chatSession, setChatSession] = useState<{ sessionId: string; projectName: string } | null>(null)
  const [dismissingPopups, setDismissingPopups] = useState<string[]>([])

  const pendingPopups = state.popups.filter(p => p.status === 'pending' && !dismissingPopups.includes(p.id))
  const activeSessions = state.sessions.filter(s => s.status !== 'ended')

  const handleViewChat = (sessionId: string, projectName: string) => {
    requestChatHistory(sessionId)
    setChatSession({ sessionId, projectName })
  }

  const handleRespond = (popupId: string, decision?: string | null, answers?: string[][]) => {
    // Start dismiss animation
    setDismissingPopups(prev => [...prev, popupId])
    
    // Show toast
    if (decision === 'allow') {
      showToast('已允许', 'success')
    } else if (decision === 'deny') {
      showToast('已拒绝', 'error')
    } else {
      showToast('已提交', 'success')
    }

    // Actually respond after animation starts
    setTimeout(() => {
      respondPopup(popupId, decision, answers)
      setDismissingPopups(prev => prev.filter(id => id !== popupId))
    }, 200)
  }

  // If viewing chat, show ChatView
  if (chatSession) {
    return (
      <ChatView
        projectName={chatSession.projectName}
        onClose={() => setChatSession(null)}
        messages={state.chatMessages[chatSession.sessionId] || []}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[#a3a3a3] text-lg">←</button>
          <span className="text-[#f5f5f5] text-lg font-medium">{deviceName}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${state.status === 'connected' ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
          <span className={`text-xs ${state.status === 'connected' ? 'text-[#22c55e]' : 'text-[#737373]'}`}>
            {state.status === 'connected' ? '在线' : '离线'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sessions Section */}
        <div className="px-4 py-3">
          <div className="text-[#a3a3a3] text-xs mb-2">会话列表</div>
          {activeSessions.length === 0 ? (
            <div className="text-[#737373] text-sm py-4">暂无活跃会话</div>
          ) : (
            <div className="space-y-2">
              {activeSessions.map(session => (
                <SessionCard
                  key={session.session_id}
                  session={session}
                  onViewChat={() => handleViewChat(session.session_id, session.project_name || '未知项目')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        {pendingPopups.length > 0 && (
          <div className="px-4 py-2 border-t border-[#262626]">
            <div className="text-[#a3a3a3] text-xs">
              待处理 ({pendingPopups.length})
            </div>
          </div>
        )}

        {/* Popups Section */}
        <div className="px-4 py-3 space-y-3">
          <AnimatePresence>
            {pendingPopups.map(popup => (
              <PopupCard
                key={popup.id}
                popup={popup}
                onRespond={handleRespond}
                onDismiss={() => {}}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session, onViewChat }: { session: SessionState; onViewChat: () => void }) {
  return (
    <div className="p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626]">
      <div className="text-[#f5f5f5] text-sm font-medium">{session.project_name || '未知项目'}</div>
      <div className="text-[#a3a3a3] text-xs mt-1">
        {session.current_tool ? `工具: ${session.current_tool}` : session.status}
      </div>
      <button
        onClick={onViewChat}
        className="mt-2 px-3 py-1 bg-[#262626] rounded-[8px] text-[#a3a3a3] text-xs hover:bg-[#1a1a1a]"
      >
        查看对话
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit DeviceDetailPage changes**

```bash
git add mobile-app/src/components/DeviceDetailPage.tsx
git commit -m "feat: Update DeviceDetailPage with dual-tone layout and popup animations"
```

---

### Task 7: Update AddDeviceModal Styling

**Files:**
- Modify: `mobile-app/src/components/AddDeviceModal.tsx`

- [ ] **Step 1: Update AddDeviceModal with light card styling**

```tsx
// mobile-app/src/components/AddDeviceModal.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react'

interface AddDeviceModalProps {
  onClose: () => void
  onAdd: (token: string) => void
}

export function AddDeviceModal({ onClose, onAdd }: AddDeviceModalProps) {
  const [token, setToken] = useState('')

  const handleSubmit = () => {
    if (token.trim()) {
      onAdd(token.trim())
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-[#0f0f0f]/80 flex items-center justify-center z-50">
      <div className="bg-white rounded-[12px] w-[90%] max-w-sm shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5]">
          <span className="text-[#1a1a1a] text-lg font-medium">添加设备</span>
          <button onClick={onClose} className="text-[#737373] text-lg">×</button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="text-[#737373] text-xs mb-1">设备 Token</div>
          <input
            type="text"
            placeholder="粘贴从桌面端复制的 Token"
            value={token}
            onChange={e => setToken(e.target.value)}
            className="w-full px-3 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-[8px] text-[#1a1a1a] text-sm outline-none focus:border-[#22c55e]"
          />
          
          <div className="text-[#737373] text-xs mt-3 mb-4">
            在桌面端设置中查看设备 Token，或扫描二维码自动填入
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-[#f5f5f5] rounded-[8px] text-[#737373] text-sm"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!token.trim()}
              className="flex-1 py-2 bg-[#22c55e] rounded-[8px] text-white text-sm font-medium disabled:bg-[#e5e5e5] disabled:text-[#737373]"
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit AddDeviceModal changes**

```bash
git add mobile-app/src/components/AddDeviceModal.tsx
git commit -m "style: Update AddDeviceModal with light card styling"
```

---

### Task 8: Update App.tsx with Toast and Settings Integration

**Files:**
- Modify: `mobile-app/src/App.tsx`

- [ ] **Step 1: Update App.tsx with Toast and SettingsPage**

```tsx
// mobile-app/src/App.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'
import { DeviceListPage } from './components/DeviceListPage'
import { DeviceDetailPage } from './components/DeviceDetailPage'
import { AddDeviceModal } from './components/AddDeviceModal'
import { SettingsPage } from './components/SettingsPage'
import { Toast } from './components/Toast'
import { useToast } from './hooks/useToast'

type View = 'devices' | 'detail' | 'settings'

interface DeviceWithName {
  token: string
  name: string
}

function App() {
  const [devices, setDevices] = useState<DeviceWithName[]>(() => {
    const saved = localStorage.getItem('cc-cloud-devices')
    if (saved) {
      const tokens: string[] = JSON.parse(saved)
      return tokens.map(t => ({ token: t, name: t.slice(0, 8) + '...' }))
    }
    return []
  })

  const [serverUrl, setServerUrl] = useState<string>(() => {
    return localStorage.getItem('cloud-server-url') || ''
  })

  const [serverConnected, setServerConnected] = useState(false)
  const [activeDevice, setActiveDevice] = useState<DeviceWithName | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [view, setView] = useState<View>('devices')
  
  const { toast, showSuccess, showError, showWarning } = useToast()

  // Save devices to localStorage
  useEffect(() => {
    localStorage.setItem('cc-cloud-devices', JSON.stringify(devices.map(d => d.token)))
  }, [devices])

  const handleAddDevice = (token: string) => {
    if (!devices.some(d => d.token === token)) {
      setDevices([...devices, { token, name: token.slice(0, 8) + '...' }])
      showSuccess('设备已添加')
    } else {
      showWarning('设备已存在')
    }
  }

  const handleDeleteDevice = (token: string) => {
    setDevices(devices.filter(d => d.token !== token))
    showSuccess('设备已删除')
  }

  const handleSaveServer = (url: string) => {
    localStorage.setItem('cloud-server-url', url)
    setServerUrl(url)
    // Try to connect - connection status will be updated by WebSocket
    showSuccess('设置已保存')
  }

  const handleToggleAutoAllow = (token: string, enabled: boolean) => {
    // This will be sent to the cloud server via WebSocket
    console.log('Toggle auto-allow:', token, enabled)
  }

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    if (type === 'success') showSuccess(message)
    else if (type === 'error') showError(message)
    else showWarning(message)
  }

  // Render based on view
  if (view === 'settings') {
    return (
      <div className="h-screen">
        <SettingsPage
          serverUrl={serverUrl}
          serverConnected={serverConnected}
          devices={devices.map(d => d.token)}
          onSaveServer={handleSaveServer}
          onDeleteDevice={handleDeleteDevice}
          onToggleAutoAllow={handleToggleAutoAllow}
          onBack={() => setView('devices')}
        />
        <Toast {...toast} />
      </div>
    )
  }

  if (view === 'detail' && activeDevice) {
    return (
      <div className="h-screen">
        <DeviceDetailPage
          deviceToken={activeDevice.token}
          deviceName={activeDevice.name}
          onBack={() => setView('devices')}
          showToast={showToast}
        />
        <Toast {...toast} />
      </div>
    )
  }

  return (
    <div className="h-screen">
      <DeviceListPage
        devices={devices.map(d => d.token)}
        onSelectDevice={(token) => {
          const device = devices.find(d => d.token === token)
          if (device) {
            setActiveDevice(device)
            setView('detail')
          }
        }}
        onAddDevice={() => setShowAddModal(true)}
        onOpenSettings={() => setView('settings')}
        serverConnected={serverConnected}
      />
      
      {showAddModal && (
        <AddDeviceModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddDevice}
        />
      )}
      
      <Toast {...toast} />
    </div>
  )
}

export default App
```

- [ ] **Step 2: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit App.tsx changes**

```bash
git add mobile-app/src/App.tsx
git commit -m "feat: Update App.tsx with Toast, SettingsPage, and view routing"
```

---

### Task 9: Update ChatView Styling

**Files:**
- Modify: `mobile-app/src/components/ChatView.tsx`

- [ ] **Step 1: Update ChatView with new colors**

```tsx
// mobile-app/src/components/ChatView.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react'
import { ChatMessageData } from '../types'

interface ChatViewProps {
  projectName: string
  onClose: () => void
  messages: ChatMessageData[]
}

export function ChatView({ projectName, onClose, messages }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp)

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[#262626]">
        <button onClick={onClose} className="text-[#a3a3a3] mr-3 text-lg">←</button>
        <span className="text-[#f5f5f5] text-lg font-medium truncate flex-1">{projectName}</span>
        <span className="text-[#737373] text-xs">{sortedMessages.length} 条消息</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {sortedMessages.length === 0 ? (
          <div className="text-[#737373] text-sm text-center py-8">暂无聊天记录</div>
        ) : (
          sortedMessages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessageData }) {
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  switch (message.messageType) {
    case 'user':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#3b82f6] text-xs font-medium">你</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#f5f5f5] text-sm">{message.content}</div>
        </div>
      )

    case 'assistant':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#22c55e] text-xs font-medium">Claude</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#f5f5f5] text-sm">{message.content}</div>
        </div>
      )

    case 'toolCall':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#f59e0b] text-xs font-medium">工具: {message.toolName || '未知'}</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#a3a3a3] text-xs bg-[#1a1a1a] rounded-[8px] px-2 py-1 truncate">
            {message.content.slice(0, 200)}{message.content.length > 200 && '...'}
          </div>
        </div>
      )

    case 'toolResult':
      return (
        <div className="mb-3 pl-4 border-l-2 border-[#262626]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#a855f7] text-xs font-medium">结果</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#a3a3a3] text-xs truncate">
            {message.content.slice(0, 500)}{message.content.length > 500 && '...'}
          </div>
        </div>
      )

    case 'thinking':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#06b6d4] text-xs font-medium">思考中</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#737373] text-xs italic">
            {message.content.slice(0, 100)}{message.content.length > 100 && '...'}
          </div>
        </div>
      )

    default:
      return null
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit ChatView changes**

```bash
git add mobile-app/src/components/ChatView.tsx
git commit -m "style: Update ChatView with dual-tone colors"
```

---

### Task 10: Final Build and Sync Capacitor

**Files:**
- All modified files

- [ ] **Step 1: Run final build**

Run: `cd /home/akke/project/cc-island/mobile-app && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Sync Capacitor**

Run: `cd /home/akke/project/cc-island/mobile-app && npx cap sync android`
Expected: Assets synced to Android project

- [ ] **Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: Complete mobile UI redesign - notification center style

- Dual-tone colors: dark background + light popup cards
- Expandable popup cards with animation
- Ask multi-question navigation (prev/next)
- Settings page with auto-allow toggle
- Toast notifications
- Device cards with pending badges
"
```

---

## Verification Checklist

After implementation, verify:

1. **Visual check:**
   - Device cards have dark background (`#1a1a1a`)
   - Popup cards have white background (`#ffffff`)
   - Online status shows green dot
   - Pending count badge shows in red

2. **Popup interaction:**
   - Click "展开" expands card
   - Click "收起" collapses card
   - Click "允许" shows green Toast and card disappears
   - Click "拒绝" shows red Toast and card disappears

3. **Ask navigation:**
   - First question: only "下一题" button
   - Middle questions: both "上一题" and "下一题"
   - Last question: "上一题" + "提交全部答案"

4. **Settings:**
   - Auto-allow toggle works per device
   - Delete device removes from list

5. **Build:**
   - `npm run build` succeeds
   - APK installs on device