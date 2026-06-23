// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../stores/appStore';
import { ClaudeInstance, PopupItem, HooksCheckResult, SessionNotification, ToolActivityDetail } from '../types';
import { ChatView } from './ChatView';
import { SettingsModal, HooksSetupModal } from './Settings';
import { getPhasePriority } from './SessionCard';
import { WelcomeView, CreateSessionModal } from './WelcomeView';
import { ClaudeCrabIcon } from './StatusIcons';
import { getTheme } from '../theme';

const SIDEBAR_WIDTH = 260;
const POLL_INTERVAL = 500;
const FOLD_THRESHOLD_SECONDS = 600;

function splitInstances(instances: ClaudeInstance[]): { active: ClaudeInstance[], idle: ClaudeInstance[] } {
  const now = Math.floor(Date.now() / 1000);
  const active: ClaudeInstance[] = [];
  const idle: ClaudeInstance[] = [];
  for (const inst of instances) {
    if (inst.status.type === 'idle' && (now - inst.last_activity_at) >= FOLD_THRESHOLD_SECONDS) {
      idle.push(inst);
    } else {
      active.push(inst);
    }
  }
  return { active, idle };
}

// Time formatting
function relativeTime(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000) - ts;
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return `${Math.floor(seconds / 86400)}天前`;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${+(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

// Tool icon mapping
const TOOL_ICONS: Record<string, string> = {
  Bash: '🔧', Read: '📖', Write: '✏️', Edit: '📝', Glob: '🔍', Grep: '🔎',
  WebFetch: '🌐', WebSearch: '🔎', Task: '📋', TaskCreate: '📋',
};

type MainView = 'welcome' | 'chat' | 'settings' | 'hooksSetup';

export function DesktopLayout() {
  const { setDesktopWindowOpen, setHistorySessions, historySessions } = useAppStore();
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  const [instances, setInstances] = useState<ClaudeInstance[]>([]);
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [productName, setProductName] = useState<string>('');
  const [hostname, setHostname] = useState<string>('');
  const [cloudStatus, setCloudStatus] = useState<{ connected: boolean; connecting: boolean; failed: boolean; failedReason: string }>({ connected: false, connecting: false, failed: false, failedReason: '' });
  const [sessionNotification, setSessionNotification] = useState<SessionNotification | null>(null);
  const [hooksCheckResult, setHooksCheckResult] = useState<HooksCheckResult | null>(null);
  const [models, setModels] = useState<string[]>([]);

  const [mainView, setMainView] = useState<MainView>('welcome');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'idle' | 'history'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(new Set());
  const [isMaximized, setIsMaximized] = useState(false);
  const [kbNavIndex, setKbNavIndex] = useState(-1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [permDismissed, setPermDismissed] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Check hooks on startup
  useEffect(() => {
    invoke<HooksCheckResult>('check_claude_hooks').then(setHooksCheckResult).catch(console.error);
  }, []);

  // Track maximize state for window control button icon
  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Data polling
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [instancesData, popupsData, sessionNotif, cloudStatusRaw, historyData] = await Promise.all([
          invoke<ClaudeInstance[]>('get_instances'),
          invoke<PopupItem[]>('get_popups'),
          invoke<SessionNotification | null>('get_session_notification'),
          invoke<string>('get_cloud_connection_status'),
          invoke<ClaudeInstance[]>('get_history_sessions'),
        ]);
        setInstances(instancesData);
        setPopups(popupsData);
        setHistorySessions(historyData);
        if (sessionNotif) setSessionNotification(sessionNotif);

        let isConnected = false, isConnecting = false, isFailed = false, failedReason = '';
        if (cloudStatusRaw && typeof cloudStatusRaw === 'object') {
          const status = cloudStatusRaw as { type?: string; message?: string };
          if (status.type === 'Connected') isConnected = true;
          else if (status.type === 'Connecting') isConnecting = true;
          else if (status.type === 'Failed') { isFailed = true; failedReason = status.message || '连接失败'; }
        }
        setCloudStatus({ connected: isConnected, connecting: isConnecting, failed: isFailed, failedReason });
      } catch (e) { console.error('Desktop fetch error:', e); }
    };
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [setHistorySessions]);

  // Product name
  useEffect(() => {
    invoke<string>('get_product_name').then(setProductName).catch(() => setProductName('CC-Island'));
  }, []);

  // Hostname
  useEffect(() => {
    invoke<string>('get_hostname').then(setHostname).catch(() => setHostname('unknown'));
  }, []);

  // Fetch available models
  useEffect(() => {
    invoke<string[]>('get_available_models').then(setModels).catch(() => setModels(['sonnet', 'opus', 'haiku']));
  }, []);

  // Listen for desktop-window-state
  useEffect(() => {
    const unlisten = listen<boolean>('desktop-window-state', (event) => setDesktopWindowOpen(event.payload));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Listen for popup-resolved
  useEffect(() => {
    const unlisten = listen<{ popup_id: string; session_id: string }>('popup-resolved', async () => {
      try {
        const [instancesData, popupsData] = await Promise.all([
          invoke<ClaudeInstance[]>('get_instances'),
          invoke<PopupItem[]>('get_popups'),
        ]);
        setInstances(instancesData);
        setPopups(popupsData);
      } catch (e) { console.error(e); }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Clear session notification after 3s
  useEffect(() => {
    if (sessionNotification) {
      const timer = setTimeout(() => setSessionNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [sessionNotification]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('desktop-search')?.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (isInput && document.activeElement?.id === 'desktop-search') {
          (document.activeElement as HTMLInputElement).value = '';
          setSearchQuery('');
          return;
        }
        if (permDismissed.has(selectedSessionId || '')) return;
        if (mainView === 'settings' || mainView === 'hooksSetup') {
          setMainView('welcome');
        } else if (mainView === 'chat') {
          setSelectedSessionId(null);
          setMainView('welcome');
        }
        return;
      }

      // ArrowUp/ArrowDown: navigate sidebar items
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isInput) {
        e.preventDefault();
        const allItems = getCurrentList();
        if (allItems.length === 0) return;
        if (e.key === 'ArrowDown') {
          setKbNavIndex(idx => Math.min(idx + 1, allItems.length - 1));
        } else {
          setKbNavIndex(idx => Math.max(idx - 1, 0));
        }
      }

      // Enter: select keyboard-highlighted item
      if (e.key === 'Enter' && kbNavIndex >= 0 && !isInput) {
        const allItems = getCurrentList();
        if (allItems[kbNavIndex]) {
          setSelectedSessionId(allItems[kbNavIndex].session_id);
          setMainView('chat');
          setKbNavIndex(-1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mainView, kbNavIndex, selectedSessionId, permDismissed]);

  const lastTitleBarClickRef = useRef(0);

  const handleTitleBarMouseDown = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const now = Date.now();
    const isDoubleClick = now - lastTitleBarClickRef.current < 400;
    lastTitleBarClickRef.current = now;
    if (isDoubleClick) {
      getCurrentWindow().toggleMaximize();
      return;
    }
    try { await invoke('start_drag'); } catch (err) { console.error(err); }
  };

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleMaximize = () => {
    getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    try { await invoke('close_desktop_window'); } catch (e) { console.error(e); }
  };

  const handleOpenIsland = async () => {
    try { await invoke('show_main_window'); } catch (e) { console.error(e); }
  };

  const handleViewChat = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setMainView('chat');
    setKbNavIndex(-1);
  }, []);

  const handleJump = useCallback(async (sessionId: string) => {
    try { await invoke('jump_to_instance', { sessionId }); } catch (e) { console.error(e); }
  }, []);

  const togglePin = useCallback((sessionId: string) => {
    setPinnedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const { active, idle } = useMemo(() => splitInstances(instances), [instances]);

  const sortedActive = useMemo(() => [...active].sort((a, b) => {
    const pa = getPhasePriority(a.status, popups.find(p => p.session_id === a.session_id && p.status === 'pending'));
    const pb = getPhasePriority(b.status, popups.find(p => p.session_id === b.session_id && p.status === 'pending'));
    return pa - pb;
  }), [active, popups]);

  const filterBySearch = (list: ClaudeInstance[]) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(i =>
      i.project_name.toLowerCase().includes(q) ||
      (i.first_prompt && i.first_prompt.toLowerCase().includes(q))
    );
  };

  // Sort: pinned first, then by priority
  const sortWithPins = (list: ClaudeInstance[]) => {
    return [...list].sort((a, b) => {
      const aP = pinnedSessions.has(a.session_id) ? 1 : 0;
      const bP = pinnedSessions.has(b.session_id) ? 1 : 0;
      if (aP !== bP) return bP - aP;
      return 0;
    });
  };

  const filteredActive = useMemo(() => sortWithPins(filterBySearch(sortedActive)), [sortedActive, searchQuery, pinnedSessions]);
  const filteredIdle = useMemo(() => sortWithPins(filterBySearch(idle)), [idle, searchQuery, pinnedSessions]);
  const filteredHistory = useMemo(() => {
    const base = searchQuery.trim()
      ? historySessions.filter(i => i.project_name.toLowerCase().includes(searchQuery.toLowerCase()))
      : historySessions;
    return base;
  }, [historySessions, searchQuery]);

  const getCurrentList = useCallback(() => {
    if (activeTab === 'active') return filteredActive;
    if (activeTab === 'idle') return filteredIdle;
    return filteredHistory;
  }, [activeTab, filteredActive, filteredIdle, filteredHistory]);

  const selectedInstance = selectedSessionId
    ? [...instances, ...historySessions].find(i => i.session_id === selectedSessionId)
    : null;

  const pendingPopups = popups.filter(p => p.status === 'pending');
  const selectedPopup = selectedSessionId ? pendingPopups.find(p => p.session_id === selectedSessionId) : null;
  const showPermCard = selectedPopup && selectedSessionId && !permDismissed.has(selectedSessionId) && selectedInstance;

  return (
    <div className="h-screen w-screen flex flex-col" style={{ background: colors.bgApp }}>
      {/* Titlebar */}
      <div
        className="flex items-center px-3.5 select-none flex-shrink-0"
        style={{ height: 42, background: colors.bgTitlebar, borderBottom: `1px solid ${colors.borderLight}`, cursor: 'default' }}
        onMouseDown={handleTitleBarMouseDown}
      >
        {/* Left: Hostname + Cloud status */}
        <div className="flex items-center gap-2.5" style={{ flex: 1 }}>
          <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>{hostname || '...'}</span>
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              cloudStatus.connected ? 'bg-green-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' :
              cloudStatus.connecting ? 'bg-yellow-500 animate-pulse' : 'bg-white/20'
            }`}
          />
          <span className="text-[10px]" style={{ color: cloudStatus.connected ? '#10b981' : cloudStatus.connecting ? '#f59e0b' : '#64748b' }}>
            {cloudStatus.connected ? '已连接' : cloudStatus.connecting ? '连接中...' : '未连接'}
          </span>
        </div>

        {/* Center: Crab icon */}
        <div className="flex items-center justify-center" style={{ width: 40 }}>
          <ClaudeCrabIcon size={14} color="#ef4444" animateLegs={cloudStatus.connected} />
        </div>

        {/* Right: Action buttons + Window controls */}
        <div className="flex items-center gap-1.5" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleOpenIsland}
          className="h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 transition-colors mr-1.5"
          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.1)')}
        >
          ◉ 灵动岛
        </button>

        {/* Cloud toggle */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={async () => { try { await invoke('toggle_cloud_connection'); } catch (e) { /* noop */ } }}
          className="h-7 px-2 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors text-xs mr-1"
          title="切换云连接"
        >
          ☁
        </button>

        {/* New Session */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setShowCreateModal(true)}
          className="h-7 px-3 rounded-md transition-all text-xs font-semibold mr-1.5 flex items-center gap-1.5"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
            color: '#f1f5f9',
            boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 14px rgba(124,58,237,0.45)')}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(124,58,237,0.3)')}
          title="新建会话"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
          新建
        </button>

        {/* Settings */}
        <button
          onMouseDown={(e) => { e.stopPropagation(); setSelectedSessionId(null); setMainView('settings'); }}
          className="h-7 px-2 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors text-xs mr-1"
          title="设置"
        >
          ⚙ 设置
        </button>

        {/* Window controls */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleMinimize}
          className="h-7 px-2 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="6" width="8" height="2" rx="0.5"/></svg>
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleMaximize}
          className="h-7 px-2 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          {isMaximized ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="1.5" y="3.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="4.5" y="1.5" width="8" height="8" rx="1" fill="rgba(28,28,30,0.98)" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          )}
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          className="h-7 px-2 rounded-md text-white/50 hover:text-white hover:bg-red-500/80 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
        </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {sidebarCollapsed ? (
          <div
            className="flex flex-col items-center py-2.5 gap-2 flex-shrink-0 select-none"
            style={{ width: 36, background: colors.bgSidebar, borderRight: `1px solid ${colors.borderLight}` }}
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              title="展开侧边栏"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M5 3l5 4-5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              onClick={() => { setActiveTab('active'); setSidebarCollapsed(false); }}
              className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-semibold transition-colors"
              style={{ color: activeTab === 'active' ? colors.accentHover : colors.textMuted }}
              title="活跃"
            >{sortedActive.length}</button>
            <button
              onClick={() => { setActiveTab('idle'); setSidebarCollapsed(false); }}
              className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-semibold transition-colors"
              style={{ color: activeTab === 'idle' ? colors.accentHover : colors.textMuted }}
              title="空闲"
            >{idle.length}</button>
            <button
              onClick={() => { setActiveTab('history'); setSidebarCollapsed(false); }}
              className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-semibold transition-colors"
              style={{ color: activeTab === 'history' ? colors.accentHover : colors.textMuted }}
              title="历史"
            >{historySessions.length}</button>
          </div>
        ) : (
        <div
          className="flex flex-col flex-shrink-0"
          style={{ width: SIDEBAR_WIDTH, background: colors.bgSidebar, borderRight: `1px solid ${colors.borderLight}` }}
        >
          {/* Tabs */}
          <div className="flex gap-1 px-2 pt-2.5">
            {(['active', 'idle', 'history'] as const).map(tab => {
              const count = tab === 'active' ? sortedActive.length : tab === 'idle' ? idle.length : historySessions.length;
              return (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); setKbNavIndex(-1); }}
                  className="flex-1 h-7 rounded-md text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                  style={{
                    color: activeTab === tab ? colors.textPrimary : colors.textMuted,
                    background: activeTab === tab ? colors.bgCardHover : 'transparent',
                    boxShadow: activeTab === tab ? `inset 0 -2px 0 ${colors.accentPrimary}` : undefined,
                    borderRadius: activeTab === tab ? '7px 7px 0 0' : '7px',
                  }}
                >
                  {tab === 'active' ? '活跃' : tab === 'idle' ? '空闲' : '历史'}
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{
                      background: activeTab === tab ? `${colors.accentPrimary}33` : colors.bgCardHover,
                      color: activeTab === tab ? colors.accentHover : colors.textMuted,
                    }}
                  >{count}</span>
                </button>
              );
            })}
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors flex-shrink-0"
              title="收起侧边栏"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M7.5 3l-4 3 4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="relative mx-2 mt-1.5 mb-1">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7.5 7.5L10.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input
              id="desktop-search"
              type="text"
              placeholder="搜索会话..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setKbNavIndex(-1); }}
              className="w-full pl-7 pr-10 py-1.5 rounded-md text-xs outline-none transition-colors"
              style={{
                background: colors.bgInput,
                border: `1px solid ${colors.bgInputBorder}`,
                color: colors.textPrimary,
              }}
              onFocus={e => (e.target.style.borderColor = colors.accentPrimary)}
              onBlur={e => (e.target.style.borderColor = colors.bgInputBorder)}
            />
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] px-1 py-0.5 rounded"
              style={{ color: colors.textMuted, background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}` }}
            >
              {navigator.platform.includes('Mac') ? '⌘F' : 'Ctrl+F'}
            </span>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto px-1.5 py-1" style={{ scrollbarWidth: 'thin' }}>
            {sessionNotification && (
              <div
                className="mx-1 my-1 px-2 py-1.5 rounded text-xs"
                style={{
                  background: sessionNotification.notification_type === 'started' ? 'rgba(76,175,80,0.2)' : 'rgba(244,67,54,0.2)',
                  color: sessionNotification.notification_type === 'started' ? '#4caf50' : '#f44336',
                }}
              >
                {sessionNotification.notification_type === 'started' ? `🚀 ${sessionNotification.project_name}已启动` : `⏹ ${sessionNotification.project_name}已停止`}
              </div>
            )}

            {activeTab === 'active' && (
              filteredActive.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-8">{searchQuery ? '无匹配会话' : '暂无活动会话'}</div>
              ) : (
                filteredActive.map((instance, idx) => (
                  <SidebarSessionItem
                    key={instance.session_id}
                    instance={instance}
                    isSelected={selectedSessionId === instance.session_id}
                    isKbActive={kbNavIndex === idx}
                    isPinned={pinnedSessions.has(instance.session_id)}
                    pendingPopup={pendingPopups.find(p => p.session_id === instance.session_id)}
                    onClick={() => { setSelectedSessionId(instance.session_id); setMainView('chat'); setKbNavIndex(-1); }}
                    onJump={handleJump}
                    onTogglePin={() => togglePin(instance.session_id)}
                    onClose={() => {}}
                  />
                ))
              )
            )}

            {activeTab === 'idle' && (
              filteredIdle.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-8">{searchQuery ? '无匹配会话' : '暂无空闲会话'}</div>
              ) : (
                filteredIdle.map((instance, idx) => (
                  <SidebarSessionItem
                    key={instance.session_id}
                    instance={instance}
                    isSelected={selectedSessionId === instance.session_id}
                    isKbActive={kbNavIndex === idx}
                    isPinned={pinnedSessions.has(instance.session_id)}
                    pendingPopup={pendingPopups.find(p => p.session_id === instance.session_id)}
                    onClick={() => { setSelectedSessionId(instance.session_id); setMainView('chat'); setKbNavIndex(-1); }}
                    onJump={handleJump}
                    onTogglePin={() => togglePin(instance.session_id)}
                    onClose={() => {}}
                  />
                ))
              )
            )}

            {activeTab === 'history' && (
              filteredHistory.length === 0 ? (
                <div className="text-white/30 text-xs text-center py-8">{searchQuery ? '无匹配会话' : '暂无历史会话'}</div>
              ) : (
                filteredHistory.map((instance, idx) => (
                  <SidebarSessionItem
                    key={instance.session_id}
                    instance={instance}
                    isSelected={selectedSessionId === instance.session_id}
                    isKbActive={kbNavIndex === idx}
                    isPinned={pinnedSessions.has(instance.session_id)}
                    pendingPopup={pendingPopups.find(p => p.session_id === instance.session_id)}
                    onClick={() => { setSelectedSessionId(instance.session_id); setMainView('chat'); setKbNavIndex(-1); }}
                    onJump={handleJump}
                    onTogglePin={() => togglePin(instance.session_id)}
                    onClose={() => {}}
                  />
                ))
              )
            )}
          </div>

          {/* Sidebar footer */}
          <div className="flex items-center gap-2 px-2.5 py-2 border-t border-white/5">
            <div
              className="flex items-center justify-center font-bold text-white"
              style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #6366f1, #a855f7)', fontSize: 11 }}
            >
              {(productName || 'C').charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-white/40">{productName || 'CC-Island'}</span>
            <span className="text-[10px] text-white/20 ml-auto">v0.3.9</span>
          </div>
        </div>
        )}

        {/* Main Area */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#0d0d14' }}>
          {mainView === 'welcome' && (
            <WelcomeView
              productName={productName}
              models={models}
              historySessions={historySessions}
              onSelectSession={handleViewChat}
              onSessionCreated={async () => {
                try {
                  const historyData = await invoke<ClaudeInstance[]>('get_history_sessions');
                  setHistorySessions(historyData);
                } catch (e) { console.error(e); }
              }}
            />
          )}

          {mainView === 'chat' && selectedSessionId && selectedInstance && (
            <>
              {showPermCard ? (
                /* Permission card overlay */
                <div className="flex-1 flex flex-col relative overflow-hidden">
                  <div className="flex-1 flex flex-col overflow-hidden" style={{ opacity: 0.25, pointerEvents: 'none', filter: 'blur(1px)' }}>
                    <ChatWithTimeline
                      instance={selectedInstance}
                      sessionId={selectedSessionId}
                      onJump={handleJump}
                      onDismissPerm={() => setPermDismissed(prev => new Set(prev).add(selectedSessionId))}
                    />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center p-10" style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 100%)' }}>
                    <PermissionCard
                      popup={selectedPopup}
                      projectName={selectedInstance.project_name}
                      onAllow={async () => {
                        try { await invoke('respond_popup', { popupId: selectedPopup.id, decision: 'allow', answer: null, answers: null }); } catch (e) { console.error(e); }
                        setPermDismissed(prev => new Set(prev).add(selectedSessionId));
                      }}
                      onDeny={async () => {
                        try { await invoke('respond_popup', { popupId: selectedPopup.id, decision: 'deny', answer: null, answers: null }); } catch (e) { console.error(e); }
                        setPermDismissed(prev => new Set(prev).add(selectedSessionId));
                      }}
                      onDismiss={() => setPermDismissed(prev => new Set(prev).add(selectedSessionId))}
                    />
                  </div>
                </div>
              ) : (
                <ChatWithTimeline
                  instance={selectedInstance}
                  sessionId={selectedSessionId}
                  onJump={handleJump}
                  onDismissPerm={() => setPermDismissed(prev => new Set(prev).add(selectedSessionId))}
                />
              )}
            </>
          )}

          {mainView === 'settings' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div
                className="flex items-center px-3.5 gap-2.5 flex-shrink-0"
                style={{ height: 46, borderBottom: `1px solid ${colors.borderLight}` }}
              >
                <button onClick={() => setMainView('welcome')} className="flex items-center justify-center w-8 h-8 text-white/50 hover:text-white/80 transition-colors">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
                  </svg>
                </button>
                <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>设置</span>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <SettingsModal isOpen={true} onClose={() => setMainView('welcome')} className="flex-1 min-h-0" hideHeader onSettingsChange={() => {
                  invoke<HooksCheckResult>('check_claude_hooks').then(setHooksCheckResult).catch(console.error);
                }} />
              </div>
            </div>
          )}

          {mainView === 'hooksSetup' && hooksCheckResult && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div
                className="flex items-center px-3.5 gap-2.5 flex-shrink-0"
                style={{ height: 46, borderBottom: `1px solid ${colors.borderLight}` }}
              >
                <button onClick={() => setMainView('welcome')} className="flex items-center justify-center w-8 h-8 text-white/50 hover:text-white/80 transition-colors">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
                  </svg>
                </button>
                <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>Hooks 配置</span>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <HooksSetupModal result={hooksCheckResult} onComplete={() => setMainView('welcome')} className="flex-1 min-h-0" hideHeader />
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateSessionModal models={models} onClose={() => setShowCreateModal(false)} onCreated={() => {
          invoke<ClaudeInstance[]>('get_history_sessions').then(setHistorySessions).catch(() => {});
        }} />
      )}

    </div>
  );
}

