// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClaudeInstance, PopupItem } from '../types';
import { calculateDisplayName, calculateTooltip } from '../utils/displayName';
import { formatTimeAgo } from '../utils/timeFormat';
import { useAppStore } from '../stores/appStore';
import { getTheme } from '../theme';

interface FoldedSessionsProps {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onContextMenu?: (e: React.MouseEvent, instance: ClaudeInstance) => void;
}

export function FoldedSessions({
  instances,
  popups,
  onJump,
  onViewChat,
  onRespond,
  onContextMenu,
}: FoldedSessionsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  if (instances.length === 0) return null;

  return (
    <div className="mt-2">
      {/* Folded header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center justify-between"
        style={{ color: colors.textMuted }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.background = colors.bgCardHover; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = 'transparent'; }}
      >
        <span>空闲会话 ({instances.length})</span>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          ▼
        </motion.span>
      </button>

      {/* Folded instances list */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1 mt-1 pl-2">
              {instances.map((instance) => (
                <FoldedInstanceRow
                  key={instance.session_id}
                  instance={instance}
                  allInstances={instances}
                  popups={popups}
                  onJump={onJump}
                  onViewChat={onViewChat}
                  onRespond={onRespond}
                  onContextMenu={onContextMenu}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FoldedInstanceRowProps {
  instance: ClaudeInstance;
  allInstances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onContextMenu?: (e: React.MouseEvent, instance: ClaudeInstance) => void;
}

function FoldedInstanceRow({
  instance,
  allInstances,
  popups,
  onViewChat,
  onRespond,
  onContextMenu,
}: FoldedInstanceRowProps) {
  const displayName = calculateDisplayName(instance, allInstances);
  const tooltip = calculateTooltip(instance);
  const pendingPopup = popups.find(p => p.session_id === instance.session_id && p.status === 'pending');
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      onContextMenu={(e) => onContextMenu?.(e, instance)}
      title={tooltip}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = colors.bgCardHover)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Status indicator */}
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colors.bgInputBorder }} />

      {/* Name */}
      <span className="text-xs truncate flex-1" style={{ color: colors.textMuted }}>
        {displayName}
      </span>

      {/* Time ago */}
      <span className="text-xs" style={{ color: colors.textMuted }}>
        {formatTimeAgo(instance.last_activity_at)}
      </span>

      {/* Pending popup indicator */}
      {pendingPopup && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (pendingPopup.type === 'ask') {
              onViewChat?.(instance.session_id);
            } else {
              onRespond?.(pendingPopup.id, 'allow');
            }
          }}
          className="px-2 py-0.5 text-xs rounded transition-colors"
          style={{ background: colors.bgApp, color: colors.textPrimary }}
          onMouseEnter={e => (e.currentTarget.style.background = colors.bgCardHover)}
          onMouseLeave={e => (e.currentTarget.style.background = colors.bgApp)}
        >
          {pendingPopup.type === 'ask' ? '回答' : '允许'}
        </button>
      )}
    </motion.div>
  );
}