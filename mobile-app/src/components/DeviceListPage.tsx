// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react'

interface DeviceInfo {
  token: string
  name: string
  online: boolean
  pendingCount: number
  lastActivity: string | null
}

interface DeviceListPageProps {
  devices: string[]
  onSelectDevice: (token: string) => void
  onAddDevice: () => void
  onOpenSettings: () => void
  serverConnected: boolean
}

export function DeviceListPage({
  devices,
  onSelectDevice,
  onAddDevice,
  onOpenSettings,
  serverConnected
}: DeviceListPageProps) {
  // Mock device info for now - will be replaced with real data from WebSocket
  const [deviceInfos, setDeviceInfos] = useState<DeviceInfo[]>([])

  useEffect(() => {
    // Convert tokens to DeviceInfo objects
    const infos: DeviceInfo[] = devices.map(token => ({
      token,
      name: token.slice(0, 8) + '...',
      online: false, // Will be updated by WebSocket
      pendingCount: 0,
      lastActivity: null,
    }))
    setDeviceInfos(infos)
  }, [devices])

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${serverConnected ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
          <span className="text-[#a3a3a3] text-sm">
            {serverConnected ? '云服务器已连接' : '未连接'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onOpenSettings} className="text-[#a3a3a3] hover:text-[#f5f5f5] text-lg">
            ⚙
          </button>
          <button onClick={onAddDevice} className="text-[#a3a3a3] hover:text-[#f5f5f5] text-lg">
            +
          </button>
        </div>
      </div>

      {/* Device List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {deviceInfos.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[#737373] text-sm mb-4">暂无设备</div>
            <button
              onClick={onAddDevice}
              className="px-4 py-2 bg-[#1a1a1a] rounded-[12px] text-[#a3a3a3] text-sm border border-[#262626]"
            >
              添加设备
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {deviceInfos.map(info => (
              <DeviceCard
                key={info.token}
                info={info}
                onClick={() => onSelectDevice(info.token)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DeviceCard({ info, onClick }: { info: DeviceInfo; onClick: () => void }) {
  const timeText = info.lastActivity
    ? `最后: ${formatTime(info.lastActivity)}`
    : ''

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between p-4 rounded-[12px] bg-[#1a1a1a] border border-[#262626] cursor-pointer"
    >
      <div className="flex items-center gap-3">
        <span className="text-[#f5f5f5] text-[16px] font-medium">{info.name}</span>
        <div className={`w-2 h-2 rounded-full ${info.online ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
        <span className="text-[#a3a3a3] text-[14px]">
          {info.online ? '在线' : '离线'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {info.pendingCount > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-5 h-5 rounded-full bg-[#ef4444] flex items-center justify-center">
              <span className="text-white text-xs font-medium">{info.pendingCount}</span>
            </div>
          </div>
        )}
        {timeText && (
          <span className="text-[#737373] text-xs">{timeText}</span>
        )}
      </div>
    </div>
  )
}

function formatTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diff = Math.floor((now - then) / 1000 / 60)

  if (diff < 1) return '刚刚'
  if (diff < 60) return `${diff}分钟`
  if (diff < 24 * 60) return `${Math.floor(diff / 60)}小时`
  return `${Math.floor(diff / 24 / 60)}天`
}