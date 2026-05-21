// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { ClaudeInstance, PopupItem, InstanceStatus } from '../types';
import { SessionCard } from './SessionCard';
import { ArchiveTab } from './ArchiveTab';

interface DesktopModeProps {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat: (sessionId: string) => void;
}

// Fold threshold: 10 minutes (600 seconds)
const FOLD_THRESHOLD_SECONDS = 600;

// Split instances into active and archived
function splitInstances(instances: ClaudeInstance[]): { active: ClaudeInstance[], archived: ClaudeInstance[] } {
  const now = Math.floor(Date.now() / 1000);

  const active: ClaudeInstance[] = [];
  const archived: ClaudeInstance[] = [];

  for (const inst of instances) {
    const isEnded = inst.status.type === 'ended';
    const isIdleTooLong = inst.status.type === 'idle' && (now - inst.last_activity_at) >= FOLD_THRESHOLD_SECONDS;

    if (isEnded || isIdleTooLong) {
      archived.push(inst);
    } else {
      active.push(inst);
    }
  }

  return { active, archived };
}

// Phase priority: lower = higher priority
function getStatusPriority(status: InstanceStatus, popup?: PopupItem): number {
  if (popup) return 0; // Approval has highest priority
  if (status.type === 'working' || status.type === 'thinking' || status.type === 'waiting') return 1;
  if (status.type === 'compacting') return 1;
  if (status.type === 'idle') return 2;
  return 3; // error, ended
}

export function DesktopMode({ instances, popups, onJump, onViewChat }: DesktopModeProps) {
  const { setIslandMode } = useAppStore();
  const [showArchiveTab, setShowArchiveTab] = useState(false);

  // Split active and archived
  const { active, archived } = splitInstances(instances);

  // Sort active by priority
  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getStatusPriority(a.status, popups.find(p => p.session_id === a.session_id));
    const priorityB = getStatusPriority(b.status, popups.find(p => p.session_id === b.session_id));
    return priorityA - priorityB;
  });

  const displayed = showArchiveTab ? archived : sortedActive;

  return (
    <div className="h-full flex flex-col rounded-xl" style={{
      background: 'rgba(20,20,20,0.98)',
      border: '1px solid rgba(255,255,255,0.12)',
    }}>
      {/* Title bar - draggable */}
      <div
        className="flex items-center justify-between px-4 py-3"
        data-tauri-drag-region
        style={{
          background: 'rgba(30,30,30,0.5)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
        <div className="flex items-center gap-2">
          {/* Logo */}
          <svg width="18" height="18" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="7" fill="#d97857"/>
          </svg>
          {/* App name */}
          <span className="text-white font-semibold" style={{ fontSize: 14 }}>CC-Island</span>
          {/* Status count */}
          <span className="text-green-400" style={{ fontSize: 11 }}>● {active.length}个会话运行中</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Layout switch button */}
          <button
            onClick={() => setIslandMode()}
            className="rounded-lg"
            style={{
              background: 'rgba(76,175,80,0.1)',
              border: '1px solid rgba(76,175,80,0.3)',
              color: '#4caf50',
              padding: '6px 10px',
              fontSize: 11,
            }}
          >
            Island 模式
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col p-3 overflow-y-auto gap-2">
        {/* Archive Tab */}
        <ArchiveTab
          showArchiveTab={showArchiveTab}
          activeCount={active.length}
          archivedInstances={archived}
          onSelectTab={(tab) => setShowArchiveTab(tab === 'archive')}
          onViewChat={onViewChat}
        />

        {/* Session cards */}
        <div className="flex flex-col gap-2">
          {displayed.map((instance) => (
            <SessionCard
              key={instance.session_id}
              instance={instance}
              allInstances={displayed}
              pendingPopup={popups.find(p => p.session_id === instance.session_id)}
              onJump={onJump}
              onViewChat={onViewChat}
              isDesktopMode={true}
            />
          ))}
        </div>

        {/* Empty state */}
        {displayed.length === 0 && (
          <div className="text-center text-white/30 text-xs py-8">
            {showArchiveTab ? '暂无归档会话' : '暂无活动会话'}
          </div>
        )}
      </div>
    </div>
  );
}