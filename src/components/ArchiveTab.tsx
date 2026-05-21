// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';
import { ClaudeInstance } from '../types';
import { StatusIcon, TerminalColors } from './StatusIcons';
import { calculateDisplayName } from '../utils/displayName';
import { formatTimeAgo, formatDuration } from '../utils/timeFormat';

interface ArchiveTabProps {
  showArchiveTab: boolean;
  activeCount: number;
  archivedInstances: ClaudeInstance[];
  onSelectTab: (tab: 'active' | 'archive') => void;
  onViewChat: (sessionId: string) => void;
}

export function ArchiveTab({ showArchiveTab, activeCount, archivedInstances, onSelectTab, onViewChat }: ArchiveTabProps) {
  const archiveCount = archivedInstances.length;

  return (
    <div className="flex flex-col gap-2">
      {/* Tab buttons */}
      <div className="flex gap-2 px-0 py-1">
        <motion.button
          onClick={() => onSelectTab('active')}
          className="rounded-lg font-medium"
          style={{
            background: showArchiveTab ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)',
            color: showArchiveTab ? '#888' : '#fff',
            padding: '8px 16px',
            fontSize: 12,
          }}
          whileHover={{ scale: 1.02 }}
        >
          活动会话 ({activeCount})
        </motion.button>
        <motion.button
          onClick={() => onSelectTab('archive')}
          className="rounded-lg flex items-center gap-1"
          style={{
            background: showArchiveTab ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
            color: showArchiveTab ? '#fff' : '#888',
            padding: '8px 16px',
            fontSize: 12,
          }}
          whileHover={{ scale: 1.02 }}
        >
          归档 ({archiveCount}) ▾
        </motion.button>
      </div>

      {/* Archived list (if showing) */}
      {showArchiveTab && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col gap-1 p-1 rounded-lg"
          style={{ background: 'rgba(0,0,0,0.2)' }}
        >
          {archivedInstances.map((instance) => (
            <ArchivedRow
              key={instance.session_id}
              instance={instance}
              onClick={() => onViewChat(instance.session_id)}
            />
          ))}
          {archivedInstances.length === 0 && (
            <div className="text-center text-gray-500 text-xs py-4">
              暂无归档会话
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function ArchivedRow({ instance, onClick }: { instance: ClaudeInstance; onClick: () => void }) {
  const displayName = calculateDisplayName(instance, [instance]);
  const timeRange = `${formatTimeAgo(instance.started_at)}-${formatTimeAgo(instance.last_activity_at)}`;
  const duration = formatDuration(instance.last_activity_at - instance.started_at);

  // Get status indicator color based on status type
  const getStatusColor = (): string => {
    switch (instance.status.type) {
      case 'ended':
        return TerminalColors.dim;
      case 'error':
        return TerminalColors.red;
      case 'idle':
        return TerminalColors.dim;
      default:
        return TerminalColors.cyan;
    }
  };

  const statusColor = getStatusColor();

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between cursor-pointer rounded-r-lg"
      style={{
        borderLeft: `2px solid ${statusColor}`,
        background: 'rgba(255,255,255,0.03)',
        padding: '6px 10px',
      }}
    >
      <div className="flex items-center gap-2">
        <StatusIcon phase="idle" size={12} />
        <span className="text-gray-300" style={{ fontSize: 12 }}>{displayName}</span>
        <span className="text-gray-500" style={{ fontSize: 10 }}>{timeRange}</span>
        <span className="text-gray-400" style={{ fontSize: 10 }}>{duration}</span>
      </div>
      <div className="text-gray-500" style={{ fontSize: 9 }}>
        {instance.status.type === 'error' ? '报错' : '已结束'}
      </div>
    </div>
  );
}