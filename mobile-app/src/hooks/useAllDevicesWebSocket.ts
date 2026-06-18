// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { DeviceInfo, ClaudeSession, HookHint, ChatMessageData, AskQuestion, HookType } from '../types'

interface UseAllDevicesWebSocketOptions {
  devices: string[]
  serverUrl: string
}

interface WsState {
  serverConnected: boolean
  serverConnecting: boolean
  connectionError: string | null
  onlineDevices: DeviceInfo[]
  sessions: Record<string, ClaudeSession[]>
  hookHints: Record<string, HookHint[]>
  chatMessages: Record<string, ChatMessageData[]>
}

export function useAllDevicesWebSocket({ devices, serverUrl }: UseAllDevicesWebSocketOptions) {
  const mainSocketRef = useRef<Socket | null>(null)
  const hooksSocketRef = useRef<Socket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const devicesRef = useRef<string[]>(devices)

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

  const disconnectAll = useCallback(() => {
    if (mainSocketRef.current) {
      mainSocketRef.current.disconnect()
      mainSocketRef.current = null
    }
    if (hooksSocketRef.current) {
      hooksSocketRef.current.disconnect()
      hooksSocketRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    console.log('[SocketIO] connect() called, serverUrl:', serverUrl, 'devices:', devices.length)

    if (!serverUrl) {
      console.log('[SocketIO] No server URL, skipping')
      disconnectAll()
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: '请输入服务器地址',
        onlineDevices: [],
        sessions: {},
        hookHints: {},
        chatMessages: {},
      }))
      return
    }

    // Don't reconnect if already connected
    if (mainSocketRef.current?.connected) {
      console.log('[SocketIO] Already connected, skipping')
      return
    }

    disconnectAll()

    const trimmedUrl = serverUrl.trim()
    console.log('[SocketIO] Creating Socket.IO connection to:', trimmedUrl)
    setState(s => ({ ...s, serverConnecting: true, serverConnected: false, connectionError: null }))

    try {
      const currentDevices = devicesRef.current

      // Connect to default namespace with auth
      const mainSocket = io(trimmedUrl, {
        auth: {
          device_tokens: currentDevices,
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        timeout: 10000,
      })

      mainSocketRef.current = mainSocket

      mainSocket.on('connect', () => {
        console.log('[SocketIO] Connected, sid:', mainSocket.id)
      })

      mainSocket.on('auth_success', (data: { device_id: string; subscriptions?: string[] }) => {
        console.log('[SocketIO] Auth success:', data)
        setState(s => ({
          ...s,
          serverConnected: true,
          serverConnecting: false,
        }))
      })

      mainSocket.on('list', (data: { devices: DeviceInfo[] }) => {
        console.log('[SocketIO] Device list received:', data.devices?.length)
        if (data.devices) {
          setState(s => ({ ...s, onlineDevices: data.devices }))
        }
      })

      mainSocket.on('auth_error', (data: { reason: string }) => {
        console.error('[SocketIO] Auth failed:', data.reason)
        setState(s => ({
          ...s,
          serverConnected: false,
          serverConnecting: false,
          connectionError: '认证失败，请检查设备 Token',
        }))
        mainSocket.disconnect()
      })

      mainSocket.on('connect_error', (err: Error) => {
        console.error('[SocketIO] Connect error:', err.message)
        setState(s => ({
          ...s,
          serverConnected: false,
          serverConnecting: false,
          connectionError: `连接失败: ${err.message}`,
        }))
      })

      mainSocket.on('disconnect', (reason: string) => {
        console.log('[SocketIO] Disconnected:', reason)
        setState(s => ({
          ...s,
          serverConnected: false,
          serverConnecting: false,
        }))
      })

      // Connect to /hooks namespace for hook events
      const hooksSocket = io(`${trimmedUrl}/hooks`, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      })

      hooksSocketRef.current = hooksSocket

      hooksSocket.on('connect', () => {
        console.log('[SocketIO] /hooks connected')
      })

      hooksSocket.on('hook', (msg: {
        deviceToken: string
        sessionId: string
        hookType: string
        hookBody: Record<string, unknown>
      }) => {
        handleHookMessage(msg)
      })

      hooksSocket.on('hook:response', (msg: {
        deviceToken: string
        sessionId: string
        decision?: string
        answers?: string[][]
      }) => {
        console.log('[SocketIO] hook:response received:', msg)
        // Hook responses are handled by desktop, mobile receives them as popup_resolved
      })

      hooksSocket.on('popup:resolved', (msg: {
        deviceToken: string
        popupId: string
        sessionId: string
        source: string
        decision?: string
        answers?: string[][]
      }) => {
        handlePopupResolved(msg)
      })

      hooksSocket.on('history', (msg: {
        deviceToken: string
        sessionId: string
        messages: ChatMessageData[]
      }) => {
        const sessionId = msg.sessionId
        const newMessages = msg.messages
        console.log('[SocketIO] Chat history received:', sessionId, newMessages?.length, 'messages')
        if (sessionId && newMessages && newMessages.length > 0) {
          setState(s => {
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
      })

      hooksSocket.on('list:request', (msg: {
        deviceToken: string
        mobileConnId: string
      }) => {
        console.log('[SocketIO] list:request received:', msg)
        // Desktop handles this via cloud_client, mobile doesn't respond
      })

      hooksSocket.on('list:response', (msg: {
        deviceToken: string
        sessions: ClaudeSession[]
      }) => {
        console.log('[SocketIO] Session list received:', msg.sessions?.length, 'sessions')
        if (msg.deviceToken && msg.sessions) {
          setState(s => ({
            ...s,
            sessions: {
              ...s.sessions,
              [msg.deviceToken]: msg.sessions,
            },
          }))
        }
      })

    } catch (e) {
      console.error('[SocketIO] Failed to create connection:', e)
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: '无法连接，请检查服务器地址格式',
      }))
    }
  }, [serverUrl, disconnectAll])

  // Hook message handler
  const handleHookMessage = useCallback((msg: {
    deviceToken: string
    sessionId: string
    hookType: string
    hookBody: Record<string, unknown>
  }) => {
    const deviceToken = msg.deviceToken
    const sessionId = msg.sessionId
    const hookType = msg.hookType
    const hookBody = msg.hookBody

    if (!deviceToken || !sessionId || !hookType || !hookBody) return

    console.log('[SocketIO] Hook:', hookType, 'device:', deviceToken, 'session:', sessionId)

    setState(s => {
      const sessions = { ...s.sessions }
      const hookHints = { ...s.hookHints }
      let deviceSessions = sessions[deviceToken] || []

      switch (hookType) {
        case 'SessionStart': {
          const projectName = (hookBody.project_name as string) || extractProjectName(hookBody.cwd as string) || '未知项目'
          const newSession: ClaudeSession = {
            sessionId: sessionId,
            projectName: projectName,
            status: 'idle',
            createdAt: Date.now(),
          }
          deviceSessions = deviceSessions.filter(s => s.sessionId !== sessionId)
          deviceSessions.push(newSession)
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'SessionEnd': {
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'ended' } : s
          )
          sessions[deviceToken] = deviceSessions
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = deviceHints.filter(h => h.session_id !== sessionId)
          break
        }

        case 'PreToolUse': {
          const toolName = (hookBody.tool_name as string) || '工具'
          const toolInput = hookBody.tool_input as Record<string, string> | undefined
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId
              ? { ...s, status: 'working', currentTool: toolName, toolInput, workingTimestamp: Date.now() }
              : s
          )
          sessions[deviceToken] = deviceSessions

          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: false,
            tool_name: toolName,
            action: toolInput?.action || toolInput?.command || toolInput?.file_path,
            timestamp: Date.now(),
          }
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || h.urgent), hint]
          break
        }

        case 'PostToolUse': {
          deviceSessions = deviceSessions.map(s => {
            if (s.sessionId === sessionId) {
              const workingDuration = s.workingTimestamp ? Date.now() - s.workingTimestamp : 0
              if (workingDuration < 2000 && s.status === 'working') {
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
                      sessions: { ...prevState.sessions, [deviceToken]: updatedSessions },
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
          const toolName = (hookBody.tool_name as string) || (hookBody.permission_data as Record<string, string>)?.tool_name || '权限请求'
          const isAskUserQuestion = toolName === 'AskUserQuestion'
          const action = (hookBody.permission_data as Record<string, string>)?.action
          const questions = isAskUserQuestion
            ? ((hookBody.tool_input as Record<string, unknown>)?.questions || hookBody.questions) as AskQuestion[]
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
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'waitingForApproval', currentTool: toolName } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'Notification': {
          const notificationData = hookBody.notification_data as Record<string, unknown> | undefined
          if (notificationData?.type === 'ask' || hookBody.questions) {
            const questions = (notificationData?.questions || hookBody.questions) as AskQuestion[]
            const hint: HookHint = {
              session_id: sessionId,
              hook_type: hookType as HookType,
              urgent: true,
              questions,
              timestamp: Date.now(),
            }
            const deviceHints = hookHints[deviceToken] || []
            hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || !h.urgent), hint]
            deviceSessions = deviceSessions.map(s =>
              s.sessionId === sessionId ? { ...s, status: 'waitingForApproval' } : s
            )
            sessions[deviceToken] = deviceSessions
          }
          break
        }

        case 'Stop': {
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'idle', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'UserPromptSubmit': {
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'thinking', currentTool: undefined } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'Elicitation': {
          const questions = (hookBody.questions || []) as AskQuestion[]
          const hint: HookHint = {
            session_id: sessionId,
            hook_type: hookType as HookType,
            urgent: true,
            questions,
            timestamp: Date.now(),
          }
          const deviceHints = hookHints[deviceToken] || []
          hookHints[deviceToken] = [...deviceHints.filter(h => h.session_id !== sessionId || !h.urgent), hint]
          deviceSessions = deviceSessions.map(s =>
            s.sessionId === sessionId ? { ...s, status: 'waitingForApproval' } : s
          )
          sessions[deviceToken] = deviceSessions
          break
        }

        case 'PostToolUseFailure': {
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
          const currentSession = deviceSessions.find(s => s.sessionId === sessionId)
          if (currentSession?.status !== 'waitingForApproval') {
            deviceSessions = deviceSessions.map(s =>
              s.sessionId === sessionId ? { ...s, status: 'idle' } : s
            )
            sessions[deviceToken] = deviceSessions
          }
          break
        }

        case 'SubagentStart':
        case 'SubagentStop':
        case 'StatusUpdate':
          break
      }

      return { ...s, sessions, hookHints }
    })
  }, [])

  // Popup resolved handler
  const handlePopupResolved = useCallback((msg: {
    deviceToken: string
    popupId: string
    sessionId: string
    source: string
    decision?: string
    answers?: string[][]
  }) => {
    const deviceToken = msg.deviceToken
    const sessionId = msg.sessionId
    const source = msg.source
    const decision = msg.decision
    const answers = msg.answers

    console.log('[SocketIO] popup_resolved:', sessionId, 'by', source)

    if (!deviceToken || !sessionId) return

    setState(s => {
      const hookHints = { ...s.hookHints }
      const deviceHints = hookHints[deviceToken] || []
      hookHints[deviceToken] = deviceHints.filter(h => h.session_id !== sessionId || !h.urgent)

      const sessions = { ...s.sessions }
      const deviceSessions = sessions[deviceToken] || []
      sessions[deviceToken] = deviceSessions.map(sess =>
        sess.sessionId === sessionId
          ? { ...sess, status: 'idle', currentTool: undefined, workingTimestamp: undefined }
          : sess
      )

      const toastMessage = buildPopupResolvedToast(source, decision, answers)
      console.log('[SocketIO] Toast:', toastMessage)

      return { ...s, hookHints, sessions }
    })
  }, [])

  // Send hook response
  const sendHookResponse = useCallback((deviceToken: string, sessionId: string, decision: string | null, answers?: string[][]) => {
    const socket = hooksSocketRef.current
    if (!socket?.connected) {
      console.warn('[SocketIO] Cannot send hook response: not connected')
      return
    }

    console.log('[SocketIO] Sending hook:response:', sessionId, decision)

    socket.emit('hook:response', {
      deviceToken,
      sessionId,
      decision,
      answers,
    })

    setState(s => {
      const hookHints = { ...s.hookHints }
      const deviceHints = hookHints[deviceToken] || []
      hookHints[deviceToken] = deviceHints.filter(h => h.session_id !== sessionId)

      const sessions = { ...s.sessions }
      const deviceSessions = sessions[deviceToken] || []
      sessions[deviceToken] = deviceSessions.map(sess =>
        sess.sessionId === sessionId
          ? { ...sess, status: 'idle', currentTool: undefined, workingTimestamp: undefined }
          : sess
      )

      return { ...s, hookHints, sessions }
    })
  }, [])

  // Request chat history
  const requestChatHistory = useCallback((deviceToken: string, sessionId: string, limit?: number) => {
    const socket = hooksSocketRef.current
    if (!socket?.connected) {
      console.warn('[SocketIO] Cannot request chat history: not connected')
      return
    }

    socket.emit('history:request', {
      deviceToken,
      sessionId,
      limit,
    })
  }, [])

  // Force re-subscribe
  const forceSubscribe = useCallback(() => {
    const socket = hooksSocketRef.current
    if (socket?.connected) {
      console.log('[SocketIO] Force re-subscribing')
      socket.emit('list:request', {
        deviceToken: devicesRef.current[0] || '',
        mobileConnId: socket.id || '',
      })
    }
  }, [])

  // Page visibility handling (Android WebView zombie connection fix)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SocketIO] Page visible, reconnecting')
        disconnectAll()
        connect()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [connect, disconnectAll])

  // Connect/disconnect based on serverUrl
  useEffect(() => {
    if (!serverUrl) {
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
        connectionError: '请输入服务器地址',
        onlineDevices: [],
        sessions: {},
        hookHints: {},
        chatMessages: {},
      }))
      return
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (mainSocketRef.current?.connected) {
      return
    }

    console.log('[SocketIO] Initial connect to:', serverUrl)
    connect()

    return () => {
      console.log('[SocketIO] Cleanup')
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      disconnectAll()
    }
  }, [serverUrl])

  return { state, sendHookResponse, requestChatHistory, forceSubscribe }
}

function extractProjectName(cwd?: string): string | undefined {
  if (!cwd) return undefined
  const parts = cwd.split('/')
  return parts[parts.length - 1] || undefined
}

function buildPopupResolvedToast(source: string, decision?: string, answers?: string[][]): string {
  const sourceLabel = source === 'desktop' ? 'Desktop' : '手机端'
  if (answers && answers.length > 0) {
    const answerStr = answers.map(a => a.join('; ')).join('; ')
    return `已由 ${sourceLabel} 处理（${answerStr}）`
  } else if (decision) {
    const decisionLabel = decision === 'allow' ? '允许' : '拒绝'
    return `已由 ${sourceLabel} 处理（${decisionLabel}）`
  } else {
    return `已由 ${sourceLabel} 处理`
  }
}
