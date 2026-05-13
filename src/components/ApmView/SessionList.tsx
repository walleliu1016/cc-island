// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
interface MetricRow {
  ts: number;
  [key: string]: number | string | null;
}

interface SessionListProps {
  sessions: MetricRow[];
}

export default function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-2 h-full flex items-center justify-center">
        <span className="text-slate-400 text-xs">无 Session 数据</span>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg p-1 h-full overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 border-b border-slate-700">
            <th className="px-1 py-1">Session</th>
            <th className="px-1 py-1">项目</th>
            <th className="px-1 py-1">状态</th>
            <th className="px-1 py-1">开始时间</th>
          </tr>
        </thead>
        <tbody>
          {sessions.slice(0, 20).map((s, i) => (
            <tr key={i} className="text-slate-200 border-b border-slate-700/50">
              <td className="px-1 py-1 truncate max-w-[80px]">
                {(s.session_id as string)?.slice(0, 8) || '-'}
              </td>
              <td className="px-1 py-1 truncate max-w-[100px]">
                {(s.project_name as string) || '-'}
              </td>
              <td className="px-1 py-1">
                <span
                  className={`px-1 rounded ${
                    s.status === 'active'
                      ? 'bg-green-900 text-green-400'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {(s.status as string) || '-'}
                </span>
              </td>
              <td className="px-1 py-1">
                {s.start_ts
                  ? new Date(s.start_ts as number).toLocaleTimeString()
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}