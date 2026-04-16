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
  devices: Record<string, DeviceState>
  allSessions: Array<SessionState & { deviceToken: string }>
  allPopups: Array<PopupState & { deviceToken: string }>
}

export function useAllDevicesWebSocket(devices: string[], serverUrl: string) {
  const wsRefs = useRef<Record<string, WebSocket>>({})
  const reconnectTimeoutsRef = useRef<Record<string, number>>({})
  const [state, setState] = useState<AggregatedState>({
    serverConnected: false,
    devices: {},
    allSessions: [],
    allPopups: [],
  })

  const connectDevice = useCallback((deviceToken: string) => {
    if (!deviceToken || !serverUrl) return

    // Clear existing connection
    if (wsRefs.current[deviceToken]) {
      wsRefs.current[deviceToken].close()
    }

    setState(s => ({
      ...s,
      devices: {
        ...s.devices,
        [deviceToken]: { status: 'connecting', sessions: [], popups: [] }
      }
    }))

    const ws = new WebSocket(serverUrl)
    wsRefs.current[deviceToken] = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'mobile_auth', device_token: deviceToken }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as CloudMessage

        switch (msg.type) {
          case 'auth_success':
            setState(s => ({
              ...s,
              serverConnected: true,
              devices: {
                ...s.devices,
                [deviceToken]: { ...s.devices[deviceToken] || { sessions: [], popups: [] }, status: 'connected' }
              }
            }))
            break

          case 'auth_failed':
            setState(s => ({
              ...s,
              devices: {
                ...s.devices,
                [deviceToken]: { ...s.devices[deviceToken] || { sessions: [], popups: [] }, status: 'error' }
              }
            }))
            ws.close()
            break

          case 'initial_state':
          case 'state_update': {
            setState(s => {
              const newDevices = {
                ...s.devices,
                [deviceToken]: {
                  status: s.devices[deviceToken]?.status || 'connected',
                  sessions: msg.sessions || [],
                  popups: msg.popups || [],
                }
              }

              // Re-aggregate all sessions and popups
              const allSessions = Object.entries(newDevices)
                .flatMap(([token, dev]) => (dev.sessions || []).map(sess => ({ ...sess, deviceToken: token })))
              const allPopups = Object.entries(newDevices)
                .flatMap(([token, dev]) => (dev.popups || []).map(pop => ({ ...pop, deviceToken: token })))

              return { ...s, devices: newDevices, allSessions, allPopups }
            })
            break
          }

          case 'new_popup_from_device': {
            const popup = msg.popup
            if (popup) {
              setState(s => ({
                ...s,
                allPopups: [...s.allPopups, { ...popup, deviceToken }],
                devices: {
                  ...s.devices,
                  [deviceToken]: {
                    ...s.devices[deviceToken] || { status: 'connected', sessions: [], popups: [] },
                    popups: [...(s.devices[deviceToken]?.popups || []), popup]
                  }
                }
              }))
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
        devices: {
          ...s.devices,
          [deviceToken]: { ...s.devices[deviceToken] || { sessions: [], popups: [] }, status: 'disconnected' }
        }
      }))

      // Reconnect after delay
      if (serverUrl && deviceToken) {
        reconnectTimeoutsRef.current[deviceToken] = window.setTimeout(() => {
          connectDevice(deviceToken)
        }, 5000)
      }
    }

    ws.onerror = () => {
      setState(s => ({
        ...s,
        devices: {
          ...s.devices,
          [deviceToken]: { ...s.devices[deviceToken] || { sessions: [], popups: [] }, status: 'error' }
        }
      }))
    }
  }, [serverUrl])

  const disconnectDevice = useCallback((deviceToken: string) => {
    if (reconnectTimeoutsRef.current[deviceToken]) {
      clearTimeout(reconnectTimeoutsRef.current[deviceToken])
      delete reconnectTimeoutsRef.current[deviceToken]
    }
    if (wsRefs.current[deviceToken]) {
      wsRefs.current[deviceToken].close()
      delete wsRefs.current[deviceToken]
    }
    setState(s => {
      const newDevices = { ...s.devices }
      delete newDevices[deviceToken]
      const allSessions = Object.entries(newDevices)
        .flatMap(([token, dev]) => (dev.sessions || []).map(sess => ({ ...sess, deviceToken: token })))
      const allPopups = Object.entries(newDevices)
        .flatMap(([token, dev]) => (dev.popups || []).map(pop => ({ ...pop, deviceToken: token })))
      return { ...s, devices: newDevices, allSessions, allPopups }
    })
  }, [])

  const respondPopup = useCallback((deviceToken: string, popupId: string, decision: string | null, answers?: string[][]) => {
    const ws = wsRefs.current[deviceToken]
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

    setState(s => ({
      ...s,
      allPopups: s.allPopups.filter(p => p.id !== popupId),
      devices: {
        ...s.devices,
        [deviceToken]: {
          ...s.devices[deviceToken],
          popups: (s.devices[deviceToken]?.popups || []).filter(p => p.id !== popupId)
        }
      }
    }))
  }, [])

  // Connect/disconnect devices when list changes
  useEffect(() => {
    if (!serverUrl) {
      // Disconnect all
      Object.keys(wsRefs.current).forEach(disconnectDevice)
      return
    }

    const currentTokens = Object.keys(wsRefs.current)
    const toConnect = devices.filter(t => !currentTokens.includes(t))
    const toDisconnect = currentTokens.filter(t => !devices.includes(t))

    toConnect.forEach(connectDevice)
    toDisconnect.forEach(disconnectDevice)
  }, [devices, serverUrl, connectDevice, disconnectDevice])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.keys(wsRefs.current).forEach(disconnectDevice)
    }
  }, [disconnectDevice])

  return { state, respondPopup }
}