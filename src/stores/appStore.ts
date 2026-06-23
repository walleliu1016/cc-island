// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { create } from 'zustand';
import { ClaudeInstance, PopupItem, ToolActivity } from '../types';

interface AppState {
  instances: ClaudeInstance[];
  popups: PopupItem[];
  recentActivities: ToolActivity[];
  isExpanded: boolean;
  hasNewActivity: boolean;
  windowLabel: string;
  isDesktopWindowOpen: boolean;
  showArchiveTab: boolean;
  historySessions: ClaudeInstance[];
  theme: string;
  setIsExpanded: (expanded: boolean) => void;
  setInstances: (instances: ClaudeInstance[]) => void;
  setPopups: (popups: PopupItem[]) => void;
  setRecentActivities: (activities: ToolActivity[]) => void;
  setHasNewActivity: (hasNew: boolean) => void;
  setWindowLabel: (label: string) => void;
  setDesktopWindowOpen: (open: boolean) => void;
  setShowArchiveTab: (show: boolean) => void;
  setHistorySessions: (historySessions: ClaudeInstance[]) => void;
  setTheme: (theme: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  instances: [],
  popups: [],
  recentActivities: [],
  isExpanded: false,
  hasNewActivity: false,
  windowLabel: '',
  isDesktopWindowOpen: false,
  showArchiveTab: false,
  historySessions: [],
  theme: 'dark',
  setIsExpanded: (isExpanded) => set({ isExpanded }),
  setInstances: (instances) => set({ instances }),
  setPopups: (popups) => set({ popups }),
  setRecentActivities: (recentActivities) => set({ recentActivities }),
  setHasNewActivity: (hasNewActivity) => set({ hasNewActivity }),
  setWindowLabel: (windowLabel) => set({ windowLabel }),
  setDesktopWindowOpen: (isDesktopWindowOpen) => set({ isDesktopWindowOpen }),
  setShowArchiveTab: (show: boolean) => set({ showArchiveTab: show }),
  setHistorySessions: (historySessions) => set({ historySessions }),
  setTheme: (theme) => set({ theme }),
}));
