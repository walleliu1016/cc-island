// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ClaudeInstance } from '../types';
import { calculateDisplayName } from '../utils/displayName';
import { formatTimeAgo } from '../utils/timeFormat';
import { RestartDialog } from './RestartDialog';
import { useAppStore } from '../stores/appStore';
import { getTheme } from '../theme';

interface HistorySessionsProps {
  instances: ClaudeInstance[];
  onViewChat?: (sessionId: string) => void;
}

export function HistorySessions({ instances, onViewChat }: HistorySessionsProps) {
  const [restartTarget, setRestartTarget] = useState<ClaudeInstance | null>(null);
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  if (instances.length === 0) {
    return (
      <div className="text-xs text-center py-4" style={{ color: colors.textMuted }}>
        暂无历史会话
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        {instances.map((instance) => (
          <HistorySessionRow
            key={instance.session_id}
            instance={instance}
            allInstances={instances}
            onClick={() => onViewChat?.(instance.session_id)}
            onRestart={() => setRestartTarget(instance)}
          />
        ))}
      </div>

      {/* Restart dialog */}
      {restartTarget && (
        <RestartDialog
          sessionId={restartTarget.session_id}
          projectName={restartTarget.project_name}
          firstPrompt={restartTarget.first_prompt}
          onClose={() => setRestartTarget(null)}
        />
      )}
    </>
  );
}

interface HistorySessionRowProps {
  instance: ClaudeInstance;
  allInstances: ClaudeInstance[];
  onClick: () => void;
  onRestart: () => void;
}

function HistorySessionRow({ instance, allInstances, onClick, onRestart }: HistorySessionRowProps) {
  const displayName = calculateDisplayName(instance, allInstances);
  const timeAgo = formatTimeAgo(instance.ended_at || instance.last_activity_at);
  const firstPrompt = instance.first_prompt;
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = colors.bgCardHover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Gray status dot */}
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colors.bgInputBorder }} />

      {/* Display name */}
      <span className="text-xs truncate flex-1 min-w-0" style={{ color: colors.textMuted }}>
        {displayName}
      </span>

      {/* First prompt snippet */}
      {firstPrompt && (
        <span className="text-xs truncate max-w-[120px] hidden sm:block" style={{ color: colors.textMuted }}>
          {firstPrompt}
        </span>
      )}

      {/* Time ago */}
      <span className="text-xs shrink-0" style={{ color: colors.textMuted }}>
        {timeAgo}
      </span>

      {/* Ended badge */}
      <span className="px-1.5 py-0.5 rounded text-xs shrink-0" style={{ color: colors.textMuted, background: colors.bgCardHover }}>
        已结束
      </span>

      {/* Restart button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRestart();
        }}
        className="px-2 py-0.5 text-xs rounded transition-colors shrink-0"
        style={{ color: colors.textMuted, background: colors.bgCardHover }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.background = 'rgba(124,58,237,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = colors.bgCardHover; }}
      >
        ↻ 重启
      </button>
    </motion.div>
  );
}