// Layout C: Chat messages + right activity timeline
function ChatWithTimeline({
  instance,
  sessionId,
  onJump,
  onDismissPerm,
}: {
  instance: ClaudeInstance;
  sessionId: string;
  onJump: (sessionId: string) => void;
  onDismissPerm: () => void;
}) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const activities = instance.activities || [];
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const st = instance.status.type;
  const stText: Record<string, string> = {
    working: '工作中', thinking: '思考中', compacting: '思考中',
    waiting: '等待中', waitingforapproval: '需要授权', idle: '就绪', ended: '已结束',
  };

  const pendingPopup = instance.status.type === 'waitingforapproval';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat header - project name + status + actions */}
      <div className="flex items-center px-3.5 gap-2.5 flex-shrink-0" style={{ height: 46, borderBottom: `1px solid ${colors.borderLight}` }}>
        <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>{instance.project_name || 'Chat'}</span>
        <span
          className="text-[11px] px-2 py-0.5 rounded-full"
          style={{
            background: st === 'working' ? 'rgba(245,158,11,0.12)' : st === 'thinking' || st === 'compacting' ? 'rgba(139,92,246,0.12)' : st === 'waitingforapproval' ? 'rgba(239,68,68,0.12)' : st === 'ended' ? colors.bgCard : colors.bgCardHover,
            color: st === 'working' ? '#f59e0b' : st === 'thinking' || st === 'compacting' ? '#8b5cf6' : st === 'waitingforapproval' ? '#ef4444' : st === 'ended' ? colors.textMuted : colors.textMuted,
          }}
        >
          {stText[st] || ''}
        </span>
        <div style={{ flex: 1 }} />
        {!instance.status.type.includes('ended') && (
          <button
            onClick={() => onJump(sessionId)}
            className="h-6 px-2.5 rounded-md text-xs transition-colors flex items-center gap-1"
            style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.18)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.1)')}
          >
            ↗ 跳转终端
          </button>
        )}
        {pendingPopup && (
          <button
            onClick={onDismissPerm}
            className="w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
            title="关闭（在终端中回答）"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Chat + Timeline split */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ChatView
            sessionId={sessionId}
            projectName={instance.project_name || 'Unknown'}
          />
        </div>

        {/* Right activity timeline */}
        {activities.length > 0 && (
          timelineCollapsed ? (
            <div
              className="flex-shrink-0 flex flex-col items-center pt-2.5 border-l border-white/5 select-none"
              style={{ width: 30, background: 'rgba(0,0,0,0.12)' }}
            >
              <button
                onClick={() => setTimelineCollapsed(false)}
                className="w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                title="展开命令历史"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <span className="text-[9px] text-white/20 mt-2" style={{ writingMode: 'vertical-rl' }}>历史</span>
            </div>
          ) : (
            <div
              className="flex-shrink-0 overflow-y-auto border-l border-white/5"
              style={{ width: 200, background: colors.statsBarBg, scrollbarWidth: 'thin' }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider px-3 py-2.5 flex items-center gap-1.5" style={{ color: colors.textMuted }}>
                📋 命令历史
                <button
                  onClick={() => setTimelineCollapsed(true)}
                  className="ml-auto w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/10 transition-colors"
                  title="收起命令历史"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M6.5 2l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              {activities.map((act, idx) => (
                <ActivityTimelineItem key={act.id || idx} activity={act} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Stdin input bar — only for active sessions */}
      {!instance.status.type.includes('ended') && (
        <StdinInputBar cwd={instance.session_cwd || ''} projectName={instance.project_name} />
      )}
    </div>
  );
}

function StdinInputBar({ cwd, projectName }: { cwd: string; projectName: string }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  const send = async () => {
    if (!text.trim() || !cwd) return;
    setSending(true);
    try {
      await invoke('send_claude_input', { cwd, text: text + '\n' });
      setText('');
      setStatus('sent');
      setTimeout(() => setStatus('idle'), 1200);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    } finally {
      setSending(false);
    }
  };

  if (!cwd) return null;

  return (
    <div
      className="flex items-center gap-2 px-3.5 py-2 flex-shrink-0"
      style={{ borderTop: `1px solid ${colors.borderLight}`, background: colors.statsBarBg }}
    >
      <span className="text-[10px] flex-shrink-0" style={{ color: colors.textMuted }}>stdin → {projectName}</span>
      <input
        type="text" value={text} onChange={e => setText(e.target.value)}
        placeholder="输入内容发送到 Claude..."
        className="flex-1 px-3 py-1.5 rounded-md text-xs outline-none"
        style={{
          background: colors.bgInput,
          border: `1px solid ${colors.bgInputBorder}`,
          color: colors.textPrimary,
        }}
        onKeyDown={e => { if (e.key === 'Enter') send(); }}
      />
      <button
        onClick={send}
        disabled={sending || !text.trim()}
        className="px-3 py-1.5 rounded-md text-xs font-medium transition-all flex-shrink-0"
        style={{
          background: status === 'sent' ? 'rgba(16,185,129,0.15)' : status === 'error' ? 'rgba(239,68,68,0.15)' : 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
          color: status === 'sent' ? '#10b981' : status === 'error' ? '#ef4444' : '#f1f5f9',
          opacity: sending || !text.trim() ? 0.4 : 1,
          cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        {status === 'sent' ? '已发送' : status === 'error' ? '失败' : sending ? '...' : '发送'}
      </button>
    </div>
  );
}

function ActivityTimelineItem({ activity }: { activity: ToolActivityDetail }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const itemRef = useRef<HTMLDivElement>(null);

  const icon = TOOL_ICONS[activity.tool_name] || '⚙';
  const time = formatTime(activity.timestamp);
  const statusIcon = activity.status === 'success' ? '✓' : activity.status === 'error' ? '✗' : '●';
  const statusColor = activity.status === 'success' ? '#10b981' : activity.status === 'error' ? '#ef4444' : '#4caf50';
  const durationText = activity.duration_ms != null ? formatDurationMs(activity.duration_ms) : null;

  const handleMouseEnter = () => {
    setShowPopover(true);
    // Defer measurement to next frame so layout is settled
    requestAnimationFrame(() => {
      if (!itemRef.current) return;
      const rect = itemRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popoverW = 300;
      const popoverH = 180; // estimated
      const gap = 6;

      let left: number;
      if (rect.right + popoverW + gap <= vw) {
        left = rect.right + gap; // right side
      } else if (rect.left - popoverW - gap >= 0) {
        left = rect.left - popoverW - gap; // left side
      } else {
        left = Math.max(0, rect.right + gap); // fallback: right, clamped
      }

      let top = rect.top;
      if (top + popoverH > vh) {
        top = Math.max(0, vh - popoverH - 8);
      }

      setPopoverStyle({
        position: 'fixed',
        left,
        top,
        zIndex: 9999,
      });
    });
  };

  return (
    <>
      <div
        ref={itemRef}
        className="flex flex-col gap-0.5 px-2 py-1.5 text-[11px] cursor-default transition-colors"
        style={{ borderBottom: `1px solid ${colors.borderLight}` }}
        onMouseEnter={e => { handleMouseEnter(); e.currentTarget.style.background = colors.bgCard; }}
        onMouseLeave={e => { setShowPopover(false); e.currentTarget.style.background = 'transparent'; }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#64748b] flex-shrink-0 w-6">{time.slice(0, 5)}</span>
          <span className="text-xs flex-shrink-0">{icon}</span>
          <span className="text-[#f59e0b] font-medium truncate">{activity.tool_name}</span>
          {durationText && (
            <span className="text-[10px] text-[#64748b] flex-shrink-0 ml-auto mr-1">{durationText}</span>
          )}
          <span className="text-[10px] flex-shrink-0" style={{ color: statusColor }}>{statusIcon}</span>
        </div>
        {activity.content && (
          <div className="text-[#94a3b8] truncate" style={{ paddingLeft: 56 }}>{activity.content.slice(0, 40)}</div>
        )}
      </div>

      {showPopover && (
        <div
          className="pointer-events-none rounded-lg p-3"
          style={{
            background: colors.bgTitlebar,
            border: `1px solid ${colors.borderMedium}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            fontSize: 11,
            minWidth: 280,
            maxWidth: 380,
            ...popoverStyle,
          }}
          onMouseEnter={() => setShowPopover(true)}
          onMouseLeave={() => setShowPopover(false)}
        >
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
            <span className="text-base">{icon}</span>
            <span className="text-[#f59e0b] font-semibold text-xs">{activity.tool_name}</span>
            <span className="text-[10px] ml-auto" style={{ color: statusColor }}>
              {activity.status === 'success' ? '✓ 成功' : activity.status === 'error' ? '✗ 失败' : '● 运行中'}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex gap-2.5"><span className="flex-shrink-0 w-8 text-right text-[10px]" style={{ color: colors.textMuted }}>时间</span><span style={{ color: colors.textSecondary }}>{time}</span></div>
            {durationText && (
              <div className="flex gap-2.5"><span className="flex-shrink-0 w-8 text-right text-[10px]" style={{ color: colors.textMuted }}>耗时</span><span className="text-[#f59e0b] font-mono">{durationText}</span></div>
            )}
            <div className="flex gap-2.5"><span className="flex-shrink-0 w-8 text-right text-[10px]" style={{ color: colors.textMuted }}>内容</span><span className="text-[#94a3b8] break-all leading-relaxed">{activity.content || '无'}</span></div>
            {activity.result && (
              <div className="flex gap-2.5"><span className="flex-shrink-0 w-8 text-right text-[10px]" style={{ color: colors.textMuted }}>结果</span><span className={`break-all leading-relaxed font-mono text-[10px] ${activity.status === 'error' ? 'text-[#ef4444]' : 'text-[#94a3b8]'}`} style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflowY: 'auto' }}>{activity.result}</span></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Permission request overlay card
function PermissionCard({
  popup, projectName, onAllow, onDeny, onDismiss,
}: {
  popup: PopupItem;
  projectName: string;
  onAllow: () => void;
  onDeny: () => void;
  onDismiss: () => void;
}) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const toolName = popup.permission_data?.tool_name || 'Unknown';
  const action = popup.permission_data?.action || '执行操作';

  // Calculate remaining time if there's a timeout
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const totalTime = 300;

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) onDeny();
  }, [timeLeft]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const pct = (timeLeft / totalTime) * 100;

  return (
    <div className="max-w-md w-full">
      <div
        className="p-4 rounded-xl"
        style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.25)',
        }}
      >
        {/* Header with dismiss button */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-start gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
              style={{ background: 'rgba(239,68,68,0.15)' }}
            >⏳</div>
            <div>
              <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>权限请求</div>
              <div className="text-[11px]" style={{ color: colors.textMuted }}>{projectName} · {toolName}</div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
            style={{ background: colors.bgCardHover }}
            title="关闭（在终端中回答）"
          >✕</button>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-1 text-[#f59e0b] text-[10px] mb-2.5">
          ⏱ 剩余 {timeStr} · 超时后自动拒绝
        </div>

        {/* Body */}
        <div
          className="rounded-md px-3 py-2 mb-2.5 font-mono text-[11px]"
          style={{ color: colors.textSecondary, background: 'rgba(0,0,0,0.25)', whiteSpace: 'pre-wrap' }}
        >
          {'工具: ' + toolName + '\n操作: ' + action}
          {popup.permission_data?.details ? `\n详情: ${popup.permission_data.details}` : ''}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onDeny}
            className="flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
          >拒绝</button>
          <button
            onClick={onAllow}
            className="flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors"
            style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.25)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.15)')}
          >允许</button>
        </div>

        {/* Expiry bar */}
        <div className="h-1 rounded-sm mt-2 overflow-hidden" style={{ background: colors.bgCardHover }}>
          <div
            className="h-full rounded-sm transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${timeLeft > 150 ? '#f59e0b' : '#ef4444'}, #ef4444)` }}
          />
        </div>

        {/* Dismiss hint */}
        <div className="text-center mt-3 text-[11px] text-[#64748b]">
          已在终端中回答？
          <span onClick={onDismiss} className="text-[#60a5fa] cursor-pointer underline ml-1">关闭此提示</span>
        </div>
      </div>
    </div>
  );
}

// Compact sidebar session item matching preview-desktop-ui.html design
function SidebarSessionItem({
  instance, isSelected, isKbActive, isPinned, pendingPopup, onClick, onJump, onTogglePin, onClose,
}: {
  instance: ClaudeInstance;
  isSelected: boolean;
  isKbActive: boolean;
  isPinned: boolean;
  pendingPopup?: PopupItem;
  onClick: () => void;
  onJump: (sessionId: string) => void;
  onTogglePin: () => void;
  onClose: () => void;
}) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const getStatusDot = () => {
    if (pendingPopup) return { bg: '#ef4444', shadow: '0 0 6px rgba(239,68,68,0.5)', cls: 'approval' };
    switch (instance.status.type) {
      case 'working': return { bg: '#f59e0b', shadow: '0 0 6px rgba(245,158,11,0.5)', cls: 'working' };
      case 'thinking': case 'compacting': return { bg: '#8b5cf6', shadow: '0 0 6px rgba(139,92,246,0.5)', cls: 'thinking' };
      case 'waiting': case 'waitingforapproval': return { bg: '#60a5fa', shadow: undefined, cls: 'waiting' };
      case 'idle': return { bg: colors.textMuted, shadow: undefined, cls: 'idle' };
      default: return { bg: colors.bgCardHover, shadow: undefined, cls: 'ended' };
    }
  };
  const dot = getStatusDot();
  const isEnded = instance.status.type === 'ended';

  // Status meta text (like "工作中", "思考中...")
  const metaText = (() => {
    if (pendingPopup) return '⚠ 需要授权';
    switch (instance.status.type) {
      case 'working': return instance.current_tool || '工作中';
      case 'thinking': case 'compacting': return '思考中…';
      case 'waiting': case 'waitingforapproval': return '等待中';
      case 'idle': return '就绪';
      default: return '';
    }
  })();

  const metaColor = pendingPopup ? '#ef4444'
    : instance.status.type === 'working' ? '#f59e0b'
    : instance.status.type === 'thinking' || instance.status.type === 'compacting' ? '#8b5cf6'
    : colors.textMuted;

  // Notification count from pending popups
  const notifyCount = pendingPopup ? 1 : 0;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors mb-px relative group"
      style={{
        background: isSelected ? `${colors.accentPrimary}22` : isKbActive ? `${colors.accentPrimary}22` : isPinned ? `${colors.accentPrimary}11` : 'transparent',
        borderLeft: isSelected ? `2px solid ${colors.accentPrimary}` : '2px solid transparent',
        outline: isKbActive ? `1px solid ${colors.accentPrimary}55` : undefined,
        outlineOffset: -1,
      }}
      onMouseEnter={e => { if (!isSelected && !isKbActive) e.currentTarget.style.background = colors.bgCardHover; }}
      onMouseLeave={e => { if (!isSelected && !isKbActive) e.currentTarget.style.background = isPinned ? `${colors.accentPrimary}11` : 'transparent'; }}
    >
      {pendingPopup && (
        <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
      )}

      {/* Pin marker */}
      {isPinned && <span className="text-[8px] mr-0 flex-shrink-0">📌</span>}

      {/* Status dot */}
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot.cls === 'thinking' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: dot.bg, boxShadow: dot.shadow }}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-medium truncate" style={{ color: isSelected ? colors.textPrimary : colors.textSecondary }}>
            {instance.project_name || 'Unknown'}
          </span>
          {instance.first_prompt && (
            <span className="text-[10px] text-white/30 truncate hidden sm:inline" title={instance.first_prompt}>
              · {instance.first_prompt}
            </span>
          )}
          {notifyCount > 0 && (
            <span
              className="flex-shrink-0 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1"
              style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.4)' }}
            >{notifyCount > 99 ? '99+' : notifyCount}</span>
          )}
        </div>
        <div className="text-[10px] mt-0.5 flex items-center gap-1.5" style={{ minHeight: 15 }}>
          {metaText ? <span style={{ color: metaColor, fontSize: 10 }}>{metaText}</span> : <span>&nbsp;</span>}
        </div>
      </div>

      {/* Time - hidden on hover */}
      <span className="text-[10px] text-[#64748b] flex-shrink-0 group-hover:hidden">
        {relativeTime(instance.last_activity_at)}
      </span>

      {/* Hover actions */}
      <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
        <button
          onClick={e => { e.stopPropagation(); onTogglePin(); }}
          className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${isPinned ? 'text-[#8b5cf6] bg-[rgba(124,58,237,0.15)]' : 'text-white/40 hover:text-[#8b5cf6] hover:bg-[rgba(124,58,237,0.2)]'}`}
          title={isPinned ? '取消置顶' : '置顶'}
        >📌</button>
        {!isEnded && (
          <button
            onClick={e => { e.stopPropagation(); onJump(instance.session_id); }}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/40 hover:text-blue-400 hover:bg-blue-500/20 transition-colors"
            title="跳转终端"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1" y="2" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M3 4l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/20 transition-colors"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
