// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, useCallback } from 'react'
import { CloudMessage, DeviceInfo, ClaudeSession, HookHint, ChatMessageData, AskQuestion, HookType } from '../types'
import { getTracer, injectTraceContext, extractTraceContext } from '../tracing'

// Connection timeout in milliseconds
const CONNECTION_TIMEOUT = 10000

// Heartbeat configuration
const PING_INTERVAL = 30000  // Send Ping every 30 seconds
const PONG_TIMEOUT = 60000   // If no Pong for 60 seconds, reconnect

interface UseAllDevicesWebSocketOptions {
  devices: string[]
  serverUrl: string
}

interface WsState {
  serverConnected: boolean
  serverConnecting: boolean
  connectionError: string | null
  onlineDevices: DeviceInfo[]
  sessions: Record<string, ClaudeSession[]>  // keyed by device_token
  hookHints: Record<string, HookHint[]>      // keyed by device_token
  chatMessages: Record<string, ChatMessageData[]>  // keyed by session_id
}

export function useAllDevicesWebSocket({ devices, serverUrl }: UseAllDevicesWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const devicesRef = useRef<string[]>(devices)

  // Heartbeat refs
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPongTimeRef = useRef<number>(0)
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep devicesRef updated
  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  const [state, setState] = useState<WsState>({
    serverConnected: false,
    serverConnecting: false,
    connectionError: null,
    onlineDevices: [],
    sessions: {},
    hookHints: {},
    chatMessages: {},
  })

  // Start heartbeat mechanism (called after auth_success)
  const startHeartbeat = useCallback(() => {
    const tracer = getTracer()
    console.log('[WebSocket] Starting heartbeat mechanism')

    // Clear existing timers
    stopHeartbeat()

    // Initialize last pong time
    lastPongTimeRef.current = Date.now()

    // Send Ping every PING_INTERVAL
    pingIntervalRef.current = setInterval(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        const pingSpan = tracer?.startSpan('heartbeat.ping')
        console.log('[WebSocket] Sending Ping')
        ws.send(JSON.stringify({ type: 'ping' }))
        pingSpan?.end()

        // Set timeout to detect missing Pong
        if (!pongTimeoutRef.current) {
          pongTimeoutRef.current = setTimeout(() => {
            const elapsed = Date.now() - lastPongTimeRef.current
            if (elapsed > PONG_TIMEOUT) {
              console.log('[WebSocket] Pong timeout! No response for', elapsed, 'ms, reconnecting')
              // Force reconnect - close ws and let onclose handler trigger reconnect
              stopHeartbeat()
              if (wsRef.current) {
                wsRef.current.close()
              }
            }
          }, PONG_TIMEOUT)
        }
      }
    }, PING_INTERVAL)
  }, [])

  // Stop heartbeat mechanism
  const stopHeartbeat = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current)
      pongTimeoutRef.current = null
    }
    lastPongTimeRef.current = 0
  }, [])

  const connect = useCallback(() => {
    const tracer = getTracer()
    const connectSpan = tracer?.startSpan('ws.connect', {
      attributes: { server_url: serverUrl }
    })

    console.log('[WebSocket] connect() called, serverUrl:', serverUrl, 'devices:', devices.length)

    if (!serverUrl) {
      console.log('[WebSocket] No server URL, skipping connection')
      connectSpan?.end()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setState({
        serverConnected: false,
        serverConnecting: false,
        connectionError: '请输入服务器地址',
        onlineDevices: [],
        sessions: {},
        hookHints: {},
        chatMessages: {},
      })
      return
    }

    // Validate URL format before creating WebSocket
    const trimmedUrl = serverUrl.trim()
    if (!trimmedUrl.startsWith('ws://') && !trimmedUrl.startsWith('wss://')) {
      console.log('[WebSocket] Invalid URL format:', trimmedUrl)
      connectSpan?.end()
      setState({
        serverConnected: false,
        serverConnecting: false,
        connectionError: '地址必须以 ws:// 或 wss:// 开头',
        onlineDevices: [],
        sessions: {},
        hookHints: {},
        chatMessages: {},
      })
      return
    }

    // Try to parse URL to validate host and port
    try {
      const urlParts = trimmedUrl.replace('ws://', 'http://').replace('wss://', 'https://')
      new URL(urlParts)  // This will throw if URL is invalid
    } catch (e) {
      console.log('[WebSocket] URL parse error:', e)
      connectSpan?.end()
      setState({
        serverConnected: false,
        serverConnecting: false,
        connectionError: '服务器地址格式无效',
        onlineDevices: [],
        sessions: {},
        hookHints: {},
        chatMessages: {},
      })
      return
    }

    // Don't create new connection if already connected or connecting
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Already connected, skipping')
        connectSpan?.end()
        return
      }
      if (wsRef.current.readyState === WebSocket.CONNECTING) {
        console.log('[WebSocket] Already connecting, skipping')
        connectSpan?.end()
        return
      }
      // Close old connection that's closing or closed
      console.log('[WebSocket] Closing old connection')
      wsRef.current.close()
    }

    console.log('[WebSocket] Creating new WebSocket to:', trimmedUrl)
    setState(s => ({ ...s, serverConnecting: true, serverConnected: false, connectionError: null }))

    // Set connection timeout
    connectionTimeoutRef.current = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
        console.log('[WebSocket] Connection timeout, closing')
        try {
          wsRef.current.close()
        } catch (e) {
          console.warn('[WebSocket] Error closing on timeout:', e)
        }
        setState(s => ({
          ...s,
          serverConnected: false,
          serverConnecting: false,
          connectionError: '连接超时，请检查服务器地址是否正确',
        }))
      }
    }, CONNECTION_TIMEOUT)

    try {
      const ws = new WebSocket(trimmedUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[WebSocket] Connection opened')
        connectSpan?.end()
        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current)
          connectionTimeoutRef.current = null
        }
        const currentDevices = devicesRef.current
        console.log('[WebSocket] Current devices from ref:', currentDevices)

        const authMsg = {
          type: 'mobile_auth',
          device_tokens: currentDevices,
        }
        console.log('[WebSocket] Sending mobile_auth message:', JSON.stringify(authMsg))
        ws.send(JSON.stringify(authMsg))
      }

    ws.onmessage = (e) => {
      const tracer = getTracer()
      console.log('[WebSocket] Message received:', e.data)
      try {
        const msg = JSON.parse(e.data) as CloudMessage
        console.log('[WebSocket] Parsed message type:', msg.type)

        switch (msg.type) {
          case 'auth_success':
            console.log('[WebSocket] Auth success!')
            setState(s => ({
              ...s,
              serverConnected: true,
              serverConnecting: false,
            }))
            // Start heartbeat after auth success
            startHeartbeat()
            break

          case 'auth_failed':
            console.log('[WebSocket] Auth failed:', msg)
            setState(s => ({
              ...s,
              serverConnected: false,
              serverConnecting: false,
              connectionError: '认证失败，请检查设备 Token',
            }))
            ws.close()
            break

          case 'pong':
            // Received Pong response, update last pong time
            console.log('[WebSocket] Pong received')
            lastPongTimeRef.current = Date.now()
            // Clear pong timeout (if waiting)
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current)
              pongTimeoutRef.current = null
            }
            break

          case 'device_list': {
            // Server sends list of online devices
            const onlineDevices = msg.devices || []
            setState(s => ({
              ...s,
              onlineDevices,
            }))
            break
          }

          case 'session_list': {
            // Server sends active sessions for a device
            // MERGE with existing sessions to preserve real-time state from hook_message
            const deviceToken = msg.device_token
            const serverSessions = msg.sessions || []
            if (!deviceToken) break
            console.log('[WebSocket] session_list received:', deviceToken, 'sessions:', serverSessions.map(s => ({ id: s.sessionId, name: s.projectName, status: s.status, tool: s.currentTool })))

            setState(s => {
              const existingSessions = s.sessions[deviceToken] || []

              // Merge: use existing session's real-time state if available, otherwise use server data
              const mergedSessions = serverSessions.map(serverSession => {
                const existing = existingSessions.find(e => e.sessionId === serverSession.sessionId)
                // Prefer existing real-time state (from hook_message) over server state (from DB)
                // Only use server data for new sessions or if existing has no status
                if (existing && existing.status !== 'idle') {
                  return existing
                }
                return serverSession
              })

              return {
                ...s,
                sessions: {
                  ...s.sessions,
                  [deviceToken]: mergedSessions,
                },
              }
            })
            break
          }

          case 'device_online': {
            // A device came online
            const device = msg.device
            if (device) {
              setState(s => ({
                ...s,
                onlineDevices: [...s.onlineDevices.filter(d => d.token !== device.token), device],
              }))
            }
            break
          }

          case 'device_offline': {
            // A device went offline
            const offlineToken = msg.device_token
            if (!offlineToken) break
            setState(s => {
              // Remove device from online list
              const onlineDevices = s.onlineDevices.filter(d => d.token !== offlineToken)
              // Remove sessions/hookHints for this device
              const sessions = { ...s.sessions }
              delete sessions[offlineToken]
              const hookHints = { ...s.hookHints }
              delete hookHints[offlineToken]
              return { ...s, onlineDevices, sessions, hookHints }
            })
            break
          }

          case 'hook_message': {
            const msgSpan = tracer?.startSpan('ws.message.receive', {
              attributes: {
                msg_type: 'hook_message',
                session_id: msg.session_id,
              }
            })

            // Extract trace context if present
            const extractedCtx = extractTraceContext(msg)
            if (extractedCtx && tracer) {
              msgSpan?.setAttribute('parent_trace_id', extractedCtx.traceId)
              msgSpan?.setAttribute('parent_span_id', extractedCtx.spanId)
            }

            // Transparent hook forwarding
            handleHookMessage(msg)
            msgSpan?.end()
            break
          }

          case 'chat_history': {
            const sessionId = msg.session_id
            const newMessages = msg.messages
            console.log('[WebSocket] chat_history received:', sessionId, newMessages?.length, 'messages')
            if (sessionId && newMessages && newMessages.length > 0) {
              setState(s => {
                // Simply append new messages (no dedupe, no sort)
                const existing = s.chatMessages[sessionId] || []
                return {
                  ...s,
                  chatMessages: {
                    ...s.chatMessages,
                    [sessionId]: [...existing, ...newMessages],
                  },
                }
              })
            }
            break
          }
        }
      } catch (err) {
        console.warn('Failed to parse cloud message:', err)
      }
    }

    ws.onclose = (event) => {
      console.log('[WebSocket] Connection closed, code:', event.code, 'reason:', event.reason)
      // Clear connection timeout
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current)
        connectionTimeoutRef.current = null
      }
      // Stop heartbeat on disconnect
      stopHeartbeat()
      const errorMessage = event.code === 1006 ? '连接被拒绝或服务器不可达' :
                           event.code === 1000 ? '连接已关闭' : `连接断开 (${event.code})`
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: s.serverConnecting ? errorMessage : null,
      }))

      if (serverUrl) {
        console.log('[WebSocket] Will reconnect in 5 seconds...')
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, 5000)
      }
    }

    ws.onerror = () => {
      console.log('[WebSocket] Error')
      connectSpan?.end()
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: '连接失败，请检查服务器地址',
      }))
    }

    } catch (e) {
      console.error('[WebSocket] Failed to create WebSocket:', e)
      connectSpan?.end()
      // Clear connection timeout
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current)
        connectionTimeoutRef.current = null
      }
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: '无法连接，请检查服务器地址格式',
      }))
    }

  }, [serverUrl])

  // Handle hook_message
  const handleHookMessage = useCallback((msg: CloudMessage) => {
    const deviceToken = msg.device_token
    const sessionId = msg.session_id
    const hookType = msg.hook_type
    const hookBody = msg.hook_body

    if (!deviceToken || !sessionId || !hookType || !hookBody) return

    console.log('[WebSocket] HookMessage:', hookType, 'for device:', deviceToken, 'session:', sessionId)
    console.log('[WebSocket] HookMessage body:', JSON.stringify(hookBody).slice(0, 200))

    setState(s => {
      const sessions = { ...s.sessions }
      const hookHints = { ...s.hookHints }

      // Get or create device sessions list
      let deviceSessions = sessions[deviceToken] || []

      // Log current state before update
      const currentSession = deviceSessions.find(s => s.sessionId === sessionId)
      console.log('[WebSocket] HookMessage current session status:', currentSession?.status, 'current urgent hints:', hookHints[deviceToken]?.filter(h => h.urgent))

      switch (hookType) {
        case 'SessionStart': {
          // Create new session
          const projectName = hookBody.project_name || extractProjectName(hookBody.cwd) || '未知项目'
          const newSession: ClaudeSession = {
            sessionId: sessionId,
            projectName: projectName,
            status: 'idle',
            createdAt: Date.now(),
          }
          // Remove any existing session with same ID
          deviceSessions = deviceSessions.filter(s => s.sessionId !== sessionId)
          deviceSessions.push(newSession)
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'SessionEnd': {
          // Mark session as ended
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'ended' } : s
          )
          sessions[deviceToken] = deviceSessions
          // Clear hook hints for this session
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = deviceHints.filter(h => h.session_id !== sessionId)
          break
        }

        case 'PreToolUse': {
          // Update session to working (matching desktop: unconditional)
          const toolName = hookBody.tool_name || '工具'
          const toolInput = hookBody.tool_input ? {
            command: hookBody.tool_input.command as string,
            file_path: hookBody.tool_input.file_path as string,
            action: (hookBody.tool_input.description || hookBody.tool_input.action) as string,
            details: hookBody.tool_input.details as string,
          } : undefined
          console.log('[WebSocket] PreToolUse: session', sessionId, 'tool', toolName, 'toolInput:', toolInput)

          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'working', currentTool: toolName, toolInput, workingTimestamp: Date.now() } : s
          )
          sessions[deviceToken] = deviceSessions

          // Add hook hint (but don't clear urgent hints - they should stay until resolved)
          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: false,
            tool_name: toolName,
            action: toolInput?.action || toolInput?.command || toolInput?.file_path,
            timestamp: Date.now(),
          }
          const deviceHints = hookHints[deviceToken] || []
          // Only clear non-urgent hints for this session, keep urgent hints intact
          hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || h.urgent), hint]
          break
        }

        case 'PostToolUse': {
          // Update session to waiting (matching desktop: unconditional)
          // Respect minimum display time for working state (2s like desktop)
          deviceSessions = deviceSessions.map(s => {
            if (s.sessionId === sessionId) {
              const workingDuration = s.workingTimestamp ? Date.now() - s.workingTimestamp : 0
              if (workingDuration < 2000 && s.status === 'working') {
                // Schedule update to 'waiting' after remaining time
                const remainingTime = 2000 - workingDuration
                setTimeout(() => {
                  setState(prevState => {
                    const prevSessions = prevState.sessions[deviceToken] || []
                    const updatedSessions = prevSessions.map(ps =>
                      ps.sessionId === sessionId && ps.status === 'working'
                        ? { ...ps, status: 'waiting', currentTool: undefined, workingTimestamp: undefined }
                        : ps
                    )
                    return {
                      ...prevState,
                      sessions: {
                        ...prevState.sessions,
                        [deviceToken]: updatedSessions,
                      },
                    }
                  })
                }, remainingTime)
                return s
              }
              return { ...s, status: 'waiting', currentTool: undefined, workingTimestamp: undefined }
            }
            return s
          })
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'PermissionRequest': {
          // Check if it's AskUserQuestion
          const toolName = hookBody.tool_name || hookBody.permission_data?.tool_name || '权限请求'
          const isAskUserQuestion = toolName === 'AskUserQuestion'

          // Add urgent hook hint
          const action = hookBody.permission_data?.action || hookBody.tool_input?.description as string
          const questions = isAskUserQuestion
            ? (hookBody.tool_input?.questions || hookBody.questions || []) as AskQuestion[]
            : undefined

          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: true,
            tool_name: toolName,
            action,
            questions,
            timestamp: Date.now(),
          }
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || !h.urgent), hint]
          // Update session status
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'waitingForApproval', currentTool: toolName } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'Notification': {
          // Check if it's an ask (blocking)
          const notificationData = hookBody.notification_data
          if (notificationData?.type === 'ask' || hookBody.questions) {
            // Add urgent hook hint for ask
            const questions = notificationData?.questions || hookBody.questions || []
            const hint: HookHint = {
              session_id: sessionId,
              hook_type: hookType as HookType,
              urgent: true,
              questions: questions as AskQuestion[],
              timestamp: Date.now(),
            }
            const deviceHints = hookHints[deviceToken] || []
            hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || !h.urgent), hint]
            // Update session status
            deviceSessions = deviceSessions.map(s =>
              s.sessionId === sessionId ? { ...s, status: 'waitingForApproval' } : s
            )
            sessions[deviceToken] = deviceSessions
          }
          break
        }

        case 'Stop': {
          // Update session to idle (matching desktop: unconditional)
          console.log('[WebSocket] Stop hook: setting session', sessionId, 'to idle')
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'idle', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          console.log('[WebSocket] Stop hook: session status after update:', deviceSessions.find(s => s.sessionId === sessionId)?.status)
          break
        }

        case 'UserPromptSubmit': {
          // Update session to thinking (matching desktop: unconditional)
          console.log('[WebSocket] UserPromptSubmit hook: setting session', sessionId, 'to thinking')
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'thinking', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'Elicitation': {
          // Add urgent hook hint for AskUserQuestion
          const questions = hookBody.questions || []
          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: true,
            questions: questions as AskQuestion[],
            timestamp: Date.now(),
          }
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || !h.urgent), hint]
          // Update session status
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'waitingForApproval' } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'PostToolUseFailure': {
          // Update session to error, but don't override waitingForApproval
          const currentSession = deviceSessions.find(s => s.sessionId === sessionId)
          if (currentSession?.status !== 'waitingForApproval') {
            deviceSessions = deviceSessions.map(s =>
              s.sessionId === sessionId ? { ...s, status: 'error', currentTool: undefined } : s
            )
            sessions[deviceToken] = deviceSessions
          }
          break
        }

        case 'PreCompact': {
          // Update session to compacting, but don't override waitingForApproval
          const currentSession = deviceSessions.find(s => s.sessionId === sessionId)
          if (currentSession?.status !== 'waitingForApproval') {
            deviceSessions = deviceSessions.map(s =>
              s.sessionId === sessionId ? { ...s, status: 'compacting' } : s
            )
            sessions[deviceToken] = deviceSessions
          }
          break
        }

        case 'PostCompact': {
          // Update session to idle, but don't override waitingForApproval
          const currentSession = deviceSessions.find(s => s.sessionId === sessionId)
          if (currentSession?.status !== 'waitingForApproval') {
            deviceSessions = deviceSessions.map(s =>
              s.sessionId === sessionId ? { ...s, status: 'idle' } : s
            )
            sessions[deviceToken] = deviceSessions
          }
          break
        }

        case 'SubagentStart': {
          // Just update activity (no status change)
          break
        }

        case 'SubagentStop': {
          // Just update activity (no status change)
          break
        }
      }

      return { ...s, sessions, hookHints }
    })
  }, [])

  // Send hook response (for blocking hooks)
  const sendHookResponse = useCallback((deviceToken: string, sessionId: string, decision: string | null, answers?: string[][]) => {
    const tracer = getTracer()
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send hook response: not connected')
      return
    }

    console.log('[WebSocket] sendHookResponse: session', sessionId, 'decision', decision)

    const responseSpan = tracer?.startSpan('hook.response', {
      attributes: {
        session_id: sessionId,
        decision: decision || 'none',
      }
    })

    const response: {
      type: string
      device_token: string
      session_id: string
      decision: string | null
      answers?: string[][]
      trace_context?: { traceparent: string }
    } = {
      type: 'hook_response',
      device_token: deviceToken,
      session_id: sessionId,
      decision,
      answers,
    }

    const traceCtx = injectTraceContext(responseSpan)
    if (traceCtx) {
      response.trace_context = traceCtx
    }

    ws.send(JSON.stringify(response))
    responseSpan?.end()

    // Clear hook hint and set session to idle (ready for next hook like Stop/PostToolUse/UserPromptSubmit)
    setState(s => {
      const hookHints = { ...s.hookHints }
      const deviceHints = hookHints[deviceToken] || []
      hookHints[deviceToken] = deviceHints.filter(h => h.session_id !== sessionId)

      // Change status to idle - subsequent hooks will update naturally
      const sessions = { ...s.sessions }
      const deviceSessions = sessions[deviceToken] || []
      const prevStatus = deviceSessions.find(sess => sess.sessionId === sessionId)?.status
      sessions[deviceToken] = deviceSessions.map(sess =>
        sess.sessionId === sessionId
          ? { ...sess, status: 'idle', currentTool: undefined, workingTimestamp: undefined }
          : sess
      )

      console.log('[WebSocket] sendHookResponse: prevStatus', prevStatus, '-> idle')

      return { ...s, hookHints, sessions }
    })
  }, [])

  // Request chat history
  const requestChatHistory = useCallback((deviceToken: string, sessionId: string, limit?: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot request chat history: not connected')
      return
    }

    const msg: { type: string; device_token: string; session_id: string; limit?: number } = {
      type: 'request_chat_history',
      device_token: deviceToken,
      session_id: sessionId,
    }
    if (limit !== undefined) {
      msg.limit = limit
    }
    ws.send(JSON.stringify(msg))
  }, [])

  // Send mobile_auth when devices change (if connected)
  useEffect(() => {
    const ws = wsRef.current
    console.log('[WebSocket] Devices changed effect triggered, devices:', devices)
    if (ws && ws.readyState === WebSocket.OPEN) {
      const authMsg = {
        type: 'mobile_auth',
        device_tokens: devices,
      }
      console.log('[WebSocket] Sending mobile_auth update:', JSON.stringify(authMsg))
      ws.send(JSON.stringify(authMsg))
    }
  }, [devices])

  // Force send subscription (for when devices array hasn't changed)
  const forceSubscribe = useCallback(() => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      const authMsg = {
        type: 'mobile_auth',
        device_tokens: devicesRef.current,
      }
      console.log('[WebSocket] Force sending mobile_auth:', JSON.stringify(authMsg))
      ws.send(JSON.stringify(authMsg))
    }
  }, [])

  // Handle page visibility change (Android WebView zombie connection fix)
  // When phone screen goes black, WebSocket may not fire onclose event,
  // but server-side connection may timeout and clear subscribers.
  // On page wake, we need to force reconnect to restore message receiving.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WebSocket] Page became visible, forcing reconnect')
        // Always close and reconnect on page wake
        // This is more reliable than checking readyState (zombie connection may show OPEN)
        if (wsRef.current) {
          console.log('[WebSocket] Closing existing WebSocket (readyState:', wsRef.current.readyState, ')')
          wsRef.current.close()
          wsRef.current = null
        }
        // Trigger new connection
        connect()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [connect])

  // Connect/disconnect based on server URL
  useEffect(() => {
    // Only connect if there's a server URL
    if (!serverUrl) {
      setState({
        serverConnected: false,
        serverConnecting: false,
        connectionError: '请输入服务器地址',
        onlineDevices: [],
        sessions: {},
        hookHints: {},
        chatMessages: {},
      })
      return
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Don't reconnect if already connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected, skipping connect()')
      return
    }

    console.log('[WebSocket] Initial connect for server:', serverUrl)
    connect()

    return () => {
      console.log('[WebSocket] Cleanup: closing connection')
      stopHeartbeat()
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [serverUrl])  // Only depend on serverUrl, not connect

  return { state, sendHookResponse, requestChatHistory, forceSubscribe }
}

// Helper: extract project name from cwd
function extractProjectName(cwd?: string): string | undefined {
  if (!cwd) return undefined
  const parts = cwd.split('/')
  return parts[parts.length - 1] || undefined
}