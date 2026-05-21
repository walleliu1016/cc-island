// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClaudeInstance, PopupItem, InstanceStatus } from '../types';
import { calculateDisplayName, calculateTooltip } from '../utils/displayName';
import { formatTimeAgo, formatRunningDuration } from '../utils/timeFormat';
import { getStatusColor, hexToRgba } from '../utils/statusColors';

// ActivityPopup imported for expand button functionality
import { ActivityPopup } from './ActivityPopup';
/**
 * SessionCard - Two-row layout for instance display
 * Row 1 (fixed): Project name + session number, status indicator, running duration, start time
 * Row 2 (dynamic): Current command, separator, history tags, expand button, action buttons
 */

interface SessionCardProps {
  instance: ClaudeInstance;
  allInstances: ClaudeInstance[];
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
  onViewChat: (sessionId: string) => void;
  isDesktopMode?: boolean;
}

// Status text mapping (Chinese)
function getStatusText(status: InstanceStatus): string {
  switch (status.type) {
    case 'working':
      return status.data || 'Working';
    case 'thinking':
      return 'Thinking';
    case 'waiting':
      return 'Waiting';
    case 'waitingforapproval':
      return 'Needs Approval';
    case 'compacting':
      return 'Compacting';
    case 'error':
      return 'Error';
    case 'ended':
      return 'Ended';
    case 'idle':
      return 'Idle';
    default:
      return 'Idle';
  }
}

// Truncate content helper
function truncateContent(content: string, maxLen: number): string {
  if (!content) return '';
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen - 1) + '...';
}

// Get tool input as string
function getToolInputString(toolInput: unknown): string {
  if (!toolInput) return '';
  if (typeof toolInput === 'string') return toolInput;
  if (typeof toolInput === 'object') {
    const obj = toolInput as { action?: string; details?: string; command?: string; file_path?: string };
    return obj.action || obj.details || obj.command || obj.file_path || '';
  }
  return String(toolInput);
}

// Format tool name for display
function formatToolName(name: string): string {
  const toolNames: Record<string, string> = {
    'Bash': 'Bash',
    'Read': 'Read',
    'Write': 'Write',
    'Edit': 'Edit',
    'AskUserQuestion': 'Ask',
    'WebFetch': 'Web',
    'WebSearch': 'Search',
    'TaskCreate': 'Task',
    'Skill': 'Skill',
    'CronCreate': 'Cron',
  };
  return toolNames[name] || name;
}

export function SessionCard({
  instance,
  allInstances,
  pendingPopup,
  onJump,
  onViewChat,
  isDesktopMode = false,
}: SessionCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showActivityPopup, setShowActivityPopup] = useState(false);

  // Get status color config
  const statusColor = getStatusColor(instance.status);
  const isEnded = instance.status.type === 'ended';
  const isWaitingForApproval = pendingPopup !== undefined;

  // Calculate display name
  const displayName = calculateDisplayName(instance, allInstances);
  const tooltip = calculateTooltip(instance);

  // Current command display
  const currentToolName = instance.current_tool ||
    (instance.status.type === 'working' || instance.status.type === 'waitingforapproval'
      ? (instance.status as { type: 'working' | 'waitingforapproval'; data: string }).data
      : null);
  const toolInput = getToolInputString(instance.tool_input);
  const currentCommand = isWaitingForApproval
    ? (pendingPopup?.permission_data?.tool_name || 'Permission')
    : currentToolName;

  // Mock history data for now - will be replaced with real data
  const mockHistory: string[] = ['Read', 'Edit', 'Bash', 'Write'];
  const displayHistory = mockHistory.slice(0, 3);
  const hasMoreHistory = mockHistory.length > 3;
  const extraCount = mockHistory.length - 3;

  // Running duration
  const runningDuration = formatRunningDuration(instance.started_at);
  const startTimeAgo = formatTimeAgo(instance.started_at);

  // Button style based on mode
  const buttonStyle = isDesktopMode ? 'normal' : 'compact';

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={tooltip}
      className="relative rounded-xl overflow-hidden transition-all"
      style={{
        backgroundColor: isHovered ? statusColor.bgHighlight : statusColor.bg,
        borderLeft: `3px solid ${statusColor.border}`,
      }}
    >
      {/* Row 1: Fixed layout */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Project name + session number */}
        <div className="flex-1 min-w-0">
          <span className="text-white text-sm font-medium truncate">
            {displayName}
          </span>
        </div>

        {/* Status indicator */}
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
          style={{
            backgroundColor: hexToRgba(statusColor.border, 0.2),
            color: statusColor.text,
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor.border }} />
          <span>{getStatusText(instance.status)}</span>
        </div>

        {/* Running duration */}
        {!isEnded && (
          <span className="text-white/50 text-xs">
            {runningDuration}
          </span>
        )}

        {/* Start time */}
        <span className="text-white/40 text-xs">
          {startTimeAgo}
        </span>
      </div>

      {/* Row 2: Dynamic layout */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        {/* Current command (if running) */}
        {currentCommand && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded"
            style={{
              backgroundColor: hexToRgba(statusColor.border, 0.15),
            }}
          >
            <span style={{ color: statusColor.border }}>⚡</span>
            <span className="text-white/80 truncate max-w-[120px]">
              {formatToolName(currentCommand)}
              {toolInput && `: ${truncateContent(toolInput, 20)}`}
            </span>
          </div>
        )}

        {/* Separator if both exist */}
        {currentCommand && displayHistory.length > 0 && (
          <span className="text-white/30">|</span>
        )}

        {/* History tags */}
        {displayHistory.length > 0 && (
          <div className="flex items-center gap-1">
            {displayHistory.map((toolName, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 rounded text-white/60"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
              >
                {formatToolName(toolName)}
              </span>
            ))}
          </div>
        )}

        {/* Expand button (+N) */}
        {hasMoreHistory && (
          <button
            onClick={() => setShowActivityPopup(!showActivityPopup)}
            className="px-1.5 py-0.5 rounded text-white/50 hover:text-white/70 hover:bg-white/[0.08] transition-colors flex items-center gap-0.5"
          >
            <span>+{extraCount}</span>
            <span className="text-[10px]">▾</span>
          </button>
        )}

        {/* Flexible space */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {/* View chat button */}
          {buttonStyle === 'compact' ? (
            <button
              onClick={() => onViewChat(instance.session_id)}
              className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded transition-colors"
              title="View chat"
            >
💬
            </button>
          ) : (
            <button
              onClick={() => onViewChat(instance.session_id)}
              className="flex items-center gap-1 px-2 py-1 text-white/60 hover:text-white/80 hover:bg-white/[0.08] rounded transition-colors"
              title="View chat"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 2h8v6H4l-2 2V2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
              <span>Chat</span>
            </button>
          )}

          {/* Jump terminal button (only if not ended) */}
          {!isEnded && (
            buttonStyle === 'compact' ? (
              <button
                onClick={() => onJump(instance.session_id)}
                className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded transition-colors"
                title="Jump to terminal"
              >
⌨️
              </button>
            ) : (
              <button
                onClick={() => onJump(instance.session_id)}
                className="p-1.5 text-white/60 hover:text-white/80 hover:bg-white/[0.08] rounded transition-colors"
                title="Jump to terminal"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="1" y="2" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M3 4l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )
          )}
        </div>
      </div>

      {/* Activity Popup */}
      <AnimatePresence>
        {showActivityPopup && (
          <ActivityPopup
            activities={instance.activities || []}
            onClose={() => setShowActivityPopup(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}