// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../stores/appStore';
import { ClaudeInstance, PopupItem, InstanceStatus, SessionNotification, StatsResponse } from '../types';
import { SessionCard } from './SessionCard';
import { HistorySessions } from './HistorySessions';

interface CloudStatus {
  connected: boolean;
  connecting: boolean;
  failed: boolean;
  failedReason: string;
}

interface DesktopModeProps {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  onJump: (sessionId: string) => void;
  onViewChat: (sessionId: string) => void;
  onRespond: (popupId: string, decision: 'allow' | 'deny') => void;
  onViewAsk: (sessionId: string) => void;
  onSettings?: () => void;
  cloudStatus?: CloudStatus;
  sessionNotification?: SessionNotification | null;
}

// Fold threshold: 10 minutes (600 seconds)
const FOLD_THRESHOLD_SECONDS = 600;

// Split instances into active and idle (ended sessions are no longer in instances)
function splitInstances(instances: ClaudeInstance[]): { active: ClaudeInstance[], idle: ClaudeInstance[] } {
  const now = Math.floor(Date.now() / 1000);

  const active: ClaudeInstance[] = [];
  const idle: ClaudeInstance[] = [];

  for (const inst of instances) {
    const isIdleTooLong = inst.status.type === 'idle' && (now - inst.last_activity_at) >= FOLD_THRESHOLD_SECONDS;

    if (isIdleTooLong) {
      idle.push(inst);
    } else {
      active.push(inst);
    }
  }

  return { active, idle };
}

// Phase priority: lower = higher priority
function getStatusPriority(status: InstanceStatus, popup?: PopupItem): number {
  if (popup) return 0;
  if (status.type === 'working' || status.type === 'thinking' || status.type === 'waiting') return 1;
  if (status.type === 'compacting') return 1;
  if (status.type === 'idle') return 2;
  return 3;
}

