// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
interface MetricsCardProps {
  label: string;
  value: string;
}

export default function MetricsCard({ label, value }: MetricsCardProps) {
  return (
    <div className="bg-slate-800 rounded-lg p-2 flex flex-col">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-slate-200 text-sm font-medium">{value}</span>
    </div>
  );
}