// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { motion, AnimatePresence } from 'framer-motion';
import { ToolActivityDetail } from '../types';

interface ActivityPopupProps {
  activities: ToolActivityDetail[];
  onClose: () => void;
}

export function ActivityPopup({ activities, onClose }: ActivityPopupProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute left-0 right-0 z-10 mt-2"
        style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '8px',
        }}
      >
        <div className="flex items-center justify-between mb-2 px-2">
          <span className="text-gray-400" style={{ fontSize: 11 }}>最近10条活动</span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            style={{ fontSize: 10 }}
          >
            点击查看完整内容
          </button>
        </div>

        <div className="flex flex-col gap-1">
          {activities.map((act, i) => (
            <ActivityRow key={i} activity={act} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ActivityRow({ activity }: { activity: ToolActivityDetail }) {
  const time = new Date(activity.timestamp * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const statusStyle = activity.status === 'running'
    ? { bg: 'rgba(76,175,80,0.1)', color: '#4caf50' }
    : activity.status === 'error'
    ? { bg: 'rgba(244,67,54,0.08)', color: '#f44336' }
    : { bg: 'rgba(255,255,255,0.03)', color: '#aaa' };

  return (
    <div
      className="flex items-start gap-2 p-1 rounded"
      style={{ background: statusStyle.bg, fontSize: 11 }}
    >
      <span className="text-gray-500" style={{ fontSize: 10, width: '50px' }}>{time}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium" style={{ color: statusStyle.color }}>
            {activity.tool_name}
          </span>
          <span className="text-gray-400 truncate max-w-48">
            {truncateContent(activity.content, 40)}
          </span>
        </div>
        {activity.result && (
          <div className="text-gray-400 mt-0.5" style={{ fontSize: 10 }}>
            {activity.status === 'success' && <span style={{ color: '#4caf50' }}>✓</span>}
            {activity.status === 'error' && <span style={{ color: '#f44336' }}>✗</span>}
            {activity.status === 'running' && <span style={{ color: '#4caf50' }}>●</span>}
            {' '}{truncateContent(activity.result, 50)}
          </div>
        )}
      </div>
    </div>
  );
}

function truncateContent(content: string, maxLen: number): string {
  if (!content) return '';
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '...';
}