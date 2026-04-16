// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react'

type ServerConnectionStatus = 'unconfigured' | 'configured'

export function useServerConnection() {
  const [status, setStatus] = useState<ServerConnectionStatus>(() => {
    const url = localStorage.getItem('cloud-server-url') || ''
    return url ? 'configured' : 'unconfigured'
  })

  // Poll localStorage for URL changes
  useEffect(() => {
    const checkUrl = () => {
      const url = localStorage.getItem('cloud-server-url') || ''
      setStatus(url ? 'configured' : 'unconfigured')
    }

    // Check immediately
    checkUrl()

    // Check every 2 seconds
    const interval = window.setInterval(checkUrl, 2000)

    return () => window.clearInterval(interval)
  }, [])

  return { status }
}