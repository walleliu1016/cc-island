# Mobile App UI Redesign - Notification Center Style

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign mobile app UI as a lightweight notification center for CC-Island device monitoring and popup approval.

**Style:** Minimal notification style, dual-tone mode (dark background + light popup cards), expandable card interaction.

---

## Design Decisions Summary

| Aspect | Choice | Reason |
|--------|--------|--------|
| Overall Style | Minimal notification | Fast response, frequent popup scenario |
| Popup Display | Expandable cards | Balance speed vs. information clarity |
| Device List | Card preview with badges | Show status + pending count at glance |
| Color Scheme | Dual-tone (dark + light cards) | Focus attention on actionable items |

---

## Part 1: Page Structure

### Home Page - Device List

```
┌─────────────────────────────────────┐
│  首页：设备列表                       │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ ● 云服务器已连接         ⚙ +  ││ ← Status bar + Settings + Add (top right)
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ 🖥 desktop-001        ● 在线   ││ ← Device card
│  │              [🔴 2]  最后: 2分钟││ ← Pending badge + time
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ 🖥 desktop-002        ○ 离线   ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ 🖥 desktop-003        ● 在线   ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**Note:** Settings (⚙) and Add (+) buttons are in the header, not at bottom.

### Detail Page - Device Status

```
┌─────────────────────────────────────┐
│  详情页：设备状态                     │
├─────────────────────────────────────┤
│  ← desktop-001              ● 在线  │← Header
├─────────────────────────────────────┤
│  会话列表                            │
│  ┌─────────────────────────────────┐│
│  │ cc-island    Bash: npm test    ││← Session card (minimal)
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ my-project   [思考中...]       ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  待处理 (2)                          │← Divider
│                                     │
│  ┌─浅色卡片─────────────────────────┐│
│  │ ⚠ Bash              [展开]     ││← Popup card (collapsed)
│  │    npm run build                 ││
│  │   [拒绝]        [允许]           ││
│  └─────────────────────────────────┘│
│  ┌─浅色卡片─────────────────────────┐│
│  │ ⚠ Read                         ││
│  │   src/config.ts                 ││
│  │   [拒绝]        [允许]           ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### Popup Card Expanded

```
┌─浅色卡片（展开）──────────────────────┐
│ ⚠ Bash                    [收起]     │
│                                      │
│ 操作: npm run build                  │
│ 详情: 执行项目构建命令                 │
│ 超时: 120秒                           │
│                                      │
│   [拒绝]            [允许]            │
└──────────────────────────────────────┘
```

---

## Part 2: Color & Style

### Dual-Tone Color Palette

| Element | Color | Usage |
|---------|-------|-------|
| **Background (dark)** | `#0f0f0f` | Main background, near-black |
| **Card background (dark)** | `#1a1a1a` | Device cards, session cards |
| **Popup card (light)** | `#ffffff` | Pure white, standout |
| **Popup card text** | `#1a1a1a` | Dark text, high contrast |
| **Online status** | `#22c55e` | Green dot |
| **Offline status** | `#737373` | Gray dot |
| **Warning/popup marker** | `#f59e0b` | Orange `⚠` |
| **Button-Allow** | `#22c55e` | Green fill |
| **Button-Deny** | `#ef4444` | Red fill |
| **Badge background** | `#ef4444` | Red, pending count |

### Rounded Corners & Spacing

| Element | Radius | Padding |
|---------|--------|---------|
| Device card | `12px` | `16px` |
| Session card | `8px` | `12px` |
| Popup card | `12px` | `16px` |
| Buttons | `8px` | Full width |

### Typography

| Element | Size | Weight |
|---------|------|--------|
| Device name | `16px` | Medium (500) |
| Status text | `14px` | Regular (400) |
| Popup tool name | `16px` | Medium (500) |
| Popup detail text | `14px` | Regular (400) |
| Button text | `14px` | Medium (500) |

---

## Part 3: Popup Card Interaction

### Permission Popup (Collapsed)

```
┌────────────────────────────────────┐
│ ⚠ Bash                    [展开] │
│    npm run build                   │
│                                    │
│    [拒绝]            [允许]        │
└────────────────────────────────────┘
```

### Permission Popup (Expanded)

```
┌────────────────────────────────────┐
│ ⚠ Bash                    [收起] │
│                                    │
│ 工具名称: Bash                     │
│ 操作内容: npm run build            │
│ 详细信息: 执行项目构建命令...       │
│ 超时时间: 120秒                    │
│                                    │
│    [拒绝]            [允许]        │
└────────────────────────────────────┘
```

### Interaction Rules

