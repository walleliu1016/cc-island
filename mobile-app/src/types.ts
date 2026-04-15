// WebSocket message types
export interface WsMessage {
  type: string
  // State update
  instances?: ClaudeInstance[]
  popups?: PopupItem[]
  // New popup
  popup?: PopupItem
  // Session notification
  notification?: SessionNotification
  // Respond popup
  popup_id?: string
  decision?: string
  answers?: string[][]
}

// Claude instance display
export interface ClaudeInstance {
  session_id: string
  project_name: string
  status: InstanceStatus
  current_tool?: string
  tool_input?: ToolInput
  created_at: number
  last_activity?: number
}

export interface InstanceStatus {
  type: 'idle' | 'thinking' | 'working' | 'waiting' | 'waitingForApproval' | 'error' | 'ended' | 'compacting'
  tool?: string
}

export interface ToolInput {
  tool_name: string
  action?: string
  details?: string
  command?: string
  file_path?: string
}

// Popup item
export interface PopupItem {
  id: string
  session_id: string
  project_name: string
  type: 'permission' | 'ask' | 'notification'
  permission_data?: PermissionData
  ask_data?: AskData
  notification_data?: NotificationData
  status: 'pending' | 'processing' | 'resolved' | 'autoClose'
  created_at: number
}

export interface PermissionData {
  tool_name: string
  action: string
  details?: string
}

export interface AskData {
  questions: AskQuestion[]
}

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

export interface NotificationData {
  message: string
  options?: string[]
}

// Session notification
export interface SessionNotification {
  project_name: string
  notification_type: 'started' | 'ended'
  timestamp: number
}