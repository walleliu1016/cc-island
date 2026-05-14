// APM API Service
// Connects to APM Server for metrics data

const DEFAULT_APM_URL = 'http://localhost:17530';

interface ApmSettings {
  apm_enabled: boolean;
  apm_server_url: string | null;
  apm_user_id: string | null;
}

interface QueryResult {
  output: Array<{
    records: {
      rows: Array<Array<string | number | null>>;
      schema: {
        column_schemas: Array<{ name: string; data_type: string }>;
      };
    };
  }>;
}

interface MetricRow {
  ts: number;
  [key: string]: number | string | null;
}

function getUserId(): string {
  // Get from localStorage or use hostname
  const stored = localStorage.getItem('apm_user_id');
  if (stored) return stored;

  // Default to hostname (will be set from settings)
  return 'unknown';
}

function getApmServerUrl(): string {
  const stored = localStorage.getItem('apm_server_url');
  if (stored) return stored;
  return DEFAULT_APM_URL;
}

export const apmApi = {
  // Query metrics from APM Server
  async query(sql: string): Promise<MetricRow[]> {
    const url = getApmServerUrl();
    const userId = getUserId();

    const response = await fetch(`${url}/api/query?sql=${encodeURIComponent(sql)}`, {
      headers: {
        'X-User-ID': userId,
      },
    });

    if (!response.ok) {
      throw new Error(`APM query failed: ${response.status}`);
    }

    const data: QueryResult = await response.json();

    // Parse GreptimeDB response format
    if (!data.output || data.output.length === 0) {
      return [];
    }

    const records = data.output[0].records;
    const columns = records.schema.column_schemas.map(c => c.name);
    const rows = records.rows;

    // Convert to object format
    return rows.map(row => {
      const obj: MetricRow = { ts: 0 };
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  },

  // Get token usage metrics
  async getTokenUsage(rangeMinutes: number = 60): Promise<MetricRow[]> {
    const sql = `
      SELECT ts, user_id, device_id, model,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cache_read_tokens) as cache_read_tokens,
        SUM(cost_usd) as cost_usd,
        COUNT(*) as request_count
      FROM tma1_token_usage_1m
      WHERE ts > NOW() - INTERVAL '${rangeMinutes} minutes'
      GROUP BY ts, user_id, device_id, model
      ORDER BY ts DESC
      LIMIT 100
    `;
    return this.query(sql);
  },

  // Get cost metrics
  async getCostMetrics(rangeMinutes: number = 60): Promise<MetricRow[]> {
    const sql = `
      SELECT ts, SUM(cost_usd) as cost_usd
      FROM tma1_cost_1m
      WHERE ts > NOW() - INTERVAL '${rangeMinutes} minutes'
      GROUP BY ts
      ORDER BY ts DESC
      LIMIT 100
    `;
    return this.query(sql);
  },

  // Get session list
  async getSessionList(): Promise<MetricRow[]> {
    const sql = `
      SELECT session_id, user_id, device_id, project_name,
        start_ts, end_ts, status
      FROM tma1_session_registry
      ORDER BY start_ts DESC
      LIMIT 50
    `;
    return this.query(sql);
  },

  // Get session-specific metrics
  async getSessionMetrics(sessionId: string, rangeHours: number = 24): Promise<{
    totalCost: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
    model: string;
  }> {
    const rangeMinutes = rangeHours * 60;

    const data = await this.query(`
      SELECT
        SUM(cost_usd) as total_cost,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        COUNT(*) as request_count,
        model
      FROM tma1_messages
      WHERE session_id = '${sessionId}'
        AND ts > NOW() - INTERVAL '${rangeMinutes} minutes'
      GROUP BY model
      ORDER BY total_cost DESC
      LIMIT 1
    `);

    const row = data[0];
    return {
      totalCost: Number(row?.total_cost) || 0,
      totalTokens: Number(row?.input_tokens || 0) + Number(row?.output_tokens || 0),
      inputTokens: Number(row?.input_tokens) || 0,
      outputTokens: Number(row?.output_tokens) || 0,
      requestCount: Number(row?.request_count) || 0,
      model: String(row?.model || 'unknown'),
    };
  },

  // Get session token usage timeline
  async getSessionTokenTimeline(sessionId: string, rangeMinutes: number = 60): Promise<MetricRow[]> {
    const sql = `
      SELECT ts, model,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cost_usd) as cost_usd
      FROM tma1_messages
      WHERE session_id = '${sessionId}'
        AND ts > NOW() - INTERVAL '${rangeMinutes} minutes'
      GROUP BY ts, model
      ORDER BY ts DESC
      LIMIT 100
    `;
    return this.query(sql);
  },

  // Get session cost timeline
  async getSessionCostTimeline(sessionId: string, rangeMinutes: number = 60): Promise<MetricRow[]> {
    const sql = `
      SELECT ts, SUM(cost_usd) as cost_usd
      FROM tma1_messages
      WHERE session_id = '${sessionId}'
        AND ts > NOW() - INTERVAL '${rangeMinutes} minutes'
      GROUP BY ts
      ORDER BY ts DESC
      LIMIT 100
    `;
    return this.query(sql);
  },

  // Get summary metrics (KPI cards)
  async getSummary(rangeHours: number = 24): Promise<{
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    sessionCount: number;
  }> {
    const rangeMinutes = rangeHours * 60;

    // Get cost sum
    const costData = await this.query(`
      SELECT SUM(cost_usd) as total_cost
      FROM tma1_messages
      WHERE ts > NOW() - INTERVAL '${rangeMinutes} minutes'
    `);

    // Get token sum
    const tokenData = await this.query(`
      SELECT SUM(input_tokens + output_tokens) as total_tokens,
        COUNT(*) as request_count
      FROM tma1_messages
      WHERE ts > NOW() - INTERVAL '${rangeMinutes} minutes'
    `);

    // Get session count
    const sessionData = await this.query(`
      SELECT COUNT(*) as session_count
      FROM tma1_session_registry
      WHERE start_ts > NOW() - INTERVAL '${rangeMinutes} minutes'
    `);

    return {
      totalCost: Number(costData[0]?.total_cost) || 0,
      totalTokens: Number(tokenData[0]?.total_tokens) || 0,
      requestCount: Number(tokenData[0]?.request_count) || 0,
      sessionCount: Number(sessionData[0]?.session_count) || 0,
    };
  },

  // Configure APM settings
  configure(settings: ApmSettings) {
    if (settings.apm_server_url) {
      localStorage.setItem('apm_server_url', settings.apm_server_url);
    }
    if (settings.apm_user_id) {
      localStorage.setItem('apm_user_id', settings.apm_user_id);
    }
  },
};