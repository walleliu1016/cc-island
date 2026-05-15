// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback } from 'react';

export interface TraceNode {
  id: string;
  type: 'agent' | 'llm' | 'tool' | 'wait' | 'exec' | 'error';
  name: string;
  startTime: number;
  duration: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  children?: TraceNode[];
  details?: {
    tool_input?: string;
    tool_result?: string;
    model?: string;
    tokens?: { input: number; output: number };
    cost?: number;
  };
}

export interface HookEvent {
  ts: number;
  event_type: string;
  tool_name: string;
  tool_use_id: string;
  agent_id: string;
  parent_agent_id: string;
  duration_ms: number;
  success: boolean;
}

export const TYPE_COLORS: Record<TraceNode['type'], string> = {
  agent: '#8b5cf6',
  llm: '#3b82f6',
  tool: '#22c55e',
  wait: '#f97316',
  exec: '#22c55e',
  error: '#ef4444',
};

function getCloudServerUrl(): string {
  return localStorage.getItem('cloud_server_url') || 'http://localhost:17529';
}

function getUserId(): string {
  return localStorage.getItem('apm_user_id') || 'unknown';
}

interface QueryResult {
  output: Array<{
    records: {
      rows: Array<Array<string | number | null | boolean>>;
      schema: {
        column_schemas: Array<{ name: string; data_type: string }>;
      };
    };
  }>;
}

function buildFromHookEvents(events: HookEvent[]): TraceNode[] {
  const agentMap = new Map<string, TraceNode>();
  const toolMap = new Map<string, TraceNode>();

  // Sort events by timestamp
  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);

  for (const event of sortedEvents) {
    if (event.event_type === 'SubagentStart') {
      const node: TraceNode = {
        id: event.agent_id,
        type: 'agent',
        name: `Subagent ${event.agent_id.slice(0, 8)}`,
        startTime: event.ts,
        duration: 0,
        status: 'running',
        children: [],
      };
      agentMap.set(event.agent_id, node);

      // Link to parent
      if (event.parent_agent_id && agentMap.has(event.parent_agent_id)) {
        agentMap.get(event.parent_agent_id)?.children?.push(node);
      }
    }

    if (event.event_type === 'PreToolUse') {
      const node: TraceNode = {
        id: event.tool_use_id,
        type: event.tool_name === 'AskUserQuestion' ? 'wait' : 'tool',
        name: event.tool_name,
        startTime: event.ts,
        duration: 0,
        status: 'running',
      };
      toolMap.set(event.tool_use_id, node);

      // Link to agent
      if (event.agent_id && agentMap.has(event.agent_id)) {
        agentMap.get(event.agent_id)?.children?.push(node);
      }
    }

    if (event.event_type === 'PostToolUse' && toolMap.has(event.tool_use_id)) {
      const node = toolMap.get(event.tool_use_id)!;
      node.duration = event.duration_ms;
      node.status = event.success ? 'completed' : 'failed';
      if (!event.success) node.type = 'error';
    }
  }

  // Return root agents (no parent_agent_id)
  return sortedEvents
    .filter(e => e.event_type === 'SubagentStart' && !e.parent_agent_id)
    .map(e => agentMap.get(e.agent_id)!)
    .filter(Boolean);
}

export function useTraceData(sessionId: string, rangeHours: number) {
  const [nodes, setNodes] = useState<TraceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTraceData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Query hook_events from Cloud Server
      const response = await fetch(
        `${getCloudServerUrl()}/api/apm/query?sql=${encodeURIComponent(
          `SELECT * FROM hook_events WHERE session_id = '${sessionId}' ORDER BY ts ASC`
        )}`,
        {
          headers: { 'X-User-ID': getUserId() },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data: QueryResult = await response.json();

      // Parse GreptimeDB response format
      if (!data.output || data.output.length === 0) {
        setNodes([]);
        return;
      }

      const records = data.output[0].records;
      const columns = records.schema.column_schemas.map(c => c.name);
      const rows = records.rows;

      // Convert to HookEvent objects
      const events: HookEvent[] = rows.map(row => {
        const obj: Record<string, string | number | boolean | null> = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return {
          ts: Number(obj.ts) || 0,
          event_type: String(obj.event_type || ''),
          tool_name: String(obj.tool_name || ''),
          tool_use_id: String(obj.tool_use_id || ''),
          agent_id: String(obj.agent_id || ''),
          parent_agent_id: String(obj.parent_agent_id || ''),
          duration_ms: Number(obj.duration_ms) || 0,
          success: Boolean(obj.success),
        };
      });

      // Build tree from hook events
      const tree = buildFromHookEvents(events);
      setNodes(tree);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [sessionId, rangeHours]);

  useEffect(() => {
    loadTraceData();
  }, [loadTraceData]);

  return { nodes, loading, error, TYPE_COLORS, reload: loadTraceData };
}