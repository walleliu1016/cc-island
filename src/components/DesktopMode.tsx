// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../stores/appStore';
import { ClaudeInstance, PopupItem, InstanceStatus } from '../types';
import { SessionCard } from './SessionCard';
import { ArchiveTab } from './ArchiveTab';

interface DesktopModeProps {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat: (sessionId: string) => void;
  onRespond: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk: (sessionId: string) => void;
  onSettings?: () => void;
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
  if (popup) return 0;
  if (status.type === 'working' || status.type === 'thinking' || status.type === 'waiting') return 1;
  if (status.type === 'compacting') return 1;
  if (status.type === 'idle') return 2;
  return 3;
}

export function DesktopMode({ instances, popups, onJump, onViewChat, onRespond, onViewAsk, onSettings }: DesktopModeProps) {
  const { setIslandMode } = useAppStore();
  const [showArchiveTab, setShowArchiveTab] = useState(false);

  const { active, archived } = splitInstances(instances);

  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getStatusPriority(a.status, popups.find(p => p.session_id === a.session_id));
    const priorityB = getStatusPriority(b.status, popups.find(p => p.session_id === b.session_id));
    return priorityA - priorityB;
  });

  const displayed = showArchiveTab ? archived : sortedActive;

  const handleMinimize = async () => {
    try {
      await invoke('minimize_window');
    } catch (e) {
      console.error('Failed to minimize:', e);
    }
  };

  const handleClose = async () => {
    try {
      await invoke('close_window');
    } catch (e) {
      console.error('Failed to close:', e);
    }
  };

  const handleDrag = async (e: React.MouseEvent) => {
    // Only start drag on left mouse button and not on buttons
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      await invoke('start_drag');
    } catch (e) {
      console.error('Failed to start drag:', e);
    }
  };

  return (
    <div className="h-full w-full flex flex-col" style={{
      background: 'rgba(20,20,20,0.98)',
    }}>
      {/* Window header bar - draggable with controls */}
      <div
        className="flex items-center justify-between px-4 py-2 select-none cursor-move"
        onMouseDown={handleDrag}
        style={{
          background: 'rgba(40,40,40,0.95)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" fill="#d97857"/>
          </svg>
          <span className="text-white/90 font-semibold" style={{ fontSize: 13 }}>CC-Island</span>
          <span className="text-green-400" style={{ fontSize: 11 }}>● {active.length}个会话</span>
        </div>

        {/* Center: Spacer (drag area) */}
        <div className="flex-1" />

        {/* Right: Mode switch + Settings + Window controls */}
        <div className="flex items-center gap-2">
          {/* Settings button */}
          {onSettings && (
            <button
              onClick={onSettings}
              className="rounded p-1.5 hover:bg-white/10 transition-colors"
              style={{ color: '#888' }}
              title="设置"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7 2v2M7 10v2M2 7h2M10 7h2M3.5 3.5l1.4 1.4M9.1 9.1l1.4 1.4M3.5 10.5l1.4-1.4M9.1 4.9l1.4-1.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {/* 灵动岛模式 button */}
          <button
            onClick={() => setIslandMode()}
            className="rounded px-2 py-1 transition-colors"
            style={{
              background: 'rgba(76,175,80,0.1)',
              border: '1px solid rgba(76,175,80,0.2)',
              color: '#4caf50',
              fontSize: 11,
            }}
            title="切换到灵动岛模式"
          >
            灵动岛
          </button>

          {/* Window controls */}
          <div className="flex items-center gap-0.5">
            {/* Minimize button */}
            <button
              onClick={handleMinimize}
              className="rounded p-1.5 hover:bg-white/10 transition-colors"
              style={{ color: '#888' }}
              title="最小化"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="3" y="6" width="8" height="2" rx="0.5"/>
              </svg>
            </button>

            {/* Close button */}
            <button
              onClick={handleClose}
              className="rounded p-1.5 hover:bg-red-500/80 hover:text-white transition-colors"
              style={{ color: '#888' }}
              title="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
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
              onRespond={onRespond}
              onViewAsk={onViewAsk}
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