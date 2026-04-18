// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

// Connection status type
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Device info for display
export interface DeviceInfo {
  token: string
  hostname?: string
  registered_at?: string  // ISO datetime string
  online: boolean
}

// Hook types (PascalCase matching Claude Code)
export type HookType =
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'Notification'
  | 'Stop'
  | 'UserPromptSubmit'
  | 'StatusUpdate'

// Claude session state (matches Cloud Server ClaudeSession with camelCase)
export interface ClaudeSession {
  sessionId: string      // camelCase from server
  projectName: string    // camelCase from server
  status: string         // 'idle' | 'thinking' | 'working' | 'waiting' | 'waitingForApproval' | 'error' | 'ended' | 'compacting'
  currentTool?: string   // camelCase from server
  createdAt?: number     // camelCase from server, milliseconds
}

// Hook hint for display on device list
export interface HookHint {
  session_id: string
  hook_type: HookType
  urgent: boolean  // True for PermissionRequest/Ask
  tool_name?: string
  action?: string
  questions?: AskQuestion[]
  timestamp: number
}

// Ask question types
export interface AskQuestion {
  header: string
  question: string
  multi_select: boolean
  options: AskOption[]
}

export interface AskOption {
  label: string
  description?: string
}

// Permission data
export interface PermissionData {
  tool_name: string
  action?: string
  details?: string
}

// Notification data
export interface NotificationData {
  message: string
  type?: string  // 'ask' for blocking questions
  questions?: AskQuestion[]
}

// Hook body (raw hook data)
export interface HookBody {
  hook_event_name: string
  session_id: string
  cwd?: string
  project_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: Record<string, unknown>
  permission_data?: PermissionData
  notification_data?: NotificationData
  questions?: AskQuestion[]
}

// Cloud message types
export interface CloudMessage {
  type: string

  // Connection
  device_id?: string
  hostname?: string
  reason?: string

  // Device info
  device?: DeviceInfo
  devices?: DeviceInfo[]
  device_token?: string

  // Session info
  sessions?: ClaudeSession[]

  // Hook message
  session_id?: string
  hook_type?: HookType
  hook_body?: HookBody

  // Chat history
  messages?: ChatMessageData[]

  // Hook response
  decision?: string
  answers?: string[][]
}

// Chat message data
export interface ChatMessageData {
  id: string
  sessionId: string
  messageType: 'user' | 'assistant' | 'toolCall' | 'toolResult' | 'thinking' | 'interrupted'
  content: string
  toolName?: string
  timestamp: number  // milliseconds
}

// Legacy types for backward compatibility with existing components
export interface PopupState {
  id: string
  session_id?: string
  project_name?: string
  type: string
  data: PermissionData | AskData | NotificationData | Record<string, unknown>
  ask_data?: AskData
  permission_data?: PermissionData
  status: string
  created_at?: number
}

export interface SessionState {
  session_id: string
  project_name?: string
  status: string
  current_tool?: string
}

export interface AskData {
  questions: AskQuestion[]
}

export interface PermissionData {
  tool_name: string
  action?: string
  details?: string
}

export interface NotificationData {
  message: string
  type?: string
  questions?: AskQuestion[]
}