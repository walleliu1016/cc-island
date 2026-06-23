// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

export type ThemeId = 'dark' | 'light';

export interface ThemeColors {
  // Layout backgrounds
  bgApp: string;
  bgSidebar: string;
  bgMain: string;
  bgTitlebar: string;
  bgCard: string;
  bgCardHover: string;
  bgInput: string;
  bgInputBorder: string;
  bgModal: string;
  bgOverlay: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  // Borders & dividers
  borderLight: string;
  borderMedium: string;
  // Accent
  accentPrimary: string;
  accentHover: string;
  accentGradient: string;
  // Status
  statusGreen: string;
  statusRed: string;
  statusYellow: string;
  statusBlue: string;
  // Special
  scrollbarThumb: string;
  scrollbarTrack: string;
  statsBarBg: string;
  // Select dropdown
  selectOptionBg: string;
  selectOptionText: string;
}

const dark: ThemeColors = {
  bgApp: '#0a0a14',
  bgSidebar: '#0d0d1a',
  bgMain: '#0f0f23',
  bgTitlebar: '#0a0a16',
  bgCard: 'rgba(255,255,255,0.04)',
  bgCardHover: 'rgba(255,255,255,0.08)',
  bgInput: 'rgba(255,255,255,0.04)',
  bgInputBorder: 'rgba(255,255,255,0.08)',
  bgModal: '#0f0f23',
  bgOverlay: 'rgba(0,0,0,0.7)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0f172a',
  borderLight: 'rgba(255,255,255,0.06)',
  borderMedium: 'rgba(255,255,255,0.10)',
  accentPrimary: '#7c3aed',
  accentHover: '#8b5cf6',
  accentGradient: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
  statusGreen: '#22c55e',
  statusRed: '#ef4444',
  statusYellow: '#f59e0b',
  statusBlue: '#3b82f6',
  scrollbarThumb: 'rgba(255,255,255,0.15)',
  scrollbarTrack: 'transparent',
  statsBarBg: 'rgba(0,0,0,0.15)',
  selectOptionBg: '#1a1a26',
  selectOptionText: '#f1f5f9',
};

const light: ThemeColors = {
  bgApp: '#f0f2f5',
  bgSidebar: '#f5f6f8',
  bgMain: '#ffffff',
  bgTitlebar: '#e8eaed',
  bgCard: 'rgba(0,0,0,0.03)',
  bgCardHover: 'rgba(0,0,0,0.06)',
  bgInput: 'rgba(0,0,0,0.03)',
  bgInputBorder: 'rgba(0,0,0,0.10)',
  bgModal: '#ffffff',
  bgOverlay: 'rgba(0,0,0,0.3)',
  textPrimary: '#1a1a2e',
  textSecondary: '#5a5a7a',
  textMuted: '#9090a0',
  textInverse: '#ffffff',
  borderLight: 'rgba(0,0,0,0.06)',
  borderMedium: 'rgba(0,0,0,0.10)',
  accentPrimary: '#6d28d9',
  accentHover: '#7c3aed',
  accentGradient: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
  statusGreen: '#16a34a',
  statusRed: '#dc2626',
  statusYellow: '#d97706',
  statusBlue: '#2563eb',
  scrollbarThumb: 'rgba(0,0,0,0.15)',
  scrollbarTrack: 'transparent',
  statsBarBg: 'rgba(0,0,0,0.03)',
  selectOptionBg: '#ffffff',
  selectOptionText: '#1a1a2e',
};

export const THEMES: Record<ThemeId, ThemeColors> = { dark, light };

export const THEME_LABELS: Record<ThemeId, string> = {
  dark: '暗色',
  light: '亮色',
};

export function getTheme(id: string): ThemeColors {
  return THEMES[id as ThemeId] ?? dark;
}
