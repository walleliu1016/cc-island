// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { StatsResponse } from '../types';

interface WelcomeViewProps {
  stats: StatsResponse;
  productName: string;
  onSelectSession: (sessionId: string) => void;
  onOpenSettings: () => void;
}

export function WelcomeView({ stats, productName }: WelcomeViewProps) {
  const initials = (productName || 'C').charAt(0).toUpperCase();

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-10 overflow-hidden" style={{ background: '#0d0d14' }}>
      {/* Logo icon */}
      <div
        className="flex items-center justify-center font-extrabold text-white"
        style={{
          width: 80, height: 80, borderRadius: 20,
          background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
          fontSize: 36,
          boxShadow: '0 12px 40px rgba(124,58,237,0.25)',
        }}
      >
        {initials}
      </div>

      {/* Title */}
      <div className="text-2xl font-bold text-[#f1f5f9]">{productName || 'CC-Island'}</div>
      <div className="text-sm text-[#64748b] -mt-3">Claude Code 会话管理中心</div>

      {/* Stats cards */}
      <div className="flex gap-3.5 mt-1.5">
        <StatCard label="会话" value={stats.session_count} color="#8b5cf6" />
        <StatCard label="消息" value={stats.message_count} color="#60a5fa" />
        <StatCard label="调用" value={stats.tool_count} color="#f59e0b" />
        <StatCard label="进行中" value={stats.active_count} color="#10b981" />
      </div>

      {/* Hint */}
      <div className="text-sm text-[#64748b] opacity-50 mt-4">
        从左侧选择一个会话以查看详情
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex flex-col items-center px-5 py-4 rounded-xl min-w-[96px]"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span className="text-2xl font-bold" style={{ color }}>{value}</span>
      <span className="text-xs text-[#64748b] mt-1">{label}</span>
    </div>
  );
}