| Action | Effect |
|--------|--------|
| Click "展开" | Card expands, shows full info |
| Click "收起" | Card collapses to minimal height |
| Click "允许" | Card disappears, Toast "已允许" |
| Click "拒绝" | Card disappears, Toast "已拒绝" |
| Card disappear animation | Slide up + fade out, 200ms |

---

## Part 4: Ask Popup (Multi-Question Navigation)

### Question 1 (First)

```
┌────────────────────────────────────┐
│ ❓ AskUserQuestion     问题 1/3   │
│                                    │
│ 问题: 选择前端框架？               │
│                                    │
│  ○ React (推荐)                   │
│    最流行，生态丰富                │
│  ○ Vue                            │
│    轻量，易上手                    │
│  ○ Angular                        │
│    企业级方案                      │
│                                    │
│         [下一题 ▶]                 │ ← Only "Next" button
└────────────────────────────────────┘
```

### Question 2 (Middle)

```
┌────────────────────────────────────┐
│ ❓ AskUserQuestion     问题 2/3   │
│                                    │
│ 问题: 是否使用 TypeScript？        │
│                                    │
│  ○ 是                             │
│  ○ 否                             │
│                                    │
│  ◀ 上一题         下一题 ▶        │
└────────────────────────────────────┘
```

### Question 3 (Last)

```
┌────────────────────────────────────┐
│ ❓ AskUserQuestion     问题 3/3   │
│                                    │
│ 问题: 选择样式方案？               │
│                                    │
│  ☑ Tailwind CSS                   │ ← Multi-select example
│  ☑ CSS Modules                    │
│  □ Styled Components              │
│                                    │
│  ◀ 上一题                          │
│         [提交全部答案]              │
└────────────────────────────────────┘
```

### Navigation Rules

| Button State | Condition |
|--------------|-----------|
| "上一题" disabled | Gray, not clickable on first question |
| "下一题" | Requires selection before proceeding (or prompt "请先选择") |
| "提交" | Only shown on last question |
| Multi-select | Can proceed without selection if allowed |

---

## Part 5: Auxiliary Screens

### Add Device Modal

Triggered by clicking + button in header.

```
┌────────────────────────────────────┐
│         添加设备                    │
├────────────────────────────────────┤
│                                    │
│  设备 Token                        │
│  ┌────────────────────────────────┐│
│  │ abc123def456...               ││ ← Input field
│  └────────────────────────────────┘│
│                                    │
│  提示：在桌面端设置中查看设备 Token │
│       或扫描二维码自动填入          │
│                                    │
│  [取消]           [添加]           │
└────────────────────────────────────┘
```

**Add Device Flow:**
- Click + in header → Modal opens
- Enter device token → Click "添加"
- Device appears in list immediately

### Settings Page

```
┌────────────────────────────────────┐
│ ← 设置                             │
├────────────────────────────────────┤
│                                    │
│  云服务器地址                       │
│  ┌────────────────────────────────┐│
│  │ wss://cloud.example.com:17528 ││
│  └────────────────────────────────┘│
│                                    │
│  连接状态: ● 已连接                │
│                                    │
│        [保存并重新连接]             │
│                                    │
├────────────────────────────────────┤
│  权限设置                           │
│                                    │
│  ☐ 自动允许所有权限                │ ← Toggle
│    开启后所有弹窗自动批准           │
│                                    │
├────────────────────────────────────┤
│  已添加设备 (2)                     │
│                                    │
│  desktop-001    [删除]            │
│  desktop-002    [删除]            │
└────────────────────────────────────┘
```

**Settings Features:**
- Cloud server URL configuration
- Auto-allow all permissions toggle (device-specific)
- Connected devices list with delete option

### Toast Notifications

| Toast | Color | Duration |
|-------|-------|----------|
| ✓ 已允许 | Green `#22c55e` | Auto-dismiss 2s |
| ✗ 已拒绝 | Red `#ef4444` | Auto-dismiss 2s |
| ⚠ 连接失败 | Orange `#f59e0b` | Auto-dismiss 3s |

---

## Implementation Files

| File | Purpose |
|------|---------|
| `mobile-app/src/App.tsx` | Main routing structure |
| `mobile-app/src/components/DeviceListPage.tsx` | Device cards with badges |
| `mobile-app/src/components/DeviceDetailPage.tsx` | Sessions + popups layout |
| `mobile-app/src/components/PopupCard.tsx` | Expandable popup card with Ask navigation |
| `mobile-app/src/components/AddDeviceModal.tsx` | Token input modal |
| `mobile-app/src/components/SettingsPage.tsx` | Server URL + device management |
| `mobile-app/src/components/Toast.tsx` | Toast notification component |
| `mobile-app/src/index.css` | Tailwind + custom colors |