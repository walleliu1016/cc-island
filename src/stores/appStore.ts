import { create } from 'zustand';
import { ClaudeInstance, PopupItem, ToolActivity } from '../types';

interface AppState {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  recentActivities: ToolActivity[];
  isExpanded: boolean;
  hasNewActivity: boolean;
  setIsExpanded: (expanded: boolean) => void;
  setInstances: (instances: ClaudeInstance[]) => void;
  setPopups: (popups: PopupItem[]) => void;
  setRecentActivities: (activities: ToolActivity[]) => void;
  setHasNewActivity: (hasNew: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  instances: [],
  popups: [],
  recentActivities: [],
  isExpanded: false,
  hasNewActivity: false,
  setIsExpanded: (isExpanded) => set({ isExpanded }),
  setInstances: (instances) => set({ instances }),
  setPopups: (popups) => set({ popups }),
  setRecentActivities: (recentActivities) => set({ recentActivities }),
  setHasNewActivity: (hasNewActivity) => set({ hasNewActivity }),
}));