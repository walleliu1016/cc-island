// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { ClaudeInstance } from '../types';
import { formatTimeAgo, formatRunningDuration } from './timeFormat';

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
 * Format terminal type to display name
 */
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