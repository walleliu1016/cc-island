import { useEffect, useRef, useState, useCallback } from 'react'
import { CloudMessage, SessionState, PopupState } from '../types'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface CloudState {
  status: ConnectionStatus
  sessions: SessionState[]
  popups: PopupState[]
}

export function useCloudWebSocket(deviceToken: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const [state, setState] = useState<CloudState>({
    status: 'disconnected',
    sessions: [],
    popups: [],
  })

  const getServerUrl = useCallback(() => {
    return localStorage.getItem('cloud-server-url') || 'ws://localhost:17528'
  }, [])

  const connect = useCallback(() => {
    if (!deviceToken) return

    const serverUrl = getServerUrl()

    setState(s => ({ ...s, status: 'connecting' }))

    const ws = new WebSocket(serverUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Send mobile auth
      const authMsg = {
        type: 'mobile_auth',
        device_token: deviceToken,
      }
      ws.send(JSON.stringify(authMsg))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as CloudMessage

        switch (msg.type) {
          case 'auth_success':
            setState(s => ({ ...s, status: 'connected' }))
            break

          case 'auth_failed':
            setState(s => ({ ...s, status: 'error' }))
            ws.close()
            break

          case 'initial_state':
            setState(s => ({
              ...s,
              sessions: msg.sessions || [],
              popups: msg.popups || [],
            }))
            break

          case 'state_update':
            setState(s => ({
              ...s,
              sessions: msg.sessions || [],
              popups: msg.popups || [],
            }))
            break

          case 'new_popup_from_device':
            setState(s => ({
              ...s,
              popups: [...s.popups, msg.popup!],
            }))
            // Show notification if permitted
            showNotification(msg.popup!)
            break
        }
      } catch (err) {
        console.warn('Failed to parse cloud message:', err)
      }
    }

    ws.onclose = () => {
      setState(s => ({ ...s, status: 'disconnected' }))
      // Attempt reconnect after delay
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, 5000)
    }

    ws.onerror = () => {
      setState(s => ({ ...s, status: 'error' }))
    }

  }, [deviceToken, getServerUrl])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current)
    }
    wsRef.current?.close()
    wsRef.current = null
    setState(s => ({ ...s, status: 'disconnected' }))
  }, [])

  const respondPopup = useCallback((popupId: string, decision: string | null, answers?: string[][]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('Cannot respond to popup: not connected')
      return
    }

    const msg = {
      type: 'respond_popup',
      device_token: deviceToken,
      popup_id: popupId,
      decision,
      answers,
    }
    wsRef.current.send(JSON.stringify(msg))

    // Remove popup from local state
    setState(s => ({
      ...s,
      popups: s.popups.filter(p => p.id !== popupId),
    }))
  }, [deviceToken])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { state, respondPopup, connect, disconnect }
}

function showNotification(popup: PopupState) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`${popup.project_name || 'CC-Island'} 需要审批`, {
      body: popup.popup_type === 'permission'
        ? `工具: ${popup.data?.tool_name || '未知'}`
        : `问题: ${popup.data?.questions?.[0]?.question || '未知'}`,
      tag: popup.id,
    })
  }
}