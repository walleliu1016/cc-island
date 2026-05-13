// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import 'uplot/dist/uPlot.min.css';
import { apmApi } from '../../services/apmApi';
import MetricsCard from './MetricsCard';
import TokenChart from './TokenChart';
import CostChart from './CostChart';
import SessionList from './SessionList';

interface ApmViewProps {
  onClose?: () => void;
}

interface MetricRow {
  ts: number;
  [key: string]: number | string | null;
}

export default function ApmView({ onClose }: ApmViewProps) {
  const [metrics, setMetrics] = useState({
    totalCost: 0,
    totalTokens: 0,
    requestCount: 0,
    sessionCount: 0,
  });
  const [tokenData, setTokenData] = useState<MetricRow[]>([]);
  const [costData, setCostData] = useState<MetricRow[]>([]);
  const [sessions, setSessions] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState(24);

  useEffect(() => {
    loadMetrics();
  }, [rangeHours]);

  const loadMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, tokens, costs, sess] = await Promise.all([
        apmApi.getSummary(rangeHours),
        apmApi.getTokenUsage(rangeHours * 60),
        apmApi.getCostMetrics(rangeHours * 60),
        apmApi.getSessionList(),
      ]);
      setMetrics(summary);
      setTokenData(tokens);
      setCostData(costs);
      setSessions(sess);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    loadMetrics();
  };

  return (
    <div className="flex flex-col h-full px-2 pb-3">
      {/* Header with back button */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white/80 text-xs flex items-center gap-1"
        >
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <select
            value={rangeHours}
            onChange={(e) => setRangeHours(Number(e.target.value))}
            className="bg-slate-800 text-slate-200 rounded px-2 py-1 text-xs"
          >
            <option value={1}>1小时</option>
            <option value={6}>6小时</option>
            <option value={12}>12小时</option>
            <option value={24}>24小时</option>
            <option value={72}>3天</option>
          </select>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
          >
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-red-400 text-xs mb-2"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-2 mb-2">
        <MetricsCard label="总成本" value={`$${metrics.totalCost.toFixed(4)}`} />
        <MetricsCard label="总Token" value={metrics.totalTokens.toLocaleString()} />
        <MetricsCard label="请求数" value={metrics.requestCount.toLocaleString()} />
        <MetricsCard label="Session" value={metrics.sessionCount.toLocaleString()} />
      </div>

      {/* Charts */}
      <div className="flex-1 flex flex-col gap-2 overflow-hidden">
        <div className="flex-1 min-h-0">
          <TokenChart data={tokenData} loading={loading} />
        </div>
        <div className="flex-1 min-h-0">
          <CostChart data={costData} loading={loading} />
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <SessionList sessions={sessions} />
        </div>
      </div>
    </div>
  );
}