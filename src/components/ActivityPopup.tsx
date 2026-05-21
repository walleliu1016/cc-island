// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useState, useCallback } from 'react';
import { ToolActivityDetail } from '../types';

interface ActivityPopupProps {
  activities: ToolActivityDetail[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement>;
}

export function ActivityPopup({ activities, onClose, anchorRef }: ActivityPopupProps) {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 300, placement: 'below' as 'below' | 'above' });

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return;

    const rect = anchorRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const minPopupHeight = 100; // Minimum height for at least a few items
    const preferredHeight = Math.min(activities.length * 28 + 40, 300);

    // Check available space below and above
    const spaceBelow = viewportHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    let placement: 'below' | 'above';
    let top: number;
    let maxHeight: number;

    if (spaceBelow >= minPopupHeight) {
      // Place below with dynamic height
      placement = 'below';
      top = rect.bottom + 4;
      maxHeight = Math.min(spaceBelow, preferredHeight);
    } else if (spaceAbove >= minPopupHeight) {
      // Place above with dynamic height
      placement = 'above';
      maxHeight = Math.min(spaceAbove, preferredHeight);
      top = rect.top - 4 - maxHeight;
    } else {
      // Fallback: place below with minimal height
      placement = 'below';
      top = rect.bottom + 4;
      maxHeight = Math.max(spaceBelow, 80);
    }

    setPosition({
      top,
      left: rect.left,
      width: rect.width,
      maxHeight,
      placement,
    });
  }, [anchorRef, activities.length]);

  useEffect(() => {
    updatePosition();
  }, [updatePosition]);

  // Update position on resize
  useEffect(() => {
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [updatePosition]);

  // Scroll the anchor element into view if needed
  useEffect(() => {
    if (anchorRef.current && position.placement === 'below') {
      anchorRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [anchorRef, position.placement]);

  return createPortal(
    <>
      {/* Backdrop to close on click outside */}
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, y: position.placement === 'above' ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: position.placement === 'above' ? 10 : -10 }}
        className="fixed z-[9999]"
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          background: 'rgba(30,30,30,0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '6px',
          maxHeight: `${position.maxHeight}px`,
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1 px-1">
          <span className="text-white/60" style={{ fontSize: 10 }}>
            最近{activities.length}条活动
          </span>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors"
            style={{ fontSize: 10 }}
          >
            关闭
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          {activities.map((act, i) => (
            <ActivityRow key={act.id || i} activity={act} />
          ))}
        </div>
      </motion.div>
    </>,
    document.body
  );
}

function ActivityRow({ activity }: { activity: ToolActivityDetail }) {
  const time = new Date(activity.timestamp * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Status styles with clear differentiation
  const statusConfig = {
    running: { bg: 'rgba(76,175,80,0.15)', color: '#4caf50', icon: '●' },
    success: { bg: 'rgba(76,175,80,0.08)', color: '#4caf50', icon: '✓' },
    error: { bg: 'rgba(244,67,54,0.15)', color: '#f44336', icon: '✗' },
  };

  const style = statusConfig[activity.status as keyof typeof statusConfig] || statusConfig.success;

  // Build tooltip with full content and result
  const tooltip = [
    `工具: ${activity.tool_name}`,
    `内容: ${activity.content || '无'}`,
    activity.result ? `结果: ${activity.result}` : '',
  ].filter(Boolean).join('\n');

  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-1 rounded cursor-default hover:bg-white/[0.05] transition-colors"
      style={{ background: style.bg, fontSize: 11 }}
      title={tooltip}
    >
      {/* Status icon */}
      <span style={{ color: style.color, fontSize: 10 }}>{style.icon}</span>

      {/* Tool name */}
      <span className="font-medium shrink-0" style={{ color: style.color }}>
        {activity.tool_name}
      </span>

      {/* Content - use full width */}
      <span className="text-white/70 truncate flex-1" style={{ minWidth: 0 }}>
        {activity.content || ''}
      </span>

      {/* Time */}
      <span className="text-white/40 shrink-0" style={{ fontSize: 10 }}>{time}</span>
    </div>
  );
}