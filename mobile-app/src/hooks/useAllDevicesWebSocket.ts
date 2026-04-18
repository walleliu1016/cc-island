// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, useCallback } from 'react'
import { CloudMessage, DeviceInfo, ClaudeSession, HookHint, ChatMessageData, AskQuestion, HookType } from '../types'

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
  const devicesRef = useRef<string[]>(devices)

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

  const connect = useCallback(() => {
    console.log('[WebSocket] connect() called, serverUrl:', serverUrl, 'devices:', devices.length)

    if (!serverUrl) {
      console.log('[WebSocket] No server URL, skipping connection')
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

    // Don't create new connection if already connected or connecting
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Already connected, skipping')
        return
      }
      if (wsRef.current.readyState === WebSocket.CONNECTING) {
        console.log('[WebSocket] Already connecting, skipping')
        return
      }
      // Close old connection that's closing or closed
      console.log('[WebSocket] Closing old connection')
      wsRef.current.close()
    }

    console.log('[WebSocket] Creating new WebSocket to:', serverUrl)
    setState(s => ({ ...s, serverConnecting: true, serverConnected: false, connectionError: null }))

    const ws = new WebSocket(serverUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WebSocket] Connection opened')
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
            // Transparent hook forwarding
            handleHookMessage(msg)
            break
          }

          case 'chat_history': {
            const sessionId = msg.session_id
            const messages = msg.messages
            console.log('[WebSocket] chat_history received:', sessionId, messages?.length, 'messages')
            if (sessionId && messages) {
              setState(s => ({
                ...s,
                chatMessages: {
                  ...s.chatMessages,
                  [sessionId]: messages,
                },
              }))
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
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: '连接失败，请检查服务器地址',
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

    setState(s => {
      const sessions = { ...s.sessions }
      const hookHints = { ...s.hookHints }

      // Get or create device sessions list
      let deviceSessions = sessions[deviceToken] || []

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
          // Update session to working
          const toolName = hookBody.tool_name || '工具'
          console.log('[WebSocket] PreToolUse: session', sessionId, 'tool', toolName, 'current sessions:', deviceSessions.map(s => ({ id: s.sessionId, status: s.status, tool: s.currentTool })))
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'working', currentTool: toolName } : s
          )
          console.log('[WebSocket] After update:', deviceSessions.map(s => ({ id: s.sessionId, status: s.status, tool: s.currentTool })))
          sessions[deviceToken] = deviceSessions
          // Add hook hint
          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: false,
            tool_name: toolName,
            action: hookBody.tool_input?.description as string,
            timestamp: Date.now(),
          }
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId), hint]
          break
        }

        case 'PostToolUse': {
          // Update session to waiting
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'waiting', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'PermissionRequest': {
          // Add urgent hook hint
          const toolName = hookBody.tool_name || hookBody.permission_data?.tool_name || '权限请求'
          const action = hookBody.permission_data?.action || hookBody.tool_input?.description as string
          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: true,
            tool_name: toolName,
            action,
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
          // Update session to idle
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'idle', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'UserPromptSubmit': {
          // Update session to thinking
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
          // Update session to error
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'error', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'PreCompact': {
          // Update session to compacting
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'compacting' } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'PostCompact': {
          // Update session to idle
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'idle' } : s
          )
          sessions[deviceToken] = deviceSessions
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
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send hook response: not connected')
      return
    }

    ws.send(JSON.stringify({
      type: 'hook_response',
      device_token: deviceToken,
      session_id: sessionId,
      decision,
      answers,
    }))

    // Clear hook hint for this session
    setState(s => {
      const hookHints = { ...s.hookHints }
      const deviceHints = hookHints[deviceToken] || []
      hookHints[deviceToken] = deviceHints.filter(h => h.session_id !== sessionId)
      return { ...s, hookHints }
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
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
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