// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';
import { useState } from 'react';
import { ClaudeInstance, PopupItem, InstanceStatus } from '../types';
import { StatusIcon, TerminalColors } from './StatusIcons';
import { useDisplayStore } from '../stores/displayStore';

interface InstanceListProps {
  instances: ClaudeInstance[];
  popups?: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk?: (sessionId: string) => void;
}

export function InstanceList({ instances, popups = [], onJump, onViewChat, onRespond, onViewAsk }: InstanceListProps) {
  // Sort instances by priority: Approval > Processing > WaitingForInput > Idle
  const sortedInstances = [...instances].sort((a, b) => {
    const priorityA = getPhasePriority(a.status, popups.find(p => p.session_id === a.session_id && p.status === 'pending'));
    const priorityB = getPhasePriority(b.status, popups.find(p => p.session_id === b.session_id && p.status === 'pending'));
    return priorityA - priorityB;
  });

  if (sortedInstances.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {sortedInstances.map((instance) => (
        <InstanceRow
          key={instance.session_id}
          instance={instance}
          pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
          onJump={onJump}
          onViewChat={onViewChat}
          onRespond={onRespond}
          onViewAsk={onViewAsk}
        />
      ))}
    </div>
  );
}

// Phase priority: lower = higher priority
function getPhasePriority(status: InstanceStatus, pendingPopup?: PopupItem): number {
  if (pendingPopup) return 0; // Approval has highest priority
  if (status.type === 'working' || status.type === 'thinking' || status.type === 'waiting') return 1;
  if (status.type === 'compacting') return 1;
  if (status.type === 'idle') return 2;
  return 3; // error, ended
}

interface InstanceRowProps {
  instance: ClaudeInstance;
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk?: (sessionId: string) => void;
}

function InstanceRow({ instance, pendingPopup, onJump, onViewChat, onRespond, onViewAsk }: InstanceRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isWaitingForApproval = pendingPopup !== undefined;
  const popupToolName = pendingPopup?.permission_data?.tool_name;
  const toolInput = pendingPopup?.permission_data?.action || getToolInputString(instance.tool_input) || '';

  // Use display store for per-instance display state (with 1s minimum display time)
  const { getInstanceDisplay } = useDisplayStore();
  const display = getInstanceDisplay(instance.session_id);

  // Override with popup info if waiting for approval
  const phase = isWaitingForApproval ? 'waitingForApproval' : display.phase;
  const text = isWaitingForApproval
    ? (popupToolName ? formatToolName(popupToolName) : 'Permission')
    : display.text;

  // Get status text and color based on phase
  const getStatusInfo = (): { text: string; color: string } | null => {
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
  };

  const statusInfo = getStatusInfo();

  // Get display title (project name or custom name)
  const displayTitle = instance.custom_name || instance.project_name || 'Untitled';

  // Handle row click - view chat
  const handleRowClick = () => {
    onViewChat?.(instance.session_id);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={handleRowClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
      style={{ backgroundColor: isHovered ? 'rgba(255,255,255,0.06)' : 'transparent' }}
    >
      {/* Status indicator on left */}
      <div className="w-4 flex items-center justify-center flex-shrink-0">
        <StatusIcon phase={phase} size={12} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Main title */}
        <span className="text-white text-sm font-medium truncate">
          {displayTitle}
        </span>

        {/* Secondary info - status text */}
        <div className="flex items-center gap-1.5 text-xs">
          {statusInfo && (
            <span
              className="font-medium"
              style={{ color: statusInfo.color }}
            >
              {statusInfo.text}
            </span>
          )}
          {/* Tool input as secondary detail */}
          {toolInput && pendingPopup?.type !== 'ask' && (
            <span className="text-white/40 truncate">
              {truncateText(toolInput, 30)}
            </span>
          )}
          {pendingPopup?.type === 'ask' && (
            <span
              className="font-medium"
              style={{ color: TerminalColors.amber }}
            >
              有问题待回答
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isWaitingForApproval && pendingPopup ? (
          pendingPopup.type === 'ask' ? (
            // Ask question button - go to answer
            <AskAnswerButton
              onClick={() => onViewAsk?.(instance.session_id)}
            />
          ) : (
            // Inline approval buttons for permission
            <InlineApprovalButtons
              onAllow={() => onRespond?.(pendingPopup.id, 'allow')}
              onDeny={() => onRespond?.(pendingPopup.id, 'deny')}
            />
          )
        ) : (
          // Regular action buttons
          <ActionButtons
            instance={instance}
            onJump={onJump}
            onViewChat={onViewChat}
          />
        )}
      </div>
    </motion.div>
  );
}

// Format tool name for display
function formatToolName(name: string): string {
  // Handle common tool names
  const toolNames: Record<string, string> = {
    'Bash': 'Bash',
    'Read': 'Read',
    'Write': 'Write',
    'Edit': 'Edit',
    'AskUserQuestion': 'Ask',
    'WebFetch': 'Web',
    'WebSearch': 'Search',
  };
  return toolNames[name] || name;
}

// Get tool input as string
function getToolInputString(toolInput: unknown): string {
  if (!toolInput) return '';
  if (typeof toolInput === 'string') return toolInput;
  if (typeof toolInput === 'object') {
    // Try to get action or details from ToolInput object
    const obj = toolInput as { action?: string; details?: string; command?: string; file_path?: string };
    return obj.action || obj.details || obj.command || obj.file_path || '';
  }
  return String(toolInput);
}

// Truncate text
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Ask answer button - for AskUserQuestion popups
function AskAnswerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="px-3 py-1.5 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-all flex items-center gap-1.5"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
        <path d="M5.5 4.5a.5.5 0 0 1 1 0v2a.5.5 0 0 1-1 0v-2zM5.5 7a.5.5 0 0 1 1 0v.5a.5.5 0 0 1-1 0V7z"/>
      </svg>
      去回答
    </button>
  );
}

// Inline approval buttons with hover effects
function InlineApprovalButtons({ onAllow, onDeny }: { onAllow: () => void; onDeny: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Deny button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDeny();
        }}
        className="px-3 py-1.5 text-xs font-medium text-white/80 bg-white/[0.08] hover:bg-red-500/80 hover:text-white rounded-lg transition-all"
      >
        Deny
      </button>
      {/* Allow button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAllow();
        }}
        className="px-3 py-1.5 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-all"
      >
        Allow
      </button>
    </div>
  );
}

// Action buttons for regular instances
function ActionButtons({
  instance,
  onJump,
  onViewChat,
}: {
  instance: ClaudeInstance;
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {/* Chat button */}
      {instance.status.type !== 'ended' && onViewChat && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewChat(instance.session_id);
          }}
          className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded-lg transition-colors"
          title="View chat"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M3 3h8v6H5l-2 2V3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Focus/Jump button */}
      {instance.status.type !== 'ended' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onJump(instance.session_id);
          }}
          className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded-lg transition-colors"
          title="Jump to terminal"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor"/>
          </svg>
        </button>
      )}

      {/* Archive button for idle sessions */}
      {(instance.status.type === 'idle' || instance.status.type === 'ended') && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Archive functionality would go here
          }}
          className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded-lg transition-colors"
          title="Archive session"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M2 3h10v2H2V3zm0 3h10v6H2V6zm2 2v2h6V8H4z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>
      )}
    </div>
  );
}
