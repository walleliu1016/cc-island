// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

import { InstanceStatus } from '../types';

export const StatusColors = {
  running: {
    border: '#4caf50',
    text: '#4caf50',
    bg: 'rgba(76,175,80,0.08)',
    bgHighlight: 'rgba(76,175,80,0.15)',
    icon: '⚡',
  },
  thinking: {
    border: '#ffb700',
    text: '#ffb700',
    bg: 'rgba(255,183,0,0.08)',
    bgHighlight: 'rgba(255,183,0,0.15)',
    icon: '💭',
  },
  idle: {
    border: '#9e9e9e',
    text: '#9e9e9e',
    bg: 'rgba(158,158,158,0.05)',
    bgHighlight: 'rgba(158,158,158,0.10)',
    icon: '●',
  },
  ended: {
    border: '#ff9800',
    text: '#ff9800',
    bg: 'rgba(255,152,0,0.08)',
    bgHighlight: 'rgba(255,152,0,0.15)',
    icon: '●',
  },
  error: {
    border: '#f44336',
    text: '#f44336',
    bg: 'rgba(244,67,54,0.08)',
    bgHighlight: 'rgba(244,67,54,0.15)',
    icon: '⚠',
  },
};

export type StatusType = keyof typeof StatusColors;

// Helper function to convert hex to rgba
export function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getStatusColor(status: InstanceStatus): StatusColorsConfig {
  switch (status.type) {
    case 'working':
    case 'waiting':
      return StatusColors.running;
    case 'thinking':
      return StatusColors.thinking;
    case 'idle':
      return StatusColors.idle;
    case 'ended':
      return StatusColors.ended;
    case 'error':
      return StatusColors.error;
    case 'waitingforapproval':
      return StatusColors.running;
    case 'compacting':
      return StatusColors.thinking;
    default:
      return StatusColors.idle;
  }
}

export type StatusColorsConfig = typeof StatusColors.running;