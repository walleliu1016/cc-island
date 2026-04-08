import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './stores/appStore';
import { InstanceList } from './components/InstanceList';
import { PopupCard } from './components/PopupList';
import { SettingsModal, HooksSetupModal } from './components/Settings';
import { ClaudeInstance, PopupItem, HooksCheckResult, ToolActivity } from './types';

// Window sizes
const COLLAPSED_WIDTH = 360;
const COLLAPSED_HEIGHT = 50;
const EXPANDED_WIDTH = 420;
const EXPANDED_HEIGHT = 500;
const MODAL_WIDTH = 420;
const MODAL_HEIGHT = 550;

function App() {
  const { instances, popups, recentActivities, isExpanded, setIsExpanded, setInstances, setPopups, setRecentActivities } = useAppStore();
  const [isDragging, setIsDragging] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: string } | null>(null);
  const [autoExpandPopup, setAutoExpandPopup] = useState<PopupItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hooksCheckResult, setHooksCheckResult] = useState<HooksCheckResult | null>(null);
  const [showHooksSetup, setShowHooksSetup] = useState(false);
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDataRef = useRef({ instances: [] as ClaudeInstance[], popups: [] as PopupItem[] });

  // Check hooks configuration on startup
  useEffect(() => {
    const checkHooks = async () => {
      try {
        const result = await invoke<HooksCheckResult>('check_claude_hooks');
        setHooksCheckResult(result);
        if (result.missing_required.length > 0) {
          setShowHooksSetup(true);
        }
      } catch (e) {
        console.error('Failed to check hooks:', e);
      }
    };
    checkHooks();
  }, []);

  // Fetch data periodically
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [instancesData, popupsData, activitiesData] = await Promise.all([
          invoke<ClaudeInstance[]>('get_instances'),
          invoke<PopupItem[]>('get_popups'),
          invoke<ToolActivity[]>('get_recent_activities'),
        ]);

        const prev = prevDataRef.current;

        // 检测新工具活动
        if (activitiesData.length > 0 && prev.instances.length > 0) {
          const latestActivity = activitiesData[activitiesData.length - 1];
          const prevActivities = recentActivities;
          const isNewActivity = prevActivities.length === 0 ||
            prevActivities[prevActivities.length - 1]?.timestamp !== latestActivity.timestamp;

          if (isNewActivity) {
            setNotification({
              message: `${latestActivity.project_name}: 执行 ${latestActivity.tool_name}`,
              type: 'working'
            });
            setTimeout(() => setNotification(null), 2000);
          }
        }

        // 检测新弹窗 - 自动展开
        const prevPendingIds = prev.popups.filter(p => p.status === 'pending').map(p => p.id);
        const newPending = popupsData.filter(p =>
          p.status === 'pending' && !prevPendingIds.includes(p.id)
        );

        if (newPending.length > 0 && !autoExpandPopup) {
          setAutoExpandPopup(newPending[0]);
          const typeText = newPending[0].type === 'permission' ? '权限请求' : '问题';
          const toolInfo = newPending[0].permission_data?.tool_name || '';
          setNotification({ message: `${newPending[0].project_name}: ${typeText}${toolInfo ? ` (${toolInfo})` : ''}`, type: 'popup' });
          setTimeout(() => setNotification(null), 3000);
        }

        // 检测实例状态变化
        for (const instance of instancesData) {
          const prevInstance = prev.instances.find(i => i.session_id === instance.session_id);
          if (prevInstance && prevInstance.status !== instance.status) {
            if (instance.status === 'error') {
              setNotification({ message: `${instance.project_name}: 执行失败`, type: 'error' });
              setTimeout(() => setNotification(null), 3000);
            } else if (instance.status === 'ended') {
              setNotification({ message: `${instance.project_name}: 会话结束`, type: 'ended' });
              setTimeout(() => setNotification(null), 3000);
            }
          }
          if (!prevInstance && instance.status !== 'ended') {
            setNotification({ message: `${instance.project_name}: 新会话启动`, type: 'new' });
            setTimeout(() => setNotification(null), 3000);
          }
        }

        prevDataRef.current = { instances: instancesData, popups: popupsData };
        setInstances(instancesData);
        setPopups(popupsData);
        setRecentActivities(activitiesData);
      } catch (e) {
        console.error('Failed to fetch data:', e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 100);
    return () => clearInterval(interval);
  }, [setInstances, setPopups, setRecentActivities, autoExpandPopup, recentActivities]);

  // 当前弹窗被处理后，显示下一个
  useEffect(() => {
    if (autoExpandPopup) {
      const stillPending = popups.find(p => p.id === autoExpandPopup.id && p.status === 'pending');
      if (!stillPending) {
        const nextPending = popups.find(p => p.status === 'pending');
        if (nextPending) {
          setAutoExpandPopup(nextPending);
          const typeText = nextPending.type === 'permission' ? '权限请求' : '问题';
          const toolInfo = nextPending.permission_data?.tool_name || '';
          setNotification({ message: `${nextPending.project_name}: ${typeText}${toolInfo ? ` (${toolInfo})` : ''}`, type: 'popup' });
          setTimeout(() => setNotification(null), 3000);
        } else {
          setAutoExpandPopup(null);
        }
      }
    }
  }, [popups, autoExpandPopup]);

  // Resize window when expanded state changes
  useEffect(() => {
    const resizeWindow = async () => {
      // Modal takes precedence
      if (showSettings || showHooksSetup) {
        try {
          await invoke('resize_window', { width: MODAL_WIDTH, height: MODAL_HEIGHT });
        } catch (e) {
          console.error('Failed to resize window:', e);
        }
        return;
      }

      const isExpandedState = isExpanded || autoExpandPopup !== null;
      const targetWidth = isExpandedState ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
      const targetHeight = isExpandedState ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
      try {
        await invoke('resize_window', { width: targetWidth, height: targetHeight });
      } catch (e) {
        console.error('Failed to resize window:', e);
      }
    };
    resizeWindow();
  }, [isExpanded, autoExpandPopup, showSettings, showHooksSetup]);

  // Stats
  const activeInstances = instances.filter(i => i.status !== 'ended');
  const idleCount = instances.filter(i => i.status === 'idle').length;
  const workingCount = instances.filter(i => i.status === 'working').length;
  const waitingCount = instances.filter(i => i.status === 'waiting').length;
  const pendingPopups = popups.filter(p => p.status === 'pending');
  const totalCount = activeInstances.length;

  // 显示模式
  const showAutoExpand = autoExpandPopup !== null;
  const showHoverExpand = isExpanded && !showAutoExpand;

  // Calculate content width based on state
  const contentWidth = showAutoExpand || showHoverExpand ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  // Hover handlers
  const handleMouseEnter = () => {
    if (!isDragging && !autoExpandPopup) {
      expandTimeoutRef.current = setTimeout(() => setIsExpanded(true), 300);
    }
  };

  const handleMouseLeave = () => {
    if (expandTimeoutRef.current) {
      clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = null;
    }
    if (!autoExpandPopup) {
      setIsExpanded(false);
    }
  };

  // Drag handling
  const handleMouseDown = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    try {
      await invoke('start_drag');
    } catch (err) {
      console.error('Drag failed:', err);
    }
    setTimeout(() => setIsDragging(false), 100);
  };

  // Jump
  const handleJump = async (sessionId: string) => {
    try {
      await invoke('jump_to_instance', { sessionId });
    } catch (e) {
      console.error('Jump failed:', e);
    }
  };

  // Respond to popup
  const handleRespond = async (popupId: string, decision?: string, answer?: string, answers?: string[][]) => {
    try {
      await invoke('respond_popup', { popupId, decision, answer, answers });
    } catch (e) {
      console.error('Response failed:', e);
    }
  };

  // Refresh hooks status
  const handleSettingsChange = async () => {
    try {
      const result = await invoke<HooksCheckResult>('check_claude_hooks');
      setHooksCheckResult(result);
    } catch (e) {
      console.error('Failed to refresh hooks:', e);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col items-center pt-1 pointer-events-none">
      <motion.div
        layout
        initial={false}
        animate={{ width: contentWidth }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        style={{ originX: 0.5 }}
        className="island-capsule overflow-hidden flex flex-col pointer-events-auto"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Header */}
        <motion.div
          className="px-4 py-2 flex items-center gap-3 cursor-grab active:cursor-grabbing flex-shrink-0"
          style={{ height: 44 }}
          onMouseDown={handleMouseDown}
        >
          {/* Status dot */}
          <motion.div
            animate={{ scale: notification ? [1, 1.3, 1] : 1 }}
            transition={{ repeat: notification ? 2 : 0, duration: 0.3 }}
            className={`status-dot ${
              notification?.type === 'error' ? 'error' :
              notification?.type === 'popup' ? 'waiting' :
              notification?.type === 'working' ? 'working' :
              pendingPopups.length > 0 ? 'waiting' :
              workingCount > 0 ? 'working' :
              waitingCount > 0 ? 'waiting' : 'idle'
            }`}
          />

          {/* Content */}
          <div className="flex-1 text-white font-medium overflow-hidden text-center">
            <AnimatePresence mode="wait">
              {notification ? (
                <motion.div
                  key="notification"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="text-base truncate"
                >
                  <span className="text-white/90">{notification.message}</span>
                </motion.div>
              ) : (
                <motion.div
                  key="status"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="text-base"
                >
                  {totalCount > 0 ? `${totalCount} Claude` : 'CC-Island'}
                  {workingCount > 0 && (
                    <span className="text-green-400 ml-2 text-sm">· {workingCount} working</span>
                  )}
                  {waitingCount > 0 && (
                    <span className="text-yellow-400 ml-2 text-sm">· {waitingCount} thinking</span>
                  )}
                  {idleCount > 0 && (
                    <span className="text-white/50 ml-2 text-sm">· {idleCount} idle</span>
                  )}
                  {pendingPopups.length > 0 && (
                    <span className="text-orange-400 ml-2 text-sm">· {pendingPopups.length} pending</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Expand indicator */}
          <motion.div
            animate={{ rotate: (isExpanded || showAutoExpand) ? 180 : 0 }}
            className="text-white/30 text-xs"
          >
            ▼
          </motion.div>
        </motion.div>

        {/* Auto expand content - 只显示当前弹窗 */}
        <AnimatePresence mode="wait">
          {showAutoExpand && autoExpandPopup && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: 500 }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.2 }}
              className="px-3 pb-3 overflow-visible"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-white/60 text-xs">
                  {pendingPopups.length > 1 ? `${pendingPopups.length} 个待处理` : '待处理'}
                </span>
              </div>
              <PopupCard
                popup={autoExpandPopup}
                onRespond={handleRespond}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hover expand content - 显示所有 */}
        <AnimatePresence>
          {showHoverExpand && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: 450 }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.2 }}
              className="px-3 pb-3 overflow-hidden"
            >
              <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
                {pendingPopups.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2">
                    {pendingPopups.map((popup) => (
                      <PopupCard key={popup.id} popup={popup} onRespond={handleRespond} />
                    ))}
                  </div>
                )}
                {activeInstances.length > 0 && (
                  <InstanceList instances={activeInstances} popups={pendingPopups} onJump={handleJump} />
                )}
                {totalCount === 0 && (
                  <div className="text-white/40 text-xs text-center py-3">
                    No active sessions
                  </div>
                )}
              </div>

              {/* Settings button */}
              <div className="mt-2 pt-2 border-t border-white/10">
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-full py-1.5 text-white/50 hover:text-white/80 text-xs transition-colors flex items-center justify-center gap-1"
                >
                  <span>⚙</span>
                  <span>设置</span>
                  {hooksCheckResult && hooksCheckResult.missing_required.length > 0 && (
                    <span className="text-orange-400 ml-1">({hooksCheckResult.missing_required.length} 个未配置)</span>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="pointer-events-auto">
            <SettingsModal
              isOpen={showSettings}
              onClose={() => setShowSettings(false)}
              onSettingsChange={handleSettingsChange}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Hooks Setup Modal */}
      <AnimatePresence>
        {showHooksSetup && hooksCheckResult && (
          <div className="pointer-events-auto">
            <HooksSetupModal
              result={hooksCheckResult}
              onComplete={() => {
                setShowHooksSetup(false);
                handleSettingsChange();
              }}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;