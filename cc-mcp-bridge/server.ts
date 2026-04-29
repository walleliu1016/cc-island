#!/usr/bin/env bun
/**
 * CC-MCP-Bridge - Claude Channel MCP Server
 *
 * Bridges Mobile messages to Claude Code via Desktop WebSocket.
 * Each Claude session spawns one MCP Bridge instance.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import WebSocket from 'ws'

const SESSION_ID = process.env.SESSION_ID!
const DESKTOP_WS_URL = 'ws://localhost:17530'

if (!SESSION_ID) {
  process.stderr.write('cc-mcp-bridge: SESSION_ID environment variable required\n')
  process.exit(1)
}

// WebSocket connection to Desktop
let ws: WebSocket | null = null
let connected = false

// MCP Server
const mcp = new Server(
  { name: 'cc-mcp-bridge', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} }
    },
    instructions: [
      'Messages from Mobile arrive via Cloud relay.',
      'Reply with the reply tool to send responses back to Mobile.',
      'Messages appear as <channel source="cc-mcp-bridge" session_id="...">.'
    ].join('\n')
  }
)

// Connect to Desktop WebSocket
function connectWebSocket() {
  ws = new WebSocket(DESKTOP_WS_URL)

  ws.onopen = () => {
    process.stderr.write(`cc-mcp-bridge: WebSocket connected to ${DESKTOP_WS_URL}\n`)
    // Send authentication
    ws!.send(JSON.stringify({
      type: 'auth',
      session_id: SESSION_ID
    }))
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data.toString())

      if (data.type === 'auth_success') {
        connected = true
        process.stderr.write(`cc-mcp-bridge: Authentication successful for session ${SESSION_ID}\n`)
      } else if (data.type === 'auth_failed') {
        process.stderr.write(`cc-mcp-bridge: Authentication failed: ${data.reason}\n`)
        ws!.close()
      } else if (data.type === 'chat_message') {
        // Push message to Claude via channel notification
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: data.text,
            meta: {
              session_id: data.session_id,
              message_id: data.message_id,
              source: 'mobile'
            }
          }
        })
        process.stderr.write(`cc-mcp-bridge: Delivered message to Claude: ${data.text.slice(0, 50)}\n`)
      }
    } catch (err) {
      process.stderr.write(`cc-mcp-bridge: Failed to parse WebSocket message: ${err}\n`)
    }
  }

  ws.onerror = (err) => {
    process.stderr.write(`cc-mcp-bridge: WebSocket error: ${err}\n`)
  }

  ws.onclose = () => {
    connected = false
    process.stderr.write('cc-mcp-bridge: WebSocket disconnected\n')
    // Attempt reconnect after 1 second
    setTimeout(connectWebSocket, 1000)
  }
}

// Reply tool handler
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message back to Mobile. Use this to respond to messages received from Mobile.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The message to send' },
          reply_to: { type: 'string', description: 'Message ID to reply to (optional)' }
        },
        required: ['text']
      }
    }
  ]
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name !== 'reply') {
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true }
  }

  const args = (req.params.arguments ?? {}) as { text?: string; reply_to?: string }

  if (!args.text) {
    return { content: [{ type: 'text', text: 'Missing required argument: text' }], isError: true }
  }

  if (!ws || !connected) {
    return { content: [{ type: 'text', text: 'Not connected to Desktop' }], isError: true }
  }

  // Send reply to Desktop → Cloud → Mobile
  ws.send(JSON.stringify({
    type: 'chat_reply',
    session_id: SESSION_ID,
    text: args.text,
    reply_to: args.reply_to
  }))

  process.stderr.write(`cc-mcp-bridge: Sent reply to Mobile: ${args.text.slice(0, 50)}\n`)
  return { content: [{ type: 'text', text: 'Message sent to Mobile' }] }
})

// Start MCP Server with stdio transport
await mcp.connect(new StdioServerTransport())
process.stderr.write(`cc-mcp-bridge: MCP Server started for session ${SESSION_ID}\n`)

// Connect WebSocket
connectWebSocket()

// Cleanup on stdin EOF (Claude session ended)
process.stdin.on('end', () => {
  process.stderr.write('cc-mcp-bridge: Claude session ended, shutting down\n')
  if (ws) ws.close()
  process.exit(0)
})

process.stdin.on('close', () => {
  if (ws) ws.close()
  process.exit(0)
})

// Handle process signals
process.on('SIGTERM', () => {
  if (ws) ws.close()
  process.exit(0)
})

process.on('SIGINT', () => {
  if (ws) ws.close()
  process.exit(0)
})