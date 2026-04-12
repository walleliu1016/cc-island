import { motion } from 'framer-motion';
import { useState } from 'react';
import { ClaudeInstance, PopupItem } from '../types';
import { StatusIcon, TerminalColors } from './StatusIcons';

interface InstanceListProps {
  instances: ClaudeInstance[];
  popups?: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
}

export function InstanceList({ instances, popups = [], onJump, onViewChat, onRespond }: InstanceListProps) {
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
        />
      ))}
    </div>
  );
}

// Phase priority: lower = higher priority
function getPhasePriority(status: string, pendingPopup?: PopupItem): number {
  if (pendingPopup) return 0; // Approval has highest priority
  if (status === 'working' || status === 'waiting') return 1;
  if (status === 'idle') return 2;
  return 3; // ended, error
}

interface InstanceRowProps {
  instance: ClaudeInstance;
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
}

function InstanceRow({ instance, pendingPopup, onJump, onViewChat, onRespond }: InstanceRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isWaitingForApproval = pendingPopup !== undefined;
  const toolName = pendingPopup?.permission_data?.tool_name || instance.current_tool || '';
  const toolInput = pendingPopup?.permission_data?.action || getToolInputString(instance.tool_input) || '';

  // Get status phase for icon
  const getPhase = (): 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle' => {
    if (isWaitingForApproval) return 'waitingForApproval';
    if (instance.status === 'working' || instance.status === 'waiting') return 'processing';
    if (instance.status === 'idle') return 'waitingForInput';
    return 'idle';
  };

  const phase = getPhase();

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

        {/* Secondary info - tool name + input */}
        <div className="flex items-center gap-1.5 text-xs">
          {toolName && (
            <span
              className="font-medium"
              style={{ color: isWaitingForApproval ? TerminalColors.amber : 'rgba(255,255,255,0.5)' }}
            >
              {formatToolName(toolName)}
            </span>
          )}
          {toolInput && (
            <span className="text-white/40 truncate">
              {truncateText(toolInput, 40)}
            </span>
          )}
          {!toolName && !toolInput && instance.status === 'working' && (
            <span className="text-white/40">Processing...</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isWaitingForApproval && pendingPopup ? (
          // Inline approval buttons
          <InlineApprovalButtons
            onAllow={() => onRespond?.(pendingPopup.id, 'allow')}
            onDeny={() => onRespond?.(pendingPopup.id, 'deny')}
          />
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
      {instance.status !== 'ended' && onViewChat && (
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
      {instance.status !== 'ended' && (
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
      {(instance.status === 'idle' || instance.status === 'ended') && (
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
