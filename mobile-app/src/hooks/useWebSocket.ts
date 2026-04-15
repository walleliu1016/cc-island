import { useEffect, useRef, useState, useCallback } from 'react'
import { WsMessage } from '../types'

type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error'

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const intentionalCloseRef = useRef(false)
  const pendingMessagesRef = useRef<WsMessage[]>([])
  const passwordRef = useRef<string>('')
  const authPendingRef = useRef(false)

  const connect = useCallback((url: string, password?: string) => {
    intentionalCloseRef.current = false
    reconnectAttemptsRef.current = 0
    passwordRef.current = password || ''

    // Extract token from URL if present (fallback for initial connection)
    const urlObj = new URL(url)
    const tokenFromUrl = urlObj.searchParams.get('token')
    if (tokenFromUrl) {
      passwordRef.current = tokenFromUrl
      urlObj.searchParams.delete('token')
      url = urlObj.toString()
    }

    const doConnect = () => {
      setStatus('connecting')
      authPendingRef.current = false
      pendingMessagesRef.current = []

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0
        console.log('[WebSocket] Connected, authenticating...')

        // Send auth message if password is set
        if (passwordRef.current) {
          setStatus('authenticating')
          authPendingRef.current = true
          ws.send(JSON.stringify({ type: 'auth', token: passwordRef.current }))
        } else {
          setStatus('connected')
        }
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)

          // Handle auth response
          if (msg.type === 'auth_success') {
            console.log('[WebSocket] Authentication successful')
            setStatus('connected')
            authPendingRef.current = false

            // Send pending messages
            pendingMessagesRef.current.forEach(m => ws.send(JSON.stringify(m)))
            pendingMessagesRef.current = []
            return
          }

          if (msg.type === 'auth_failed') {
            console.warn('[WebSocket] Authentication failed')
            setStatus('error')
            intentionalCloseRef.current = true
            ws.close()
            return
          }

          // Handle other messages only after auth
          if (status === 'connected' || !passwordRef.current) {
            onMessage(msg as WsMessage)
          }
        } catch (err) {
          console.warn('[WebSocket] Failed to parse message:', err)
        }
      }

      ws.onclose = () => {
        if (intentionalCloseRef.current) {
          setStatus('disconnected')
          return
        }

        // Reconnect logic
        const maxAttempts = 8
        if (reconnectAttemptsRef.current < maxAttempts) {
          reconnectAttemptsRef.current++
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 15000)
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`)
          reconnectTimeoutRef.current = window.setTimeout(doConnect, delay)
          setStatus('connecting')
        } else {
          setStatus('error')
          console.warn('[WebSocket] Max reconnect attempts reached')
        }
      }

      ws.onerror = () => {
        setStatus('error')
      }
    }

    doConnect()
  }, [onMessage, status])

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current)
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [])

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // If still authenticating, queue the message
      if (authPendingRef.current) {
        pendingMessagesRef.current.push(msg)
      } else {
        wsRef.current.send(JSON.stringify(msg))
      }
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [])

  return { connect, disconnect, send, status }
}