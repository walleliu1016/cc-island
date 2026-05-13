// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

interface MetricRow {
  ts: number;
  [key: string]: number | string | null;
}

interface CostChartProps {
  data: MetricRow[];
  loading: boolean;
}

export default function CostChart({ data, loading }: CostChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current || loading || data.length === 0) {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
      return;
    }

    // Prepare data for uPlot
    const timestamps = new Float64Array(data.map((d) => d.ts / 1000));
    const costs = new Float64Array(data.map((d) => (d.cost_usd as number) || 0));

    const chartData = [timestamps, costs] as uPlot.AlignedData;

    // Destroy previous plot
    if (plotRef.current) {
      plotRef.current.destroy();
    }

    // Create new plot
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 100;

    plotRef.current = new uPlot(
      {
        width,
        height,
        title: '成本 (USD)',
        scales: {
          x: { time: true },
          y: { auto: true },
        },
        series: [
          {},
          {
            label: 'Cost',
            stroke: 'orange',
            fill: 'rgba(255,165,0,0.1)',
          },
        ],
        axes: [
          {},
          {
            values: (_u, vals) => vals.map((v) => `$${v.toFixed(4)}`),
          },
        ],
      },
      chartData,
      containerRef.current
    );

    return () => {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, [data, loading]);

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-2 h-full flex items-center justify-center">
        <span className="text-slate-400 text-xs">加载中...</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-2 h-full flex items-center justify-center">
        <span className="text-slate-400 text-xs">无数据</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="bg-slate-800 rounded-lg p-1 h-full" />
  );
}