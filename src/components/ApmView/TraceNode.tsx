// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import type { TraceNode } from '../../hooks/useTraceData';

interface TraceNodeProps {
  node: TraceNode;
  color: string;
  depth: number;
  colors: Record<string, string>;
}

export default function TraceNodeComponent({ node, color, depth, colors }: TraceNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const durationStr = node.duration > 0
    ? `${(node.duration / 1000).toFixed(1)}s`
    : '...';

  return (
    <div className="flex flex-col">
      {/* Node row */}
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/collapse indicator */}
        {hasChildren && (
          <span className="text-white/50 text-xs w-4">
            {expanded ? '▼' : '▶'}
          </span>
        )}

        {/* Color bar */}
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />

        {/* Name */}
        <span className="text-sm text-white/80 flex-1 truncate">
          {node.name}
        </span>

        {/* Duration */}
        <span className="text-xs text-white/50">
          {durationStr}
        </span>

        {/* Status indicator */}
        {node.status === 'running' && (
          <span className="text-xs text-amber-400 animate-pulse">●</span>
        )}
        {node.status === 'failed' && (
          <span className="text-xs text-red-400">✗</span>
        )}
      </div>

      {/* Children (if expanded) */}
      {expanded && hasChildren && (
        <div className="flex flex-col">
          {node.children!.map((child) => (
            <TraceNodeComponent
              key={child.id}
              node={child}
              color={colors[child.type] || color}
              depth={depth + 1}
              colors={colors}
            />
          ))}
        </div>
      )}
    </div>
  );
}