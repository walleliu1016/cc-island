import { motion } from 'framer-motion';
import { ClaudeInstance, PopupItem } from '../types';
import { StatusIcon } from './StatusIcons';

// Truncate text with ellipsis
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

// Fixed width for project name display
const PROJECT_NAME_MAX_LENGTH = 12;

interface InstanceListProps {
  instances: ClaudeInstance[];
  popups?: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
}

export function InstanceList({ instances, popups = [], onJump, onViewChat }: InstanceListProps) {
  // Sort instances by priority: Approval > Processing > Waiting > Idle
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
        />
      ))}
    </div>
  );
}

// Phase priority: lower = higher priority
function getPhasePriority(status: string, pendingPopup?: PopupItem): number {
  if (pendingPopup) return 0; // Approval has highest priority
  if (status === 'working' || status === 'waiting' || status === 'compacting') return 1;
  if (status === 'idle') return 2;
  return 3; // ended, error
}

interface InstanceRowProps {
  instance: ClaudeInstance;
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
}

function InstanceRow({ instance, pendingPopup, onJump, onViewChat }: InstanceRowProps) {
  const projectName = truncateText(instance.custom_name || instance.project_name, PROJECT_NAME_MAX_LENGTH);
  const isWaitingForApproval = pendingPopup !== undefined;

  // Get status phase for icon
  const getPhase = (): 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle' => {
    if (isWaitingForApproval) return 'waitingForApproval';
    if (instance.status === 'working' || instance.status === 'waiting' || instance.status === 'compacting') return 'processing';
    if (instance.status === 'idle') return 'waitingForInput';
    return 'idle';
  };

  const phase = getPhase();

  // Get secondary text
  const getSecondaryText = () => {
    if (isWaitingForApproval) {
      const toolName = pendingPopup?.permission_data?.tool_name || '';
      const action = pendingPopup?.permission_data?.action || '';
      return `${toolName} ${truncateText(action, 30)}`;
    }
    if (instance.status === 'working') {
      return instance.current_tool || '';
    }
    if (instance.status === 'waiting') {
      return 'Thinking...';
    }
    return '';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-default"
    >
      {/* Status indicator */}
      <div className="w-4 flex items-center justify-center">
        <StatusIcon phase={phase} size={12} />
      </div>

      {/* Project name */}
      <span
        className="text-white text-sm font-medium flex-shrink-0"
        style={{ width: '80px' }}
        title={instance.custom_name || instance.project_name}
      >
        {projectName}
      </span>

      {/* Secondary text */}
      <span className="text-white/50 text-xs flex-1 truncate">
        {getSecondaryText()}
      </span>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isWaitingForApproval ? (
          <ApprovalButtons />
        ) : (
          <>
            {/* Chat button */}
            {instance.status !== 'ended' && onViewChat && (
              <button
                onClick={() => onViewChat(instance.session_id)}
                className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded transition-colors"
                title="View chat"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 2h8v7H4l-2 2V2z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            )}
            {/* Jump button */}
            {instance.status !== 'ended' && (
              <button
                onClick={() => onJump(instance.session_id)}
                className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.08] rounded transition-colors"
                title="Jump to terminal"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="6" cy="6" r="2" fill="currentColor" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

// Inline approval buttons (display only - actual approval happens in PopupCard)
function ApprovalButtons() {
  return (
    <div className="flex items-center gap-1.5">
      {/* Deny button */}
      <span
        className="px-2.5 py-1 text-xs text-white/90 bg-red-500/80 rounded-full"
      >
        Deny
      </span>
      {/* Allow button */}
      <span
        className="px-2.5 py-1 text-xs text-white bg-purple-500 rounded-full"
      >
        Allow
      </span>
    </div>
  );
}