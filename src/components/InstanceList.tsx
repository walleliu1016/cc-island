// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClaudeInstance, PopupItem } from '../types';
import { useAppStore } from '../stores/appStore';
import { SessionCard, getPhasePriority } from './SessionCard';
import { HistorySessions } from './HistorySessions';

// Fold threshold: 10 minutes (600 seconds)
const FOLD_THRESHOLD_SECONDS = 600;

// Check if instance is idle (inactive for threshold)
function isIdle(instance: ClaudeInstance): boolean {
  const now = Math.floor(Date.now() / 1000);
  const inactiveSeconds = now - instance.last_activity_at;
  return inactiveSeconds >= FOLD_THRESHOLD_SECONDS;
}

// Split instances into active and idle (ended sessions are no longer in instances)
function splitByState(instances: ClaudeInstance[]): { active: ClaudeInstance[], idle: ClaudeInstance[] } {
  const active: ClaudeInstance[] = [];
  const idle: ClaudeInstance[] = [];

  for (const instance of instances) {
    if (isIdle(instance)) {
      idle.push(instance);
    } else {
      active.push(instance);
    }
  }

  return { active, idle };
}

type TabType = 'active' | 'idle' | 'history';

interface InstanceListProps {
  instances: ClaudeInstance[];
  popups?: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat?: (sessionId: string) => void;
  onRespond?: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk?: (sessionId: string) => void;
}

export function InstanceList({ instances, popups = [], onJump, onViewChat, onRespond, onViewAsk }: InstanceListProps) {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const historySessions = useAppStore(s => s.historySessions);

  // Split into active and idle
  const { active, idle } = splitByState(instances);

  // Sort active instances by priority
  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getPhasePriority(a.status, popups.find(p => p.session_id === a.session_id && p.status === 'pending'));
    const priorityB = getPhasePriority(b.status, popups.find(p => p.session_id === b.session_id && p.status === 'pending'));
    return priorityA - priorityB;
  });

  const tabCounts = {
    active: sortedActive.length,
    idle: idle.length,
    history: historySessions.length,
  };

  const allEmpty = tabCounts.active === 0 && tabCounts.idle === 0 && tabCounts.history === 0;

  if (allEmpty) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Tab buttons */}
      <div className="flex gap-1 px-1 py-1">
        {(['active', 'idle', 'history'] as const).map(tab => (
          <motion.button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 px-2 py-1.5 text-xs rounded-lg font-medium transition-colors"
            style={{
              background: activeTab === tab ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.4)',
            }}
            whileHover={{ scale: 1.02 }}
          >
            {tab === 'active' && `活动 (${tabCounts.active})`}
            {tab === 'idle' && `空闲 (${tabCounts.idle})`}
            {tab === 'history' && `历史 (${tabCounts.history})`}
          </motion.button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTab === 'active' && (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="flex flex-col gap-1"
          >
            {sortedActive.length > 0 ? (
              sortedActive.map((instance) => (
                <SessionCard
                  key={instance.session_id}
                  instance={instance}
                  allInstances={sortedActive}
                  pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
                  onJump={onJump}
                  onViewChat={onViewChat}
                  onRespond={onRespond}
                  onViewAsk={onViewAsk}
                  isDesktopMode={false}
                />
              ))
            ) : (
              <div className="text-white/30 text-xs text-center py-4">
                暂无活动会话
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            {idle.length > 0 ? (
              <div className="flex flex-col gap-1">
                {idle.map((instance) => (
                  <SessionCard
                    key={instance.session_id}
                    instance={instance}
                    allInstances={idle}
                    pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
                    onJump={onJump}
                    onViewChat={onViewChat}
                    onRespond={onRespond}
                    onViewAsk={onViewAsk}
                    isDesktopMode={false}
                  />
                ))}
              </div>
            ) : (
              <div className="text-white/30 text-xs text-center py-4">
                暂无空闲会话
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            <HistorySessions
              instances={historySessions}
              onViewChat={onViewChat}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
