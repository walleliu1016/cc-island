// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { create } from 'zustand';
import { ClaudeInstance, PopupItem, ToolActivity } from '../types';

export type LayoutMode = 'island' | 'desktop';

interface AppState {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  recentActivities: ToolActivity[];
  isExpanded: boolean;
  hasNewActivity: boolean;
  layoutMode: LayoutMode;
  showArchiveTab: boolean;
  setIsExpanded: (expanded: boolean) => void;
  setInstances: (instances: ClaudeInstance[]) => void;
  setPopups: (popups: PopupItem[]) => void;
  setRecentActivities: (activities: ToolActivity[]) => void;
  setHasNewActivity: (hasNew: boolean) => void;
  setIslandMode: () => void;
  setDesktopMode: () => void;
  setShowArchiveTab: (show: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  instances: [],
  popups: [],
  recentActivities: [],
  isExpanded: false,
  hasNewActivity: false,
  layoutMode: 'island',
  showArchiveTab: false,
  setIsExpanded: (isExpanded) => set({ isExpanded }),
  setInstances: (instances) => set({ instances }),
  setPopups: (popups) => set({ popups }),
  setRecentActivities: (recentActivities) => set({ recentActivities }),
  setHasNewActivity: (hasNewActivity) => set({ hasNewActivity }),
  setIslandMode: () => set({ layoutMode: 'island' }),
  setDesktopMode: () => set({ layoutMode: 'desktop' }),
  setShowArchiveTab: (show: boolean) => set({ showArchiveTab: show }),
}));