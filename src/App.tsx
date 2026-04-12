import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { useAppStore } from './stores/appStore';
import { InstanceList } from './components/InstanceList';
import { SettingsModal, HooksSetupModal } from './components/Settings';
import { ChatView } from './components/ChatView';
import { ClaudeCrabIcon, ProcessingSpinner, PermissionIndicatorIcon, ReadyForInputIcon, IdleIcon, MenuIcon } from './components/StatusIcons';
import { getCornerRadii, generateNotchPath } from './components/NotchShape';
import { ClaudeInstance, PopupItem, HooksCheckResult, ToolActivity } from './types';

// Window sizes
const COLLAPSED_WIDTH = 300;
const COLLAPSED_HEIGHT = 38;
const EXPANDED_WIDTH = 480;
const EXPANDED_HEIGHT = 400;
const MODAL_WIDTH = 480;
const MODAL_HEIGHT = 400;

// Animation parameters - matching Claude Island spring animation
// open: spring(response: 0.42, dampingFraction: 0.8)
// close: spring(response: 0.45, dampingFraction: 1.0)
const openAnimation = { type: 'spring', stiffness: 344, damping: 25 };
const closeAnimation = { type: 'spring', stiffness: 320, damping: 30 };

function App() {
  const { instances, popups, recentActivities, isExpanded, setIsExpanded, setInstances, setPopups, setRecentActivities } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  const [hooksCheckResult, setHooksCheckResult] = useState<HooksCheckResult | null>(null);
  const [showHooksSetup, setShowHooksSetup] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const prevDataRef = useRef({ instances: [] as ClaudeInstance[], popups: [] as PopupItem[] });

  // Activity display state with 3-second minimum display time
  const [activityDisplay, setActivityDisplay] = useState<{
    message: string;
    timestamp: number;
    isAnimating: boolean;
  } | null>(null);
  const activityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state for horizontal dragging
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const windowStartXRef = useRef(0);
  const appWindowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);

  // Initialize window reference
  useEffect(() => {
    appWindowRef.current = getCurrentWindow();
  }, []);

  // Handle drag start
  const handleDragStart = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartXRef.current = e.clientX;

    // Get current window position
    if (appWindowRef.current) {
      try {
        const position = await appWindowRef.current.outerPosition();
        windowStartXRef.current = position.x;
      } catch (e) {
        console.error('Failed to get window position:', e);
      }
    }
  };

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = async (e: MouseEvent) => {
      if (!appWindowRef.current) return;

      const deltaX = e.clientX - dragStartXRef.current;
      const newX = windowStartXRef.current + deltaX;

      // Only update X position, keep Y at 0 (top of screen)
      try {
        await appWindowRef.current.setPosition(new PhysicalPosition(newX, 0));
      } catch (e) {
        console.error('Failed to move window:', e);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

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

  // Listen for window blur (click outside) to collapse island or close modals
  useEffect(() => {
    const handleBlur = () => {
      console.log('Window blur triggered');
      // Always close any open views when clicking outside
      setSelectedSessionId(null);
      setShowSettings(false);
      setShowHooksSetup(false);
      setIsExpanded(false);
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
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

        // Detect new tool activity - show for 3 seconds minimum
        if (activitiesData.length > 0 && prev.instances.length > 0) {
          const latestActivity = activitiesData[activitiesData.length - 1];
          const prevActivities = recentActivities;
          const isNewActivity = prevActivities.length === 0 ||
            prevActivities[prevActivities.length - 1]?.timestamp !== latestActivity.timestamp;

          if (isNewActivity) {
            // Clear existing timeout
            if (activityTimeoutRef.current) {
              clearTimeout(activityTimeoutRef.current);
            }
            // Set new activity display - show tool name only
            setActivityDisplay({
              message: latestActivity.tool_name,
              timestamp: Date.now(),
              isAnimating: true
            });
            // Clear after 3 seconds
            activityTimeoutRef.current = setTimeout(() => {
              setActivityDisplay(null);
            }, 3000);
          }
        }

        // Detect new popup - show activity in header only (no auto expand)
        const prevPendingIds = prev.popups.filter(p => p.status === 'pending').map(p => p.id);
        const newPending = popupsData.filter(p =>
          p.status === 'pending' && !prevPendingIds.includes(p.id)
        );

        if (newPending.length > 0) {
          // Clear existing timeout
          if (activityTimeoutRef.current) {
            clearTimeout(activityTimeoutRef.current);
          }
          const typeText = newPending[0].type === 'permission' ? 'Permission' : 'Ask';
          setActivityDisplay({
            message: typeText,
            timestamp: Date.now(),
            isAnimating: true
          });
          activityTimeoutRef.current = setTimeout(() => {
            setActivityDisplay(null);
          }, 3000);
        }

        // Detect instance status changes
        for (const instance of instancesData) {
          const prevInstance = prev.instances.find(i => i.session_id === instance.session_id);
          if (prevInstance && prevInstance.status !== instance.status) {
            if (instance.status === 'error') {
              if (activityTimeoutRef.current) {
                clearTimeout(activityTimeoutRef.current);
              }
              setActivityDisplay({
                message: 'Error',
                timestamp: Date.now(),
                isAnimating: false
              });
              activityTimeoutRef.current = setTimeout(() => {
                setActivityDisplay(null);
              }, 3000);
            }
          }
          if (!prevInstance && instance.status !== 'ended') {
            if (activityTimeoutRef.current) {
              clearTimeout(activityTimeoutRef.current);
            }
            setActivityDisplay({
              message: 'Started',
              timestamp: Date.now(),
              isAnimating: true
            });
            activityTimeoutRef.current = setTimeout(() => {
              setActivityDisplay(null);
            }, 3000);
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
    return () => {
      clearInterval(interval);
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    };
  }, [setInstances, setPopups, setRecentActivities, recentActivities]);

  // Stats
  const activeInstances = instances.filter(i => i.status !== 'ended');
  const workingCount = instances.filter(i => i.status === 'working').length;
  const waitingCount = instances.filter(i => i.status === 'waiting').length;
  const pendingPopups = popups.filter(p => p.status === 'pending');

  // Activity status - determines what to show in collapsed state
  const isProcessing = workingCount > 0 || waitingCount > 0;
  const hasPendingPermission = pendingPopups.some(p => p.type === 'permission');
  const hasWaitingForInput = activeInstances.some(i => i.status === 'idle') && !isProcessing && !hasPendingPermission;
  // Show activity when there's real activity OR when displaying a 3-second activity message
  const showClosedActivity = isProcessing || hasPendingPermission || hasWaitingForInput || !!activityDisplay;

  // Display mode
  const showExpanded = isExpanded && !selectedSessionId;
  const showChatView = selectedSessionId !== null;

  // Get selected instance for ChatView
  const selectedInstance = selectedSessionId
    ? instances.find(i => i.session_id === selectedSessionId)
    : null;

  // Calculate target dimensions
  const targetWidth = showExpanded || showChatView ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const targetHeight = showExpanded || showChatView ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  // Resize window when state changes - moved here after all variables are defined
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

      // When not expanded, use fixed collapsed width
      const resizeTargetWidth = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
      const resizeTargetHeight = isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
      try {
        await invoke('resize_window', { width: resizeTargetWidth, height: resizeTargetHeight });
      } catch (e) {
        console.error('Failed to resize window:', e);
      }
    };
    resizeWindow();
  }, [isExpanded, showSettings, showHooksSetup, selectedSessionId, showClosedActivity]);

  // Get corner radii based on state (matching Claude Island asymmetric corners)
  const isOpen = showExpanded;
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
    // Don't expand if dragging
    if (isDragging) return;
    setIsExpanded(!isExpanded);
  };

  // Respond to popup
  const handleRespond = async (popupId: string, decision?: string, answer?: string, answers?: string[][]) => {
    try {
      await invoke('respond_popup', { popupId, decision, answer, answers });
      // Just respond, don't open ChatView
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
        transition={showExpanded ? openAnimation : closeAnimation}
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
          preserveAspectRatio="none"
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

        {/* Header - Three column layout: Left | Center | Right */}
        <motion.div
          className={`flex items-center flex-shrink-0 ${showExpanded ? 'px-6' : 'px-3'}`}
          style={{ height: COLLAPSED_HEIGHT, cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={handleDragStart}
        >
          {/* Left column - Crab (always present), fixed width */}
          <div className="flex items-center gap-1.5 w-10 flex-shrink-0">
            <ClaudeCrabIcon
              size={16}
              animateLegs={showExpanded ? true : isProcessing || !!activityDisplay}
            />
            {/* Permission indicator when in collapsed state with pending permission */}
            {!showExpanded && hasPendingPermission && (
              <PermissionIndicatorIcon size={16} />
            )}
          </div>

          {/* Center column - Text content, takes remaining space */}
          <div className="flex-1 flex items-center justify-center overflow-hidden mx-2 min-w-0">
            {showChatView ? (
              // ChatView mode - just show project name (back button is inside ChatView)
              <span className="text-white/70 text-xs font-medium truncate">
                {selectedInstance?.project_name || 'Chat'}
              </span>
            ) : showExpanded ? (
              // Expanded state - show CC-Island
              <span className="text-white/50 text-xs font-medium">CC-Island</span>
            ) : (
              // Collapsed state - show activity or CC-Island
              activityDisplay ? (
                <span className="text-white/60 text-xs font-medium truncate w-full text-center">
                  {activityDisplay.message}
                </span>
              ) : (
                <span className="text-white/50 text-xs font-medium">CC-Island</span>
              )
            )}
          </div>

          {/* Right column - Status icon or Menu, fixed width */}
          <div className="flex items-center justify-end w-10 flex-shrink-0">
            {showChatView ? (
              // ChatView - spacer
              <div />
            ) : showExpanded ? (
              // Expanded state - Menu button
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSettings(true);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-white/40 hover:text-white/70 transition-colors p-1"
              >
                <MenuIcon size={14} />
              </button>
            ) : (
              // Collapsed state - Status spinner/icon
              <>
                {isProcessing || hasPendingPermission || !!activityDisplay ? (
                  <ProcessingSpinner size={14} />
                ) : hasWaitingForInput ? (
                  <ReadyForInputIcon size={16} />
                ) : (
                  <IdleIcon size={14} />
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Expanded content - full list */}
        <AnimatePresence>
          {showExpanded && !showSettings && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="px-3 pb-3 overflow-hidden w-full rounded-b-xl"
            >
              <div className="max-h-[360px] overflow-y-auto scrollbar-thin w-full rounded-b-xl">
                {activeInstances.length > 0 && (
                  <InstanceList
                    instances={activeInstances}
                    popups={pendingPopups}
                    onJump={handleJump}
                    onViewChat={handleViewChat}
                    onRespond={handleRespond}
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
          {showChatView && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden w-full px-3"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ChatView
                sessionId={selectedSessionId!}
                projectName={selectedInstance?.project_name || 'Unknown'}
                onClose={() => setSelectedSessionId(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings content */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden w-full px-3 pb-3"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                onSettingsChange={handleSettingsChange}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hooks Setup content */}
        <AnimatePresence>
          {showHooksSetup && hooksCheckResult && (
            <motion.div
              initial={{ opacity: 0, maxHeight: 0 }}
              animate={{ opacity: 1, maxHeight: EXPANDED_HEIGHT - COLLAPSED_HEIGHT }}
              exit={{ opacity: 0, maxHeight: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden w-full px-3 pb-3"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <HooksSetupModal
                result={hooksCheckResult}
                onComplete={() => {
                  setShowHooksSetup(false);
                  handleSettingsChange();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default App;