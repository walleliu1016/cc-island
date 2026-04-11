import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useAppStore } from './stores/appStore';
import { InstanceList } from './components/InstanceList';
import { PopupCard } from './components/PopupList';
import { SettingsModal, HooksSetupModal } from './components/Settings';
import { ChatView } from './components/ChatView';
import { ClaudeCrabIcon, ProcessingSpinner, PermissionIndicatorIcon, ReadyForInputIcon, IdleIcon, IslandIcon, CloseIcon } from './components/StatusIcons';
import { getCornerRadii, generateNotchPath } from './components/NotchShape';
import { ClaudeInstance, PopupItem, HooksCheckResult, ToolActivity } from './types';

// Window sizes
const COLLAPSED_WIDTH = 300;
const COLLAPSED_HEIGHT = 38;
const EXPANDED_WIDTH = 480;
const EXPANDED_HEIGHT = 320;
const MODAL_WIDTH = 480;
const MODAL_HEIGHT = 420;

// Animation parameters - matching Claude Island spring animation
// open: spring(response: 0.42, dampingFraction: 0.8)
// close: spring(response: 0.45, dampingFraction: 1.0)
const openAnimation = { type: 'spring', stiffness: 344, damping: 25 };
const closeAnimation = { type: 'spring', stiffness: 320, damping: 30 };

