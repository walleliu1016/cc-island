// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { motion } from 'framer-motion';
import TraceTab from './TraceTab';
import InsightsTab from './InsightsTab';

interface ApmViewProps {
  onClose?: () => void;
  sessionId: string;
}

type TabType = 'trace' | 'insights';

export default function ApmView({ onClose, sessionId }: ApmViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('trace');
  const [rangeHours, setRangeHours] = useState(24);

  return (
    <div className="flex flex-col h-full bg-black/90 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white/80 text-sm flex items-center gap-1"
        >
          ← 返回
        </button>
        <span className="text-white/70 text-sm font-medium">
          Session: {sessionId.slice(0, 8)}...
        </span>
        <select
          value={rangeHours}
          onChange={(e) => setRangeHours(Number(e.target.value))}
          className="bg-slate-800 text-white rounded px-2 py-1 text-xs"
        >
          <option value={1}>1h</option>
          <option value={6}>6h</option>
          <option value={24}>24h</option>
          <option value={168}>7d</option>
        </select>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-4 px-4 py-2 border-b border-white/10">
        <button
          onClick={() => setActiveTab('trace')}
          className={`text-sm px-3 py-1 rounded ${
            activeTab === 'trace'
              ? 'bg-white/20 text-white'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          Trace 视图
        </button>
        <button
          onClick={() => setActiveTab('insights')}
          className={`text-sm px-3 py-1 rounded ${
            activeTab === 'insights'
              ? 'bg-white/20 text-white'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          Insights
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'trace' && (
            <TraceTab sessionId={sessionId} rangeHours={rangeHours} />
          )}
          {activeTab === 'insights' && (
            <InsightsTab sessionId={sessionId} rangeHours={rangeHours} />
          )}
        </motion.div>
      </div>
    </div>
  );
}