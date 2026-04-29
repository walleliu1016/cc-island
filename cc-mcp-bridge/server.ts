#!/usr/bin/env node
/**
 * CC-MCP-Bridge - Claude Channel MCP Server
 *
 * Bridges Mobile messages to Claude Code via Desktop WebSocket.
 * Improved scheme: User actively binds session via set_session tool.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import WebSocket from 'ws'
import { randomUUID } from 'crypto'

const DESKTOP_WS_URL = 'ws://localhost:17530/ws'

// Unique bridge ID (generated on startup)
const BRIDGE_ID = randomUUID()

// WebSocket connection to Desktop
let ws: WebSocket | null = null
let connected = false

// Session ID (user-bound via set_session tool)
let boundSessionId: string | null = null

// MCP Server
const mcp = new Server(
  { name: 'cc-mcp-bridge', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} }
    },
    instructions: [
      'CC-MCP-Bridge is ready.',
      'IMPORTANT: First call the set_session tool to bind your current session.',
      'After binding, messages from Mobile will arrive via channel notifications.',
      'Use the reply tool to send responses back to Mobile.',
    ].join('\n')
  }
)

// Connect to Desktop WebSocket
function connectWebSocket() {
  ws = new WebSocket(DESKTOP_WS_URL)

  ws.onopen = () => {
    process.stderr.write(`cc-mcp-bridge: WebSocket connected to ${DESKTOP_WS_URL}\n`)
    process.stderr.write(`cc-mcp-bridge: Bridge ID: ${BRIDGE_ID}\n`)
    process.stderr.write(`cc-mcp-bridge: Waiting for set_session call...\n`)
    // Send bridge registration (no session_id yet)
    ws!.send(JSON.stringify({
      type: 'bridge_register',
      bridge_id: BRIDGE_ID
    }))
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data.toString())

      if (data.type === 'bridge_registered') {
        connected = true
        process.stderr.write(`cc-mcp-bridge: Registered with Desktop (bridge_id: ${BRIDGE_ID})\n`)

        // Notify Claude to call set_session
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `[CC-MCP-Bridge] Ready! Bridge ID: ${BRIDGE_ID}\nPlease call set_session tool with your session_id to enable Mobile messaging.`,
            meta: { source: 'system', bridge_id: BRIDGE_ID }
          }
        })
      } else if (data.type === 'session_bound') {
        boundSessionId = data.session_id
        process.stderr.write(`cc-mcp-bridge: Session bound: ${boundSessionId}\n`)
        mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `[CC-MCP-Bridge] Session bound successfully: ${boundSessionId}\nNow you can receive messages from Mobile and reply.`,
            meta: { source: 'system', session_id: boundSessionId }
          }
        })
      } else if (data.type === 'chat_message') {
        // Only process if session is bound and matches
        if (!boundSessionId) {
          process.stderr.write(`cc-mcp-bridge: Received message but session not bound yet\n`)
          return
        }

        if (data.session_id === boundSessionId) {
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
        } else {
          process.stderr.write(`cc-mcp-bridge: Ignored message for different session ${data.session_id} (bound to ${boundSessionId})\n`)
        }
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
    boundSessionId = null
    process.stderr.write('cc-mcp-bridge: WebSocket disconnected\n')
    setTimeout(connectWebSocket, 1000)
  }
}

// Tool handlers
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'set_session',
      description: 'Bind MCP Bridge to a Claude session. Call this first to enable Mobile messaging.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Your current Claude session ID (shown in Claude Code CLI)'
          }
        },
        required: ['session_id']
      }
    },
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
  const toolName = req.params.name

  if (toolName === 'set_session') {
    const args = (req.params.arguments ?? {}) as { session_id?: string }

    if (!args.session_id) {
      return { content: [{ type: 'text', text: 'Missing required argument: session_id' }], isError: true }
    }

    if (!ws || !connected) {
      return { content: [{ type: 'text', text: 'Not connected to Desktop' }], isError: true }
    }

    // Send session binding to Desktop
    ws.send(JSON.stringify({
      type: 'bind_session',
      bridge_id: BRIDGE_ID,
      session_id: args.session_id
    }))

    process.stderr.write(`cc-mcp-bridge: Requesting session binding: ${args.session_id}\n`)
    return { content: [{ type: 'text', text: `Session binding requested: ${args.session_id}. Check channel notification for confirmation.` }] }
  }

  if (toolName === 'reply') {
    const args = (req.params.arguments ?? {}) as { text?: string; reply_to?: string }

    if (!args.text) {
      return { content: [{ type: 'text', text: 'Missing required argument: text' }], isError: true }
    }

    if (!ws || !connected) {
      return { content: [{ type: 'text', text: 'Not connected to Desktop' }], isError: true }
    }

    if (!boundSessionId) {
      return { content: [{ type: 'text', text: 'Session not bound. Call set_session first.' }], isError: true }
    }

    ws.send(JSON.stringify({
      type: 'chat_reply',
      session_id: boundSessionId,
      text: args.text,
      reply_to: args.reply_to
    }))

    process.stderr.write(`cc-mcp-bridge: Sent reply to Mobile: ${args.text.slice(0, 50)}\n`)
    return { content: [{ type: 'text', text: 'Message sent to Mobile' }] }
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }
})

// Start MCP Server
await mcp.connect(new StdioServerTransport())
process.stderr.write(`cc-mcp-bridge: MCP Server started\n`)

// Connect WebSocket
connectWebSocket()

// Cleanup on stdin EOF
process.stdin.on('end', () => {
  process.stderr.write('cc-mcp-bridge: Claude session ended\n')
  if (ws) ws.close()
  process.exit(0)
})

process.stdin.on('close', () => {
  if (ws) ws.close()
  process.exit(0)
})

process.on('SIGTERM', () => { if (ws) ws.close(); process.exit(0) })
process.on('SIGINT', () => { if (ws) ws.close(); process.exit(0) })