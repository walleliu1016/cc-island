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

const MIN_DISPLAY_TIME = 1000; // 1 second minimum display time

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

  switch (status.type) {
    case 'working':
      return {
        text: instance.current_tool ? formatToolName(instance.current_tool) : 'Working',
        phase: 'processing'
      };
    case 'thinking':
      return { text: 'Thinking', phase: 'processing' };
    case 'waiting':
      return { text: 'Thinking', phase: 'processing' };
    case 'compacting':
      return { text: 'Compacting', phase: 'processing' };
    case 'waitingforapproval':
      return {
        text: instance.current_tool ? formatToolName(instance.current_tool) : 'Permission',
        phase: 'waitingForApproval'
      };
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
        }
        // If can't change yet, keep current display (even if underlying state changed)
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
        headerDisplay = { text: display.text || 'Permission', phase: 'waitingForApproval', sessionId: display.sessionId };
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
