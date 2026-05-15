// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useTraceData } from '../../hooks/useTraceData';

interface TraceTabProps {
  sessionId: string;
  rangeHours: number;
}

export default function TraceTab({ sessionId, rangeHours }: TraceTabProps) {
  const { nodes, loading, error } = useTraceData(sessionId, rangeHours);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        无 Trace 数据
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* TraceTree will be rendered here in Task 3.3 */}
      <div className="text-white/50 text-sm">
        {nodes.length} trace node(s) loaded
      </div>
      {/* Placeholder for TraceTree component */}
      <div className="text-xs text-white/30">
        TraceTree component will be added in Task 3.3
      </div>
    </div>
  );
}