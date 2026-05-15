// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import TraceNodeComponent from './TraceNode';
import type { TraceNode } from '../../hooks/useTraceData';

interface TraceTreeProps {
  nodes: TraceNode[];
  colors: Record<string, string>;
}

export default function TraceTree({ nodes, colors }: TraceTreeProps) {
  return (
    <div className="flex flex-col gap-1">
      {nodes.map((node) => (
        <TraceNodeComponent
          key={node.id}
          node={node}
          color={colors[node.type] || '#666'}
          depth={0}
          colors={colors}
        />
      ))}
    </div>
  );
}