// Types matching Rust backend

export type InstanceStatus = 'idle' | 'working' | 'waiting' | 'error' | 'compacting' | 'ended';

export type TerminalType =
  | 'macos_terminal' | 'macos_iterm2' | 'macos_alacritty' | 'macos_vscode' | 'macos_ghostty'
  | 'windows_terminal' | 'windows_cmd' | 'windows_powershell' | 'windows_git_bash'
  | 'linux_gnome' | 'linux_konsole' | 'linux_alacritty'
  | 'unknown';

export interface ProcessInfo {
  pid: number;
  ppid: number;
  terminal_pid: number;
  terminal_type: TerminalType;
  working_directory: string;
}

export interface ToolInput {
  tool_name: string;
  action?: string;
  details?: string;
}

export interface ClaudeInstance {
  session_id: string;
  project_name: string;
  custom_name?: string;
  process_info?: ProcessInfo;
  status: InstanceStatus;
  current_tool?: string;
  tool_input?: ToolInput;
  started_at: number;
  last_activity_at: number;
}

export type PopupType = 'permission' | 'ask' | 'notification';
export type PopupStatus = 'pending' | 'processing' | 'resolved' | 'auto_close';

export interface PermissionData {
  tool_name: string;
  action: string;
  details?: string;
}

// Ask question types (matching Rust backend)
export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  header: string;
  question: string;
  multi_select: boolean;
  options: AskOption[];
}

export interface AskData {
  questions: AskQuestion[];
}

export interface NotificationData {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface PopupItem {
  id: string;
  session_id: string;
  project_name: string;
  type: PopupType;
  permission_data?: PermissionData;
  ask_data?: AskData;
  notification_data?: NotificationData;
  status: PopupStatus;
  created_at: number;
  auto_close_at?: number;
  timeout_at?: number;
}

// Hook configuration types
export interface HookStatus {
  name: string;
  configured: boolean;
  required: boolean;
  timeout: number;
}

export interface HooksCheckResult {
  config_exists: boolean;
  hooks: HookStatus[];
  missing_required: string[];
  missing_optional: string[];
}

export interface AppSettings {
  permission_timeout: number;
  ask_timeout: number;
  auto_deny_on_timeout: boolean;
  auto_allow_permissions: boolean;
  show_notifications: boolean;
  poll_interval: number;
  enable_logging: boolean;
  hook_forward_url: string | null;
  // Instance and queue limits
  max_instances: number;
  max_popup_queue: number;
  // Timeout warning thresholds
  warning_time: number;
  critical_time: number;
  notification_auto_close: number;
}

// Tool activity for display
export interface ToolActivity {
  session_id: string;
  project_name: string;
  tool_name: string;
  timestamp: number;
}