export function DesktopMode({ instances, popups, onJump, onViewChat, onRespond, onViewAsk, onSettings, cloudStatus, sessionNotification }: DesktopModeProps) {
  const { setIslandMode } = useAppStore();
  const historySessions = useAppStore(s => s.historySessions);
  const [activeTab, setActiveTab] = useState<'active' | 'idle' | 'history'>('active');
  const [productName, setProductName] = useState<string>('');
  const [stats, setStats] = useState<StatsResponse>({ session_count: 0, message_count: 0, tool_count: 0, active_count: 0 });

  // Fetch product name and stats
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [name, statsData] = await Promise.all([
          invoke<string>('get_product_name'),
          invoke<StatsResponse>('get_stats')
        ]);
        setProductName(name);
        setStats(statsData);
      } catch (e) {
        console.error('Failed to fetch data:', e);
      }
    };
    fetchData();

    // Poll stats every 2 seconds
    const interval = setInterval(async () => {
      try {
        const statsData = await invoke<StatsResponse>('get_stats');
        setStats(statsData);
      } catch (e) {
        console.error('Failed to fetch stats:', e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const { active, idle } = splitInstances(instances);

  const sortedActive = [...active].sort((a, b) => {
    const priorityA = getStatusPriority(a.status, popups.find(p => p.session_id === a.session_id));
    const priorityB = getStatusPriority(b.status, popups.find(p => p.session_id === b.session_id));
    return priorityA - priorityB;
  });

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
        {/* Left: Avatar + Title + Stats */}
        <div className="flex items-center gap-3">
          {/* User Avatar - Purple gradient with first letter */}
          <div
            className="flex items-center justify-center font-bold text-white"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
              fontSize: 14,
            }}
          >
            {productName.charAt(0).toUpperCase() || 'C'}
          </div>

          {/* Title and session count */}
          <div className="flex flex-col">
            <span className="text-white/90 font-semibold" style={{ fontSize: 13 }}>{productName || 'CC-Island'}</span>
            <div className="flex items-center gap-1">
              <span className="text-green-400" style={{ fontSize: 11 }}>● {stats.session_count}个会话</span>
              {/* Cloud connection indicator */}
              {cloudStatus && (
                <div
                  className="flex items-center justify-center"
                  title={cloudStatus.connected ? '云服务已连接' : cloudStatus.connecting ? '正在连接...' : cloudStatus.failed ? `连接失败: ${cloudStatus.failedReason}` : '未连接'}
                >
                  {cloudStatus.connected ? (
                    <span className="text-green-400 text-xs">☁</span>
                  ) : cloudStatus.connecting ? (
                    <span className="text-yellow-400 text-xs animate-pulse">☁</span>
                  ) : cloudStatus.failed ? (
                    <span className="text-red-400 text-xs">☁</span>
                  ) : (
                    <span className="text-white/30 text-xs">☁</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Quick buttons */}
        <div className="flex items-center gap-2">
          {/* 快捷 button */}
          <button
            className="font-medium transition-colors"
            style={{
              background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
              borderRadius: 10,
              padding: '6px 12px',
              color: 'white',
              fontSize: 11,
            }}
          >
            快捷
          </button>

          {/* APM button */}
          <button
            className="font-medium transition-colors"
            style={{
              background: 'rgba(75,85,99,0.8)',
              borderRadius: 10,
              padding: '6px 12px',
              color: 'white',
              fontSize: 11,
            }}
          >
            APM
          </button>
        </div>

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

      {/* Stats bar - 4 stat cards */}
      <div className="flex items-center gap-2 px-4 py-2" style={{ background: 'rgba(30,30,30,0.95)' }}>
        {/* Session count - Purple gradient */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(168,85,247,0.1)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="2" stroke="#a855f7" strokeWidth="1.2"/>
          </svg>
          <span className="font-bold text-sm" style={{ background: 'linear-gradient(135deg, #c4b5fd 0%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {stats.session_count}
          </span>
          <span className="text-white/50 text-xs">会话</span>
        </div>

        {/* Message count - Green gradient */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(34,197,94,0.1)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 3h8v6H2z" stroke="#22c55e" strokeWidth="1.2"/>
            <path d="M2 3l4 3 4-3" stroke="#22c55e" strokeWidth="1.2" fill="none"/>
          </svg>
          <span className="font-bold text-sm" style={{ background: 'linear-gradient(135deg, #6ee7b7 0%, #34d399 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {stats.message_count}
          </span>
          <span className="text-white/50 text-xs">消息</span>
        </div>

        {/* Tool count - Yellow gradient */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(251,191,36,0.1)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 6l2 2 4-4" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="font-bold text-sm" style={{ background: 'linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {stats.tool_count}
          </span>
          <span className="text-white/50 text-xs">调用</span>
        </div>

        {/* Active count - Blue gradient */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(96,165,250,0.1)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4" stroke="#60a5fa" strokeWidth="1.2"/>
            <circle cx="6" cy="6" r="2" fill="#60a5fa"/>
          </svg>
          <span className="font-bold text-sm" style={{ background: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {stats.active_count}
          </span>
          <span className="text-white/50 text-xs">进行中</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col p-3 overflow-y-auto gap-2">
        {/* Session notification toast */}
        {sessionNotification && (
          <div
            className="px-3 py-2 rounded-lg text-sm animate-pulse"
            style={{
              background: sessionNotification.notification_type === 'started'
                ? 'rgba(76,175,80,0.2)'
                : 'rgba(244,67,54,0.2)',
              color: sessionNotification.notification_type === 'started'
                ? '#4caf50'
                : '#f44336',
            }}
          >
            {sessionNotification.notification_type === 'started'
              ? `🚀 ${sessionNotification.project_name}已启动`
              : `⏹ ${sessionNotification.project_name}已停止`}
          </div>
        )}

        {/* Tab buttons */}
        <div className="flex gap-2 px-0 py-1">
          {(['active', 'idle', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="rounded-lg font-medium transition-colors"
              style={{
                background: activeTab === tab ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
                color: activeTab === tab ? '#fff' : '#888',
                padding: '8px 16px',
                fontSize: 12,
              }}
            >
              {tab === 'active' && `活动会话 (${sortedActive.length})`}
              {tab === 'idle' && `空闲会话 (${idle.length})`}
              {tab === 'history' && `历史会话 (${historySessions.length})`}
            </button>
          ))}
        </div>

        {/* Active tab content */}
        {activeTab === 'active' && (
          <div className="flex flex-col gap-2">
            {sortedActive.map((instance) => (
              <SessionCard
                key={instance.session_id}
                instance={instance}
                allInstances={sortedActive}
                pendingPopup={popups.find(p => p.session_id === instance.session_id)}
                onJump={onJump}
                onViewChat={onViewChat}
                onRespond={onRespond}
                onViewAsk={onViewAsk}
                isDesktopMode={true}
              />
            ))}
            {sortedActive.length === 0 && (
              <div className="text-center text-white/30 text-xs py-8">
                暂无活动会话
              </div>
            )}
          </div>
        )}

        {/* Idle tab content */}
        {activeTab === 'idle' && (
          <div className="flex flex-col gap-2">
            {idle.map((instance) => (
              <SessionCard
                key={instance.session_id}
                instance={instance}
                allInstances={idle}
                pendingPopup={popups.find(p => p.session_id === instance.session_id)}
                onJump={onJump}
                onViewChat={onViewChat}
                onRespond={onRespond}
                onViewAsk={onViewAsk}
                isDesktopMode={true}
              />
            ))}
            {idle.length === 0 && (
              <div className="text-center text-white/30 text-xs py-8">
                暂无空闲会话
              </div>
            )}
          </div>
        )}

        {/* History tab content */}
        {activeTab === 'history' && (
          <HistorySessions
            instances={historySessions}
            onViewChat={onViewChat}
          />
        )}
      </div>
    </div>
  );
}