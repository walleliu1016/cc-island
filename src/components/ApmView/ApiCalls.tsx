// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

interface ApiCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

interface ApiCallsProps {
  calls: ApiCall[];
}

export default function ApiCalls({ calls }: ApiCallsProps) {
  if (calls.length === 0) {
    return <div className="text-white/50 text-xs">无 API 调用数据</div>;
  }

  return (
    <div className="bg-white/5 rounded p-3">
      <h3 className="text-xs text-white/70 mb-2">API Calls</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/50">
              <th className="py-1 px-2 text-left">Model</th>
              <th className="py-1 px-2 text-right">Input</th>
              <th className="py-1 px-2 text-right">Output</th>
              <th className="py-1 px-2 text-right">Cache</th>
              <th className="py-1 px-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, i) => (
              <tr key={i} className="text-white/80">
                <td className="py-1 px-2 truncate max-w-32">{call.model}</td>
                <td className="py-1 px-2 text-right">{call.input_tokens?.toLocaleString()}</td>
                <td className="py-1 px-2 text-right">{call.output_tokens?.toLocaleString()}</td>
                <td className="py-1 px-2 text-right">{call.cache_read_tokens?.toLocaleString()}</td>
                <td className="py-1 px-2 text-right">${(call.cost_usd || 0).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}