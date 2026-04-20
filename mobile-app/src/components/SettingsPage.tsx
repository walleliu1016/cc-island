// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'

interface DeviceSettings {
  token: string
  autoAllow: boolean
}

// Extended device info with cached hostname
interface CachedDeviceInfo {
  token: string
  hostname?: string
  cached_hostname?: string
  registered_at?: string
  online?: boolean
}

interface SettingsPageProps {
  serverUrl: string
  serverConnected: boolean
  serverConnecting: boolean
  connectionError: string | null
  devices: string[]
  deviceInfoMap: Record<string, CachedDeviceInfo>
  onSaveServer: (url: string) => void
  onDeleteDevice: (token: string) => void
  onToggleAutoAllow: (token: string, enabled: boolean) => void
  onBack: () => void
}

export function SettingsPage({
  serverUrl,
  serverConnected,
  serverConnecting,
  connectionError,
  devices,
  deviceInfoMap,
  onSaveServer,
  onDeleteDevice,
  onToggleAutoAllow,
  onBack,
}: SettingsPageProps) {
  const [url, setUrl] = useState(serverUrl)
  const [error, setError] = useState<string | null>(null)
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings[]>([])

  useEffect(() => {
    // Load device settings from localStorage with error handling
    setDeviceSettings(_prev => {
      try {
        const saved = localStorage.getItem('cc-device-settings')
        let loaded: DeviceSettings[] = saved ? JSON.parse(saved) : []
        // Merge: keep existing settings, add new devices
        const existingTokens = new Set(loaded.map(s => s.token))
        const newDevices = devices.filter(t => !existingTokens.has(t))
        return [...loaded, ...newDevices.map(token => ({ token, autoAllow: false }))]
      } catch {
        // On error, initialize fresh
        return devices.map(token => ({ token, autoAllow: false }))
      }
    })
  }, [devices])

  useEffect(() => {
    localStorage.setItem('cc-device-settings', JSON.stringify(deviceSettings))
  }, [deviceSettings])

  const handleSave = () => {
    setError(null)
    if (url.trim() && !url.startsWith('ws://') && !url.startsWith('wss://')) {
      setError('地址必须以 ws:// 或 wss:// 开头')
      return
    }
    onSaveServer(url.trim())
    // Navigate back to device list after save
    onBack()
  }

  const toggleAutoAllow = (token: string) => {
    let newValue = false
    setDeviceSettings(prev =>
      prev.map(s => {
        if (s.token === token) {
          newValue = !s.autoAllow
          return { ...s, autoAllow: newValue }
        }
        return s
      })
    )
    onToggleAutoAllow(token, newValue)
  }

  const getAutoAllow = (token: string) => {
    const s = deviceSettings.find(d => d.token === token)
    return s?.autoAllow ?? false
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[#262626]">
        <button onClick={onBack} className="text-[#a3a3a3] mr-3 text-lg">←</button>
        <span className="text-[#f5f5f5] text-lg font-medium">设置</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Server Section */}
        <div className="mb-6">
          <div className="text-[#a3a3a3] text-xs mb-2">云服务器地址</div>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="wss://cloud.example.com:17528"
            className="w-full px-4 py-3 bg-[#1a1a1a] border border-[#262626] rounded-[12px] text-[#f5f5f5] text-[14px]"
          />
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-2 h-2 rounded-full ${
              serverConnected ? 'bg-[#22c55e]' :
              serverConnecting ? 'bg-[#f59e0b]' : 'bg-[#737373]'
            }`} />
            <span className="text-[#a3a3a3] text-xs">
              {serverConnected ? '已连接' :
               serverConnecting ? '连接中...' : '未连接'}
            </span>
            {connectionError && (
              <span className="text-[#ef4444] text-xs ml-2">{connectionError}</span>
            )}
            {!serverUrl.trim() && !connectionError && (
              <span className="text-[#737373] text-xs ml-2">请输入服务器地址</span>
            )}
            {serverUrl.trim() && devices.length === 0 && !connectionError && (
              <span className="text-[#f59e0b] text-xs ml-2">请先添加设备</span>
            )}
          </div>
          {error && (
            <div className="text-[#ef4444] text-xs mt-2">{error}</div>
          )}
          <button
            onClick={handleSave}
            className="w-full mt-3 py-2 bg-[#1a1a1a] border border-[#262626] rounded-[8px] text-[#f5f5f5] text-[14px]"
          >
            保存并重新连接
          </button>
        </div>

        {/* Device List with Auto-allow Toggle */}
        <div className="mb-6">
          <div className="text-[#a3a3a3] text-xs mb-2">设备管理 ({devices.length})</div>
          {devices.map(token => {
            const autoAllow = getAutoAllow(token)
            const info = deviceInfoMap[token]
            // Use hostname from cache, fallback to '未知设备' (never show token)
            const displayName = info?.hostname || info?.cached_hostname || '未知设备'
            return (
              <div key={token} className="flex items-center justify-between py-3 border-b border-[#262626]">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-[#f5f5f5] text-sm truncate">{displayName}</span>
                  <div className="text-[#737373] text-xs">自动允许</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleAutoAllow(token)}
                    role="switch"
                    aria-checked={autoAllow}
                    className={`w-12 h-6 rounded-full relative transition-colors ${
                      autoAllow ? 'bg-[#22c55e]' : 'bg-[#262626]'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                      autoAllow ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                  <button
                    onClick={() => onDeleteDevice(token)}
                    className="text-[#ef4444] text-xs"
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}