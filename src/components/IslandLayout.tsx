// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../stores/appStore';
import { useDisplayStore } from '../stores/displayStore';
import { InstanceList } from './InstanceList';
import { SettingsModal, HooksSetupModal } from './Settings';
import { ChatView } from './ChatView';
import { ClaudeCrabIcon, ProcessingSpinner, PermissionIndicatorIcon, MenuIcon } from './StatusIcons';
import { getCornerRadii, generateNotchPath } from './NotchShape';
import { ClaudeInstance, PopupItem, HooksCheckResult, SessionNotification } from '../types';

const COLLAPSED_WIDTH = 300;
const COLLAPSED_HEIGHT = 38;
const EXPANDED_WIDTH = 480;
const EXPANDED_HEIGHT = 400;
const MODAL_WIDTH = 480;
const MODAL_HEIGHT = 400;

const openAnimation = { type: 'spring', stiffness: 344, damping: 25 };
const closeAnimation = { type: 'spring', stiffness: 320, damping: 30 };

export function IslandLayout() {
  const {
    instances, popups, isExpanded, setIsExpanded,
    setInstances, setPopups, setHistorySessions,
    isDesktopWindowOpen, setDesktopWindowOpen,
  } = useAppStore();
  const { headerDisplay, updateDisplays } = useDisplayStore();
  const [showSettings, setShowSettings] = useState(false);
  const [hooksCheckResult, setHooksCheckResult] = useState<HooksCheckResult | null>(null);
  const [showHooksSetup, setShowHooksSetup] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [productName, setProductName] = useState<string>('');
  const [sessionNotification, setSessionNotification] = useState<SessionNotification | null>(null);
  const [cloudStatus, setCloudStatus] = useState<{ connected: boolean; connecting: boolean; failed: boolean; failedReason: string }>({ connected: false, connecting: false, failed: false, failedReason: '' });

  const hoverExpandTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCollapseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (hoverCollapseTimeout.current) {
      clearTimeout(hoverCollapseTimeout.current);
      hoverCollapseTimeout.current = null;
    }
    if (!isExpanded && !selectedSessionId && !showSettings && !showHooksSetup) {
      hoverExpandTimeout.current = setTimeout(() => setIsExpanded(true), 150);
    }
  };

  const handleMouseLeave = () => {
    if (hoverExpandTimeout.current) {
      clearTimeout(hoverExpandTimeout.current);
      hoverExpandTimeout.current = null;
    }
    if (isExpanded && !selectedSessionId && !showSettings && !showHooksSetup) {
      hoverCollapseTimeout.current = setTimeout(() => setIsExpanded(false), 200);
    }
  };

  const handleDrag = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    try { await invoke('start_drag'); } catch (err) { console.error('Failed to start drag:', err); }
  };

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (hoverExpandTimeout.current) clearTimeout(hoverExpandTimeout.current);
      if (hoverCollapseTimeout.current) clearTimeout(hoverCollapseTimeout.current);
    };
  }, []);

  // Check hooks configuration on startup
  useEffect(() => {
    const checkHooks = async () => {
      try {
        const result = await invoke<HooksCheckResult>('check_claude_hooks');
        setHooksCheckResult(result);
        if (result.missing_required.length > 0) setShowHooksSetup(true);
      } catch (e) { console.error('Failed to check hooks:', e); }
    };
    checkHooks();
  }, []);

  // Get product name
  useEffect(() => {
    const fetchProductName = async () => {
      try {
        const name = await invoke<string>('get_product_name');
        setProductName(name);
      } catch (e) { console.error('Failed to get product name:', e); setProductName('CC-Island'); }
    };
    fetchProductName();
  }, []);

  // Listen for desktop-window-state events
  useEffect(() => {
    const unlisten = listen<boolean>('desktop-window-state', (event) => {
      setDesktopWindowOpen(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Listen for popup-resolved events (instant refresh)
  useEffect(() => {
    const unlisten = listen<{
      popup_id: string;
      session_id: string;
      decision?: string;
      answers?: string[][];
    }>('popup-resolved', async () => {
      try {
        const [instancesData, popupsData] = await Promise.all([
          invoke<ClaudeInstance[]>('get_instances'),
          invoke<PopupItem[]>('get_popups'),
        ]);
        setInstances(instancesData);
        setPopups(popupsData);
      } catch (e) { console.error('Failed to refresh after popup resolved:', e); }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Window blur to collapse
  useEffect(() => {
    const handleBlur = () => {
      setTimeout(() => {
        if (!document.hasFocus()) {
          setSelectedSessionId(null);
          setShowSettings(false);
          setShowHooksSetup(false);
          setIsExpanded(false);
        }
      }, 100);
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  // Fetch data periodically
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
        } else if (typeof cloudStatusRaw === 'string') {
          isConnected = cloudStatusRaw === 'Connected';
          isConnecting = cloudStatusRaw === 'Connecting';
        }
        setCloudStatus({ connected: isConnected, connecting: isConnecting, failed: isFailed, failedReason });
        updateDisplays(instancesData);
      } catch (e) { console.error('Failed to fetch data:', e); }
    };

    fetchData();
    const interval = setInterval(fetchData, 100);
    return () => clearInterval(interval);
  }, [setInstances, setPopups, updateDisplays]);

  // Clear session notification after display
  useEffect(() => {
    if (sessionNotification) {
      const timer = setTimeout(() => setSessionNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [sessionNotification]);

  const activeInstances = instances.filter(i => i.status.type !== 'ended');
  const { phase: headerPhase, text: headerText } = headerDisplay;
  const isAnimating = headerPhase === 'processing' || headerPhase === 'waitingForApproval';
  const showIndicator = headerPhase === 'waitingForApproval';

  const showExpanded = isExpanded && !selectedSessionId;
  const showChatView = selectedSessionId !== null;

  const selectedInstance = selectedSessionId
    ? instances.find(i => i.session_id === selectedSessionId)
    : null;

  const targetWidth = showExpanded || showChatView ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const targetHeight = showExpanded || showChatView ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  // Resize window
  useEffect(() => {
    const resizeWindow = async () => {
      try {
        await invoke('set_always_on_top', { alwaysOnTop: true });
        await invoke('set_skip_taskbar', { skip: true });
      } catch (e) { console.error('Failed to set island window props:', e); }

      if (showSettings || showHooksSetup) {
        try { await invoke('resize_window', { width: MODAL_WIDTH, height: MODAL_HEIGHT }); } catch (e) {}
        return;
      }
      if (selectedSessionId) {
        try { await invoke('resize_window', { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }); } catch (e) {}
        return;
      }
      const w = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
      const h = isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
      try { await invoke('resize_window', { width: w, height: h }); } catch (e) {}
    };
    resizeWindow();
  }, [isExpanded, showSettings, showHooksSetup, selectedSessionId, headerPhase]);

  const isOpen = showExpanded;
  const corners = getCornerRadii(isOpen);
  const notchPath = generateNotchPath(targetWidth, targetHeight, corners.top, corners.bottom);

  const handleRespond = async (popupId: string, decision?: string, answer?: string, answers?: string[][]) => {
    try { await invoke('respond_popup', { popupId, decision, answer, answers }); } catch (e) { console.error('Response failed:', e); }
  };

  const handleJump = async (sessionId: string) => {
    try { await invoke('jump_to_instance', { sessionId }); } catch (e) { console.error('Jump failed:', e); }
  };

  const handleViewChat = (sessionId: string) => setSelectedSessionId(sessionId);
  const handleViewAsk = (sessionId: string) => setSelectedSessionId(sessionId);

  const handleSettingsChange = async () => {
    try {
      const result = await invoke<HooksCheckResult>('check_claude_hooks');
      setHooksCheckResult(result);
    } catch (e) { console.error('Failed to refresh hooks:', e); }
  };

  // Open desktop window
  const handleOpenDesktop = async () => {
    try { await invoke('open_desktop_window'); } catch (e) { console.error('Failed to open desktop:', e); }
  };

  return (
    <div className="w-screen h-screen flex flex-col items-center pt-0 pointer-events-none">
      <motion.div
        initial={false}
        animate={{ width: targetWidth, height: targetHeight }}
        transition={showExpanded ? openAnimation : closeAnimation}
        className="relative overflow-hidden flex flex-col pointer-events-auto"
        style={{ transformOrigin: 'center top' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* SVG Notch Shape */}
        <svg
          width={targetWidth} height={targetHeight}
          viewBox={`0 0 ${targetWidth} ${targetHeight}`}
          preserveAspectRatio="none"
          className="absolute inset-0 pointer-events-none" style={{ zIndex: -1 }}
        >
          <motion.path
            d={notchPath} fill="black"
            initial={false}
            animate={{ d: notchPath }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        </svg>

        {/* Header */}
        <motion.div
          className={`flex items-center flex-shrink-0 ${showExpanded ? 'px-6' : 'px-3'}`}
          style={{ height: COLLAPSED_HEIGHT }}
          onMouseDown={handleDrag}
        >
          <div className="flex items-center gap-1.5 w-10 flex-shrink-0">
            <ClaudeCrabIcon size={16} animateLegs={isAnimating} />
            {!showExpanded && showIndicator && <PermissionIndicatorIcon size={14} />}
          </div>

          <div className="flex-1 flex items-center justify-center overflow-hidden mx-2 min-w-0">
            {showChatView ? (
              <span className="text-white/70 text-xs font-medium truncate">
                {selectedInstance?.project_name || 'Chat'}
              </span>
            ) : headerText ? (
              <span className="text-white/70 text-xs font-medium truncate">{headerText}</span>
            ) : showExpanded ? (
              <span className="text-white/70 text-xs font-medium truncate">{productName}</span>
            ) : sessionNotification ? (
              <span className="text-white/70 text-xs font-medium truncate">
                {sessionNotification.notification_type === 'started'
                  ? `${sessionNotification.project_name}已启动`
                  : `${sessionNotification.project_name}已停止`}
              </span>
            ) : <div />}
          </div>

          <div className="flex items-center justify-end gap-1.5 w-12 flex-shrink-0">
            {showChatView ? (
              <div />
            ) : showExpanded ? (
              <>
                <div
                  className="flex items-center justify-center"
                  title={cloudStatus.connected ? '云服务已连接' : cloudStatus.connecting ? '正在连接...' : cloudStatus.failed ? `连接失败: ${cloudStatus.failedReason}` : '未连接'}
                >
                  {cloudStatus.connected ? <span className="text-green-400 text-xs">☁</span>
                  : cloudStatus.connecting ? <span className="text-yellow-400 text-xs animate-pulse">☁</span>
                  : <span className="text-white/30 text-xs">☁</span>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSettings(true); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="text-white/40 hover:text-white/70 transition-colors p-1"
                ><MenuIcon size={14} /></button>
                {/* Desktop window button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleOpenDesktop(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="text-white/40 hover:text-white/70 transition-colors p-1"
                  title="打开桌面窗口"
                  style={{ color: isDesktopWindowOpen ? '#a855f7' : undefined }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="1" y="1" width="12" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/>
                    <line x1="4" y1="11" x2="4" y2="13" stroke="currentColor" strokeWidth="1.2"/>
                    <line x1="10" y1="11" x2="10" y2="13" stroke="currentColor" strokeWidth="1.2"/>
                    <line x1="2" y1="13" x2="12" y2="13" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                </button>
              </>
            ) : (
              <>
                {headerPhase === 'idle' ? (
                  <ProcessingSpinner size={14} animated={false} />
                ) : headerPhase === 'waitingForApproval' ? (
                  <ProcessingSpinner size={14} animated={true} />
                ) : (
                  <ProcessingSpinner size={14} animated={true} />
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Expanded content */}
        <AnimatePresence>
          {showExpanded && !showSettings && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-5 pb-3 overflow-hidden w-full rounded-b-xl"
            >
              <div className="max-h-[360px] overflow-y-auto scrollbar-thin w-full rounded-b-xl">
                {(activeInstances.length > 0 || useAppStore.getState().historySessions.length > 0) && (
                  <InstanceList
                    instances={activeInstances}
                    popups={popups.filter(p => p.status === 'pending')}
                    onJump={handleJump}
                    onViewChat={handleViewChat}
                    onRespond={handleRespond}
                    onViewAsk={handleViewAsk}
                  />
                )}
                {activeInstances.length === 0 && useAppStore.getState().historySessions.length === 0 && (
                  <div className="text-white/30 text-xs text-center py-4">No active sessions</div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ChatView */}
        <AnimatePresence>
          {showChatView && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-5 pb-3 overflow-hidden w-full rounded-b-xl"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="h-[360px] overflow-hidden w-full rounded-b-xl">
                <ChatView
                  sessionId={selectedSessionId!}
                  projectName={selectedInstance?.project_name || 'Unknown'}
                  onClose={() => { setSelectedSessionId(null); setIsExpanded(true); }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-5 pb-3 overflow-hidden w-full rounded-b-xl"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="h-[360px] overflow-hidden w-full rounded-b-xl">
                <SettingsModal
                  isOpen={showSettings}
                  onClose={() => { setShowSettings(false); setIsExpanded(true); }}
                  onSettingsChange={handleSettingsChange}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hooks Setup */}
        <AnimatePresence>
          {showHooksSetup && hooksCheckResult && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-5 pb-3 overflow-hidden w-full rounded-b-xl"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="h-[360px] overflow-hidden w-full rounded-b-xl">
                <HooksSetupModal
                  result={hooksCheckResult}
                  onComplete={() => { setShowHooksSetup(false); handleSettingsChange(); }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