function App() {
  const { instances, popups, recentActivities, isExpanded, setIsExpanded, setInstances, setPopups, setRecentActivities } = useAppStore();
  const [_notification, setNotification] = useState<{ message: string; type: string } | null>(null);
  const [autoExpandPopup, setAutoExpandPopup] = useState<PopupItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hooksCheckResult, setHooksCheckResult] = useState<HooksCheckResult | null>(null);
  const [showHooksSetup, setShowHooksSetup] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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

  // Listen for window blur (click outside) to collapse island
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupBlurListener = async () => {
      unlisten = await listen('blur', () => {
        // Collapse when window loses focus (user clicked outside)
        setIsExpanded(false);
      });
    };

    setupBlurListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
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

        // Detect new tool activity
        if (activitiesData.length > 0 && prev.instances.length > 0) {
          const latestActivity = activitiesData[activitiesData.length - 1];
          const prevActivities = recentActivities;
          const isNewActivity = prevActivities.length === 0 ||
            prevActivities[prevActivities.length - 1]?.timestamp !== latestActivity.timestamp;

          if (isNewActivity) {
            setNotification({
              message: `${latestActivity.project_name}: ${latestActivity.tool_name}`,
              type: 'working'
            });
            setTimeout(() => setNotification(null), 2000);
          }
        }

        // Detect new popup - auto expand
        const prevPendingIds = prev.popups.filter(p => p.status === 'pending').map(p => p.id);
        const newPending = popupsData.filter(p =>
          p.status === 'pending' && !prevPendingIds.includes(p.id)
        );

        if (newPending.length > 0 && !autoExpandPopup) {
          setAutoExpandPopup(newPending[0]);
          const typeText = newPending[0].type === 'permission' ? 'Permission' : 'Ask';
          setNotification({ message: `${newPending[0].project_name}: ${typeText}`, type: 'popup' });
          setTimeout(() => setNotification(null), 3000);
        }

        // Detect instance status changes
        for (const instance of instancesData) {
          const prevInstance = prev.instances.find(i => i.session_id === instance.session_id);
          if (prevInstance && prevInstance.status !== instance.status) {
            if (instance.status === 'error') {
              setNotification({ message: `${instance.project_name}: Error`, type: 'error' });
              setTimeout(() => setNotification(null), 3000);
            }
          }
          if (!prevInstance && instance.status !== 'ended') {
            setNotification({ message: `${instance.project_name}: Started`, type: 'new' });
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

  // Handle popup processed, show next
  useEffect(() => {
    if (autoExpandPopup) {
      const stillPending = popups.find(p => p.id === autoExpandPopup.id && p.status === 'pending');
      if (!stillPending) {
        const nextPending = popups.find(p => p.status === 'pending');
        if (nextPending) {
          setAutoExpandPopup(nextPending);
        } else {
          setAutoExpandPopup(null);
        }
      }
    }
  }, [popups, autoExpandPopup]);

  // Resize window when state changes
  useEffect(() => {
    const resizeWindow = async () => {
      if (showSettings || showHooksSetup) {
        try {
          await invoke('resize_window', { width: MODAL_WIDTH, height: MODAL_HEIGHT });
        } catch (e) {
          console.error('Failed to resize window:', e);
        }
        return;
      }

      // ChatView mode - larger window
      if (selectedSessionId) {
        try {
          await invoke('resize_window', { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT });
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
  }, [isExpanded, autoExpandPopup, showSettings, showHooksSetup, selectedSessionId]);

  // Stats
  const activeInstances = instances.filter(i => i.status !== 'ended');
  const workingCount = instances.filter(i => i.status === 'working').length;
  const waitingCount = instances.filter(i => i.status === 'waiting').length;
  const pendingPopups = popups.filter(p => p.status === 'pending');

  // Activity status - determines what to show in collapsed state
  const isProcessing = workingCount > 0 || waitingCount > 0;
  const hasPendingPermission = pendingPopups.some(p => p.type === 'permission');
  const hasWaitingForInput = activeInstances.some(i => i.status === 'idle') && !isProcessing && !hasPendingPermission;
  const showClosedActivity = isProcessing || hasPendingPermission || hasWaitingForInput;

  // Display mode
  const showAutoExpand = autoExpandPopup !== null;
  const showExpanded = isExpanded && !showAutoExpand && !selectedSessionId;
  const showChatView = selectedSessionId !== null;

  // Get selected instance for ChatView
  const selectedInstance = selectedSessionId
    ? instances.find(i => i.session_id === selectedSessionId)
    : null;

  // Calculate target dimensions
  const expansionWidth = showClosedActivity ? COLLAPSED_WIDTH + 60 : COLLAPSED_WIDTH;
  const targetWidth = showExpanded || showAutoExpand ? EXPANDED_WIDTH : expansionWidth;
  const targetHeight = showExpanded || showAutoExpand ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  // Get corner radii based on state (matching Claude Island asymmetric corners)
  const isOpen = showExpanded || showAutoExpand;
  const corners = getCornerRadii(isOpen);

  // Notch path for SVG shape (top curves inward, bottom curves outward)
  // Use target dimensions for the shape
  const notchPath = generateNotchPath(
    targetWidth,
    targetHeight,
    corners.top,
    corners.bottom
  );

  // Click to expand (replacing hover)
  const handleClick = () => {
    if (!autoExpandPopup) {
      setIsExpanded(!isExpanded);
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

  // Jump to terminal
  const handleJump = async (sessionId: string) => {
    try {
      await invoke('jump_to_instance', { sessionId });
    } catch (e) {
      console.error('Jump failed:', e);
    }
  };

  // View chat for instance
  const handleViewChat = (sessionId: string) => {
    setSelectedSessionId(sessionId);
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

  // Get current phase for status icon (used in collapsed state display logic)
  // Phase determines which indicator to show

  return (
    <div className="w-screen h-screen flex flex-col items-center pt-0 pointer-events-none">
      <motion.div
        initial={false}
        animate={{
          width: targetWidth,
          height: targetHeight,
        }}
        transition={showExpanded || showAutoExpand ? openAnimation : closeAnimation}
        className="relative overflow-hidden flex flex-col pointer-events-auto cursor-pointer"
        style={{
          transformOrigin: 'center top',
        }}
        onClick={handleClick}
      >
        {/* SVG Notch Shape Background */}
        <svg
          width={targetWidth}
          height={targetHeight}
          viewBox={`0 0 ${targetWidth} ${targetHeight}`}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: -1 }}
        >
          <motion.path
            d={notchPath}
            fill="black"
            initial={false}
            animate={{ d: notchPath }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        </svg>

        {/* Header */}
        <motion.div
          className="px-3 py-2 flex items-center gap-2 flex-shrink-0"
          style={{ height: COLLAPSED_HEIGHT }}
        >
          {/* Left side - Crab + indicators when active */}
          {showClosedActivity && (
            <div className="flex items-center gap-1.5">
              <ClaudeCrabIcon size={16} animateLegs={isProcessing} />
              {hasPendingPermission && (
                <PermissionIndicatorIcon size={16} />
              )}
            </div>
          )}

          {/* Center content */}
          <div className="flex-1 flex items-center justify-center overflow-hidden">
            {!showExpanded && !showAutoExpand && !showChatView ? (
              // Collapsed state
              showClosedActivity ? (
                // Activity state - show spinner/checkmark on right
                <div className="flex-1" />
              ) : (
                // Empty collapsed state
                <span className="text-white/50 text-xs font-medium">CC-Island</span>
              )
            ) : showChatView ? (
              // ChatView mode - show back button
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSessionId(null);
                }}
                className="text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
              >
                <span>←</span>
                <span className="text-xs">Back</span>
              </button>
            ) : (
              // Expanded state - show header content
              <div className="flex items-center gap-2 w-full">
                {/* Left - Island icon */}
                <IslandIcon size={16} />

                {/* Center - Session count */}
                <div className="flex-1 text-center">
                  <span className="text-white/60 text-xs">
                    {activeInstances.length > 0 ? `${activeInstances.length} sessions` : 'No sessions'}
                  </span>
                </div>

                {/* Right - Settings and Close buttons */}
                <div className="flex items-center gap-1">
                  {/* Settings button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSettings(true);
                    }}
                    className="text-white/40 hover:text-white/70 transition-colors p-1"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                      <circle cx="7" cy="4" r="1.5" />
                      <circle cx="7" cy="7" r="1.5" />
                      <circle cx="7" cy="10" r="1.5" />
                    </svg>
                  </button>

                  {/* Close button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded(false);
                    }}
                    className="text-white/40 hover:text-white/70 transition-colors p-1"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right side - spinner or checkmark when active */}
          {showClosedActivity && !showExpanded && !showAutoExpand && (
            <div className="flex items-center">
              {isProcessing || hasPendingPermission ? (
                <ProcessingSpinner size={14} />
              ) : hasWaitingForInput ? (
                <ReadyForInputIcon size={16} />
              ) : (
                <IdleIcon size={14} />
              )}
            </div>
          )}
        </motion.div>

        {/* Auto expand content - popup */}
        <AnimatePresence mode="wait">
          {showAutoExpand && autoExpandPopup && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: 350 }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-3 pb-3 overflow-visible"
            >
              <PopupCard
                popup={autoExpandPopup}
                onRespond={handleRespond}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded content - full list */}
        <AnimatePresence>
          {showExpanded && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: 350 }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-3 pb-3 overflow-hidden"
            >
              <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
                {pendingPopups.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2">
                    {pendingPopups.map((popup) => (
                      <PopupCard key={popup.id} popup={popup} onRespond={handleRespond} />
                    ))}
                  </div>
                )}
                {activeInstances.length > 0 && (
                  <InstanceList
                    instances={activeInstances}
                    popups={pendingPopups}
                    onJump={handleJump}
                    onViewChat={handleViewChat}
                  />
                )}
                {activeInstances.length === 0 && (
                  <div className="text-white/30 text-xs text-center py-4">
                    No active sessions
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ChatView content */}
        <AnimatePresence>
          {showChatView && selectedInstance && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: 350 }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <ChatView
                sessionId={selectedSessionId!}
                projectName={selectedInstance.project_name}
                onClose={() => setSelectedSessionId(null)}
              />
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