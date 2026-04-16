// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'

interface DeviceSettings {
  token: string
  autoAllow: boolean
}

interface SettingsPageProps {
  serverUrl: string
  serverConnected: boolean
  devices: string[]
  onSaveServer: (url: string) => void
  onDeleteDevice: (token: string) => void
  onToggleAutoAllow: (token: string, enabled: boolean) => void
  onBack: () => void
}

export function SettingsPage({
  serverUrl,
  serverConnected,
  devices,
  onSaveServer,
  onDeleteDevice,
  onToggleAutoAllow,
  onBack,
}: SettingsPageProps) {
  const [url, setUrl] = useState(serverUrl)
  const [error, setError] = useState<string | null>(null)
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings[]>([])

  useEffect(() => {
    // Load device settings from localStorage
    const saved = localStorage.getItem('cc-device-settings')
    if (saved) {
      setDeviceSettings(JSON.parse(saved))
    } else {
      // Initialize with defaults
      const initial: DeviceSettings[] = devices.map(token => ({ token, autoAllow: false }))
      setDeviceSettings(initial)
    }
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
  }

  const toggleAutoAllow = (token: string) => {
    setDeviceSettings(prev =>
      prev.map(s => s.token === token ? { ...s, autoAllow: !s.autoAllow } : s)
    )
    const settings = deviceSettings.find(s => s.token === token)
    if (settings) {
      onToggleAutoAllow(token, !settings.autoAllow)
    }
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
            <div className={`w-2 h-2 rounded-full ${serverConnected ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
            <span className="text-[#a3a3a3] text-xs">
              {serverConnected ? '已连接' : '未连接'}
            </span>
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

        {/* Auto-allow Section */}
        <div className="mb-6">
          <div className="text-[#a3a3a3] text-xs mb-2">权限设置</div>
          {devices.map(token => (
            <div key={token} className="flex items-center justify-between py-3 border-b border-[#262626]">
              <div>
                <div className="text-[#f5f5f5] text-sm">{token.slice(0, 8)}...</div>
                <div className="text-[#737373] text-xs">自动允许所有权限</div>
              </div>
              <button
                onClick={() => toggleAutoAllow(token)}
                className={`w-12 h-6 rounded-full relative transition-colors ${
                  getAutoAllow(token) ? 'bg-[#22c55e]' : 'bg-[#262626]'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                  getAutoAllow(token) ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>

        {/* Device List */}
        <div>
          <div className="text-[#a3a3a3] text-xs mb-2">已添加设备 ({devices.length})</div>
          {devices.map(token => (
            <div key={token} className="flex items-center justify-between py-3 border-b border-[#262626]">
              <span className="text-[#f5f5f5] text-sm">{token.slice(0, 8)}...</span>
              <button
                onClick={() => onDeleteDevice(token)}
                className="text-[#ef4444] text-xs"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}