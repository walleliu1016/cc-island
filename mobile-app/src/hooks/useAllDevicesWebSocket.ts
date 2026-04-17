// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, useCallback } from 'react'
import { SessionState, PopupState, CloudMessage } from '../types'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface DeviceState {
  status: ConnectionStatus
  sessions: SessionState[]
  popups: PopupState[]
}

interface AggregatedState {
  serverConnected: boolean
  serverConnecting: boolean
  devices: Record<string, DeviceState>
  allSessions: Array<SessionState & { deviceToken: string }>
  allPopups: Array<PopupState & { deviceToken: string }>
}

interface UseAllDevicesWebSocketOptions {
  devices: string[]
  serverUrl: string
  showToast?: (message: string, type: 'success' | 'error' | 'warning') => void
}

export function useAllDevicesWebSocket({ devices, serverUrl, showToast }: UseAllDevicesWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<AggregatedState>({
    serverConnected: false,
    serverConnecting: false,
    devices: {},
    allSessions: [],
    allPopups: [],
  })

  const connect = useCallback(() => {
    if (!serverUrl || devices.length === 0) {
      // No server URL or no devices - clear state
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setState({
        serverConnected: false,
        serverConnecting: false,
        devices: {},
        allSessions: [],
        allPopups: [],
      })
      return
    }

    // Clear existing connection
    if (wsRef.current) {
      wsRef.current.close()
    }

    setState(s => ({ ...s, serverConnecting: true, serverConnected: false }))

    const ws = new WebSocket(serverUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Send mobile_auth with all device tokens
      ws.send(JSON.stringify({
        type: 'mobile_auth',
        device_tokens: devices,
      }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as CloudMessage

        switch (msg.type) {
          case 'auth_success':
            setState(s => ({
              ...s,
              serverConnected: true,
              serverConnecting: false,
            }))
            break

          case 'auth_failed':
            setState(s => ({
              ...s,
              serverConnected: false,
              serverConnecting: false,
            }))
            ws.close()
            break

          case 'device_list': {
            // Server sends list of online devices
            const onlineDevices = msg.devices || []
            setState(s => {
              // Initialize device state for online devices
              const newDevices: Record<string, DeviceState> = {}
              for (const token of onlineDevices) {
                newDevices[token] = { status: 'connected', sessions: [], popups: [] }
              }
              return { ...s, devices: newDevices, allSessions: [], allPopups: [] }
            })
            break
          }

          case 'device_offline': {
            // A device went offline - remove from state
            const offlineToken = msg.device_token
            if (!offlineToken) break
            setState(s => {
              const newDevices = { ...s.devices }
              delete newDevices[offlineToken]
              // Filter sessions/popups belonging to this device
              const allSessions = s.allSessions.filter(sess => sess.deviceToken !== offlineToken)
              const allPopups = s.allPopups.filter(pop => pop.deviceToken !== offlineToken)
              return { ...s, devices: newDevices, allSessions, allPopups }
            })
            break
          }

          case 'initial_state':
          case 'state_update': {
            // These messages now contain aggregated data for all subscribed devices
            setState(s => {
              // Build device state map from the sessions/popups
              const newDevices: Record<string, DeviceState> = { ...s.devices }

              // Get first device token for assigning to sessions/popups
              const deviceTokens = Object.keys(s.devices)
              const firstToken = deviceTokens.length > 0 ? deviceTokens[0] : 'unknown'

              // Store all sessions/popups with the first device
              const allSessions = (msg.sessions || []).map(sess => ({
                ...sess,
                deviceToken: firstToken,
              }))
              const allPopups = (msg.popups || []).map(pop => ({
                ...pop,
                deviceToken: firstToken,
              }))

              return { ...s, devices: newDevices, allSessions, allPopups }
            })
            break
          }

          case 'new_popup_from_device': {
            const popup = msg.popup
            const deviceToken = msg.device_token
            if (popup && deviceToken) {
              setState(s => ({
                ...s,
                allPopups: [...s.allPopups, { ...popup, deviceToken }],
              }))
            }
            break
          }

          case 'popup_resolved': {
            // A popup was resolved by desktop or another mobile
            const popupId = msg.popup_id
            const source = msg.source
            const decision = msg.decision
            const answers = msg.answers

            if (popupId) {
              // Use setState to both find and remove the popup
              setState(s => {
                // Find the popup before removing
                const resolvedPopup = s.allPopups.find(p => p.id === popupId)

                // Remove popup from local state
                const allPopups = s.allPopups.filter(p => p.id !== popupId)

                // Show toast notification if resolved by desktop (async, outside setState)
                if (source === 'desktop' && showToast && resolvedPopup) {
                  // Use setTimeout to show toast after state update
                  setTimeout(() => {
                    const popupType = resolvedPopup.type
                    if (popupType === 'permission') {
                      showToast(
                        `已由 Desktop 处理（${decision === 'allow' ? '允许' : '拒绝'}）`,
                        decision === 'allow' ? 'success' : 'warning'
                      )
                    } else if (popupType === 'ask' && answers) {
                      const answerText = answers.map(a => a.join(', ')).join('; ')
                      showToast(`已由 Desktop 处理（${answerText}）`, 'success')
                    }
                  }, 0)
                }

                return { ...s, allPopups }
              })
            }
            break
          }
        }
      } catch (err) {
        console.warn('Failed to parse cloud message:', err)
      }
    }

    ws.onclose = () => {
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
      }))

      // Reconnect after delay if still have server URL and devices
      if (serverUrl && devices.length > 0) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, 5000)
      }
    }

    ws.onerror = () => {
      setState(s => ({
        ...s,
        serverConnected: false,
        serverConnecting: false,
      }))
    }
  }, [serverUrl, devices])

  const respondPopup = useCallback((deviceToken: string, popupId: string, decision: string | null, answers?: string[][]) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot respond to popup: not connected')
      return
    }

    ws.send(JSON.stringify({
      type: 'respond_popup',
      device_token: deviceToken,
      popup_id: popupId,
      decision,
      answers,
    }))

    // Remove popup from local state
    setState(s => ({
      ...s,
      allPopups: s.allPopups.filter(p => p.id !== popupId),
    }))
  }, [])

  // Connect/disconnect based on server URL and devices
  useEffect(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    connect()

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  return { state, respondPopup }
}