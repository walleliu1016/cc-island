import { create } from 'zustand';
import { ClaudeInstance } from '../types';

// Display item in queue
interface DisplayItem {
  sessionId: string;
  text: string;
  phase: 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle';
  startTime: number;
  minDuration: number; // minimum display time in ms
}

interface DisplayState {
  // Current display state for header
  headerDisplay: {
    text: string | null;
    phase: 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle';
    sessionId: string | null;
  };

  // Per-instance display queue
  instanceDisplays: Map<string, DisplayItem>;

  // Update display based on current instances
  updateDisplays: (instances: ClaudeInstance[]) => void;

  // Get display for specific instance
  getInstanceDisplay: (sessionId: string) => { text: string | null; phase: 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle' };
}

const MIN_DISPLAY_TIME = 3000; // 3 seconds minimum display time

// Format tool names
function formatToolName(name: string): string {
  const toolNames: Record<string, string> = {
    'BashTool': 'Bash',
    'ReadTool': 'Read',
    'WriteTool': 'Write',
    'EditTool': 'Edit',
    'WebFetchTool': 'Web',
    'WebSearchTool': 'Search',
    'AskUserQuestion': 'Ask',
  };
  return toolNames[name] || name.replace(/Tool$/, '');
}

// Get display info from instance status
function getDisplayInfo(instance: ClaudeInstance): { text: string; phase: 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle' } | null {
  const status = instance.status;

  // Helper to get tool input summary
  const getToolInputSummary = (): string => {
    if (!instance.tool_input) {
      console.log('[DisplayStore] No tool_input for', instance.session_id);
      return '';
    }
    const input = instance.tool_input;
    console.log('[DisplayStore] tool_input:', input);
    // Try to get command, file_path, action, or details
    const result = input.command || input.file_path || input.action || input.details || '';
    console.log('[DisplayStore] Extracted:', result);
    return result;
  };

  switch (status.type) {
    case 'working': {
      const toolName = instance.current_tool ? formatToolName(instance.current_tool) : 'Working';
      const inputSummary = getToolInputSummary();
      return {
        text: inputSummary ? `${toolName}: ${inputSummary.slice(0, 20)}${inputSummary.length > 20 ? '...' : ''}` : toolName,
        phase: 'processing'
      };
    }
    case 'thinking':
      return { text: 'Thinking', phase: 'processing' };
    case 'waiting':
      return { text: 'Thinking', phase: 'processing' };
    case 'compacting':
      return { text: 'Compacting', phase: 'processing' };
    case 'waitingforapproval': {
      const toolName = instance.current_tool ? formatToolName(instance.current_tool) : 'Permission';
      const inputSummary = getToolInputSummary();
      return {
        text: inputSummary ? `${toolName}: ${inputSummary.slice(0, 15)}${inputSummary.length > 15 ? '...' : ''}` : toolName,
        phase: 'waitingForApproval'
      };
    }
    case 'idle':
      return { text: '', phase: 'waitingForInput' };
    case 'ended':
    case 'error':
      return { text: '', phase: 'idle' };
    default:
      return null;
  }
}

export const useDisplayStore = create<DisplayState>((set, get) => ({
  headerDisplay: {
    text: null,
    phase: 'idle',
    sessionId: null,
  },
  instanceDisplays: new Map(),

  updateDisplays: (instances: ClaudeInstance[]) => {
    const now = Date.now();
    const state = get();
    const newInstanceDisplays = new Map(state.instanceDisplays);

    // Process each instance
    for (const instance of instances) {
      const currentDisplay = newInstanceDisplays.get(instance.session_id);
      const newInfo = getDisplayInfo(instance);

      if (!newInfo) continue;

      // If no current display or different from current, update
      if (!currentDisplay) {
        // New display
        if (newInfo.phase !== 'idle' && newInfo.phase !== 'waitingForInput') {
          newInstanceDisplays.set(instance.session_id, {
            sessionId: instance.session_id,
            text: newInfo.text,
            phase: newInfo.phase,
            startTime: now,
            minDuration: MIN_DISPLAY_TIME,
          });
        }
      } else {
        // Check if we should update
        const elapsed = now - currentDisplay.startTime;
        const canChange = elapsed >= currentDisplay.minDuration;

        if (canChange) {
          // Check if phase changed
          if (newInfo.phase !== currentDisplay.phase || newInfo.text !== currentDisplay.text) {
            if (newInfo.phase === 'idle' || newInfo.phase === 'waitingForInput') {
              // Clear display for idle states
              newInstanceDisplays.delete(instance.session_id);
            } else {
              // Update to new display
              newInstanceDisplays.set(instance.session_id, {
                sessionId: instance.session_id,
                text: newInfo.text,
                phase: newInfo.phase,
                startTime: now,
                minDuration: MIN_DISPLAY_TIME,
              });
            }
          }
        } else {
          // Can't change yet (min display time not reached)
          // Keep current display even if underlying state changed to idle
          if (newInfo.phase === 'idle' || newInfo.phase === 'waitingForInput') {
            // Continue showing current display until min time is reached
            // (do nothing - keep currentDisplay)
          } else if (newInfo.phase !== currentDisplay.phase || newInfo.text !== currentDisplay.text) {
            // New activity - update to new state (different activity)
            newInstanceDisplays.set(instance.session_id, {
              sessionId: instance.session_id,
              text: newInfo.text,
              phase: newInfo.phase,
              startTime: now,
              minDuration: MIN_DISPLAY_TIME,
            });
          }
        }
      }
    }

    // Find header display (highest priority active instance)
    let headerDisplay: { text: string | null; phase: 'processing' | 'waitingForApproval' | 'waitingForInput' | 'idle'; sessionId: string | null } = {
      text: null,
      phase: 'idle',
      sessionId: null
    };

    // Priority: waitingForApproval > processing > waitingForInput > idle
    for (const [, display] of newInstanceDisplays) {
      if (display.phase === 'waitingForApproval') {
        // Show "需要授权" with tool name if available
        const toolText = display.text && display.text !== 'Permission' ? `: ${display.text.split(':')[0]}` : '';
        headerDisplay = { text: `需要授权${toolText}`, phase: 'waitingForApproval', sessionId: display.sessionId };
        break; // Highest priority
      }
      if (display.phase === 'processing' && headerDisplay.phase !== 'waitingForApproval') {
        headerDisplay = { text: display.text, phase: 'processing', sessionId: display.sessionId };
      }
    }

    set({
      instanceDisplays: newInstanceDisplays,
      headerDisplay,
    });
  },

  getInstanceDisplay: (sessionId: string) => {
    const state = get();
    const display = state.instanceDisplays.get(sessionId);

    if (display) {
      return { text: display.text, phase: display.phase };
    }

    return { text: null, phase: 'idle' };
  },
}));
