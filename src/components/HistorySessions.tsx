// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ClaudeInstance } from '../types';
import { calculateDisplayName } from '../utils/displayName';
import { formatTimeAgo } from '../utils/timeFormat';
import { RestartDialog } from './RestartDialog';

interface HistorySessionsProps {
  instances: ClaudeInstance[];
  onViewChat?: (sessionId: string) => void;
}

export function HistorySessions({ instances, onViewChat }: HistorySessionsProps) {
  const [restartTarget, setRestartTarget] = useState<ClaudeInstance | null>(null);

  if (instances.length === 0) {
    return (
      <div className="text-white/30 text-xs text-center py-4">
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

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.04] transition-colors"
    >
      {/* Gray status dot */}
      <div className="w-3 h-3 rounded-full bg-white/20 flex-shrink-0" />

      {/* Display name */}
      <span className="text-white/50 text-xs truncate flex-1 min-w-0">
        {displayName}
      </span>

      {/* First prompt snippet */}
      {firstPrompt && (
        <span className="text-white/30 text-xs truncate max-w-[120px] hidden sm:block">
          {firstPrompt}
        </span>
      )}

      {/* Time ago */}
      <span className="text-white/30 text-xs shrink-0">
        {timeAgo}
      </span>

      {/* Ended badge */}
      <span className="px-1.5 py-0.5 rounded text-xs text-white/30 bg-white/[0.06] shrink-0">
        已结束
      </span>

      {/* Restart button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRestart();
        }}
        className="px-2 py-0.5 text-xs text-white/60 hover:text-white bg-white/[0.06] hover:bg-purple-600/80 rounded transition-colors shrink-0"
      >
        ↻ 重启
      </button>
    </motion.div>
  );
}
