// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

interface MetricRow {
  ts: number;
  [key: string]: number | string | null;
}

interface TokenChartProps {
  data: MetricRow[];
  loading: boolean;
}

export default function TokenChart({ data, loading }: TokenChartProps) {
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
    const timestamps = new Float64Array(data.map((d) => d.ts / 1000)); // Convert ms to seconds
    const inputTokens = new Float64Array(data.map((d) => (d.input_tokens as number) || 0));
    const outputTokens = new Float64Array(data.map((d) => (d.output_tokens as number) || 0));

    const chartData = [timestamps, inputTokens, outputTokens] as uPlot.AlignedData;

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
        title: 'Token 使用',
        scales: {
          x: { time: true },
          y: { auto: true },
        },
        series: [
          {},
          {
            label: 'Input',
            stroke: 'blue',
            fill: 'rgba(0,0,255,0.1)',
          },
          {
            label: 'Output',
            stroke: 'green',
            fill: 'rgba(0,255,0,0.1)',
          },
        ],
        axes: [
          {},
          {
            values: (_u, vals) => vals.map((v) => v.toLocaleString()),
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