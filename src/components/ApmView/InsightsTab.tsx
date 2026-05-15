// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useInsights } from '../../hooks/useInsights';
import ApiCalls from './ApiCalls';

interface InsightsTabProps {
  sessionId: string;
  rangeHours: number;
}

export default function InsightsTab({ sessionId, rangeHours }: InsightsTabProps) {
  const { apiCalls, files, context, agents, loading, error } = useInsights(sessionId, rangeHours);

  if (loading) {
    return <div className="text-white/50 text-sm p-4">加载中...</div>;
  }

  if (error) {
    return <div className="text-red-400 text-sm p-4">{error}</div>;
  }

  return (
    <div className="space-y-4 p-2">
      {/* API Calls */}
      <ApiCalls calls={apiCalls} />

      {/* Files Heatmap (simple version) */}
      <div className="bg-white/5 rounded p-3">
        <h3 className="text-xs text-white/70 mb-2">Files Activity</h3>
        {files.length === 0 ? (
          <div className="text-white/50 text-xs">无文件活动数据</div>
        ) : (
          files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="text-xs text-white/80 flex-1 truncate">{f.path}</span>
              <span className="text-xs text-blue-400">{f.reads} reads</span>
              <span className="text-xs text-orange-400">{f.writes} writes</span>
            </div>
          ))
        )}
      </div>

      {/* Context Breakdown */}
      {context && (
        <div className="bg-white/5 rounded p-3">
          <h3 className="text-xs text-white/70 mb-2">Context Window</h3>
          <div className="space-y-1">
            {Object.entries(context).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-white/50 w-16 capitalize">{key}</span>
                <div className="flex-1 bg-white/10 rounded h-2">
                  <div
                    className="bg-blue-400 h-2 rounded"
                    style={{ width: `${value}%` }}
                  />
                </div>
                <span className="text-xs text-white/50">{value}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Tree */}
      <div className="bg-white/5 rounded p-3">
        <h3 className="text-xs text-white/70 mb-2">Agent Tree</h3>
        {agents.length === 0 ? (
          <div className="text-white/50 text-xs">无 Agent 数据</div>
        ) : (
          agents.map((agent, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="text-xs text-white/80">
                <span className="text-green-400 mr-1">●</span>
                {agent.id.slice(0, 8)}
              </span>
              <span className="text-xs text-white/50">{agent.tool_count} tools</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}