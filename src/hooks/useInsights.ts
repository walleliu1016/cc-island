// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback } from 'react';

export interface ApiCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  duration_ms: number;
  ts: number;
}

export interface FileActivity {
  path: string;
  reads: number;
  writes: number;
}

export interface ContextBreakdown {
  system: number;
  user: number;
  tools: number;
  reasoning: number;
}

export interface AgentInfo {
  id: string;
  tool_count: number;
  children: AgentInfo[];
}

function getApmApiUrl(): string {
  // APM Query API uses HTTP, not WebSocket
  // Default to localhost:17529 for local Cloud Server
  return localStorage.getItem('apm_api_url') || 'http://localhost:17529';
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

export function useInsights(sessionId: string, rangeHours: number) {
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [files, setFiles] = useState<FileActivity[]>([]);
  const [context, setContext] = useState<ContextBreakdown | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const baseUrl = getApmApiUrl();
      const userId = getUserId();

      // Load API calls from messages table
      const callsResp = await fetch(
        `${baseUrl}/api/apm/query?sql=${encodeURIComponent(
          `SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output,
           SUM(cache_read_tokens) as cache, SUM(cost_usd) as cost, COUNT(*) as count
           FROM messages WHERE session_id = '${sessionId}' AND role = 'assistant'
           GROUP BY model ORDER BY cost DESC`
        )}`,
        { headers: { 'X-User-ID': userId } }
      );

      if (!callsResp.ok) {
        throw new Error(`HTTP error: ${callsResp.status}`);
      }

      const callsData: QueryResult = await callsResp.json();

      // Parse GreptimeDB response format
      if (callsData.output && callsData.output.length > 0) {
        const callsRows = callsData.output[0].records.rows;
        setApiCalls(callsRows.map((r) => ({
          model: String(r[0] || 'unknown'),
          input_tokens: Number(r[1]) || 0,
          output_tokens: Number(r[2]) || 0,
          cache_read_tokens: Number(r[3]) || 0,
          cost_usd: Number(r[4]) || 0,
          duration_ms: 0,
          ts: 0,
        })));
      } else {
        setApiCalls([]);
      }

      // Load file activity (from hook_events tool_name=Read/Write/Edit)
      const filesResp = await fetch(
        `${baseUrl}/api/apm/query?sql=${encodeURIComponent(
          `SELECT tool_name, COUNT(*) as count FROM hook_events
           WHERE session_id = '${sessionId}' AND tool_name IN ('Read', 'Write', 'Edit')
           GROUP BY tool_name`
        )}`,
        { headers: { 'X-User-ID': userId } }
      );

      if (filesResp.ok) {
        const filesData: QueryResult = await filesResp.json();

        if (filesData.output && filesData.output.length > 0) {
          const filesRows = filesData.output[0].records.rows;
          const readCount = filesRows.find((r) => r[0] === 'Read')?.[1] || 0;
          const writeCount = filesRows.filter((r) =>
            r[0] === 'Write' || r[0] === 'Edit'
          ).reduce((sum, r) => sum + (Number(r[1]) || 0), 0);
          setFiles([{ path: 'All files', reads: Number(readCount) || 0, writes: writeCount }]);
        } else {
          setFiles([]);
        }
      }

      // Mock context breakdown (would need detailed token analysis)
      setContext({ system: 15, user: 40, tools: 30, reasoning: 15 });

      // Load agent tree from hook_events
      const agentsResp = await fetch(
        `${baseUrl}/api/apm/query?sql=${encodeURIComponent(
          `SELECT agent_id, COUNT(*) as tool_count FROM hook_events
           WHERE session_id = '${sessionId}' AND tool_name IS NOT NULL
           GROUP BY agent_id`
        )}`,
        { headers: { 'X-User-ID': userId } }
      );

      if (agentsResp.ok) {
        const agentsData: QueryResult = await agentsResp.json();

        if (agentsData.output && agentsData.output.length > 0) {
          const agentsRows = agentsData.output[0].records.rows;
          setAgents(agentsRows.map((r) => ({
            id: String(r[0] || 'main'),
            tool_count: Number(r[1]) || 0,
            children: [],
          })));
        } else {
          setAgents([]);
        }
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [sessionId, rangeHours]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  return { apiCalls, files, context, agents, loading, error, reload: loadInsights };
}