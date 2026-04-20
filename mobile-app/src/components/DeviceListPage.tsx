// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { DeviceInfo, HookHint } from '../types'

// Extended device info with cached hostname
interface CachedDeviceInfo extends DeviceInfo {
  cached_hostname?: string;
}

interface DeviceListPageProps {
  userDevices: string[]          // User-added device tokens
  onlineDevices: DeviceInfo[]    // Online device info from server
  deviceInfoMap: Record<string, CachedDeviceInfo>  // Cached device info for offline display
  hookHints: Record<string, HookHint[]>  // Hook hints per device
  serverConnected: boolean
  serverConnecting: boolean
  connectionError: string | null
  serverUrl: string
  onSelectDevice: (token: string) => void
  onRespondHook: (deviceToken: string, sessionId: string, decision: string | null, answers?: string[][]) => void
  onAddDevice: () => void
  onOpenSettings: () => void
}

export function DeviceListPage({
  userDevices,
  onlineDevices,
  deviceInfoMap,
  hookHints,
  serverConnected,
  serverConnecting,
  connectionError,
  serverUrl,
  onSelectDevice,
  onRespondHook,
  onAddDevice,
  onOpenSettings,
}: DeviceListPageProps) {

  // Combine user devices with cached info (never fallback to token)
  const displayDevices = userDevices.map(token => {
    const onlineInfo = onlineDevices.find(d => d.token === token)
    const cachedInfo = deviceInfoMap[token]

    // Get hostname from: online info > cached info > '未知设备'
    const hostname = onlineInfo?.hostname || cachedInfo?.cached_hostname || cachedInfo?.hostname || '未知设备'

    return {
      token,
      hostname,
      registered_at: onlineInfo?.registered_at || cachedInfo?.registered_at,
      online: !!onlineInfo,
      hints: hookHints[token] || [],
    }
  })

  // Devices with urgent hints (need action)
  const urgentDevices = displayDevices.filter(d => d.hints.some(h => h.urgent))
  // Devices with activity hints (running)
  const activeDevices = displayDevices.filter(d => !d.hints.some(h => h.urgent) && d.hints.length > 0)
  // Idle or offline devices
  const idleDevices = displayDevices.filter(d => d.hints.length === 0)

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            serverConnected ? 'bg-[#22c55e]' :
            serverConnecting ? 'bg-[#f59e0b] animate-pulse' :
            connectionError ? 'bg-[#ef4444]' : 'bg-[#737373]'
          }`} />
          <span className={`text-sm ${
            connectionError ? 'text-[#ef4444]' : 'text-[#a3a3a3]'
          }`}>
            {serverConnected ? '☁ 已连接' :
             serverConnecting ? '☁ 连接中...' :
             connectionError ? `☁ ${connectionError.slice(0, 20)}${connectionError.length > 20 ? '...' : ''}` :
             '☁ 未配置'}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Urgent devices section */}
        {urgentDevices.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-[#f59e0b] text-xs mb-2">需要处理 ({urgentDevices.length})</div>
            <div className="space-y-3">
              {urgentDevices.map(device => (
                <UrgentDeviceCard
                  key={device.token}
                  device={device}
                  onSelect={() => onSelectDevice(device.token)}
                  onRespond={onRespondHook}
                />
              ))}
            </div>
          </div>
        )}

        {/* Active devices section */}
        {activeDevices.length > 0 && (
          <div className="px-4 py-3 border-t border-[#262626]">
            <div className="text-[#22c55e] text-xs mb-2">运行中 ({activeDevices.length})</div>
            <div className="space-y-2">
              {activeDevices.map(device => (
                <ActiveDeviceCard
                  key={device.token}
                  device={device}
                  onSelect={() => onSelectDevice(device.token)}
                />
              ))}
            </div>
          </div>
        )}

        {/* All devices section */}
        {idleDevices.length > 0 && (
          <div className="px-4 py-3 border-t border-[#262626]">
            <div className="text-[#a3a3a3] text-xs mb-2">设备 ({idleDevices.length})</div>
            <div className="space-y-2">
              {idleDevices.map(device => (
                <IdleDeviceCard
                  key={device.token}
                  device={device}
                  onSelect={() => onSelectDevice(device.token)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {displayDevices.length === 0 && (
          <div className="text-center py-12 px-4">
            <div className="text-[#737373] text-sm mb-4">
              {serverUrl ? '请添加设备' : '请先配置云服务器地址'}
            </div>
            {!serverUrl && (
              <button
                onClick={onOpenSettings}
                className="px-4 py-2 bg-[#1a1a1a] rounded-[12px] text-[#a3a3a3] text-sm border border-[#262626]"
              >
                前往设置
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Urgent device card (needs action)
function UrgentDeviceCard({ device, onSelect, onRespond }: {
  device: { token: string; hostname: string; hints: HookHint[]; online: boolean }
  onSelect: () => void
  onRespond: (deviceToken: string, sessionId: string, decision: string | null, answers?: string[][]) => void
}) {
  const urgentHint = device.hints.find(h => h.urgent)!
  const isPermission = urgentHint.hook_type === 'PermissionRequest'

  return (
    <div className="bg-white rounded-[12px] p-4 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[#f59e0b]">⚠</span>
          <span className="text-[#1a1a1a] text-sm font-medium">{device.hostname}</span>
        </div>
        <button onClick={onSelect} className="text-[#737373] text-xs hover:text-[#1a1a1a]">
          详情 →
        </button>
      </div>

      <div className="text-[#737373] text-xs mb-3">
        {isPermission ? `${urgentHint.tool_name}: ${urgentHint.action || ''}` : '有问题待回答'}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onRespond(device.token, urgentHint.session_id, 'deny')}
          className="flex-1 py-2 bg-[#ef4444] text-white rounded-[8px] text-xs font-medium"
        >
          拒绝
        </button>
        <button
          onClick={() => isPermission
            ? onRespond(device.token, urgentHint.session_id, 'allow')
            : onSelect()}
          className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] text-xs font-medium"
        >
          {isPermission ? '允许' : '去回答'}
        </button>
      </div>
    </div>
  )
}

// Active device card (running)
function ActiveDeviceCard({ device, onSelect }: {
  device: { token: string; hostname: string; hints: HookHint[]; online: boolean }
  onSelect: () => void
}) {
  const latestHint = device.hints[0]
  const statusText = latestHint?.hook_type === 'PreToolUse'
    ? `执行: ${latestHint.tool_name}`
    : latestHint?.hook_type === 'UserPromptSubmit'
    ? '思考中...'
    : '运行中'

  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-3 p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626] cursor-pointer"
    >
      <div className="w-4 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[#f5f5f5] text-sm font-medium truncate">{device.hostname}</span>
        <div className="text-[#a3a3a3] text-xs truncate">{statusText}</div>
      </div>
      <div className={`w-2 h-2 rounded-full ${device.online ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
    </div>
  )
}

// Idle device card
function IdleDeviceCard({ device, onSelect }: {
  device: { token: string; hostname: string; registered_at?: string; online: boolean }
  onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-3 p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626] cursor-pointer"
    >
      <div className="w-4 flex items-center justify-center">
        <div className={`w-2 h-2 rounded-full ${device.online ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[#f5f5f5] text-sm font-medium truncate">{device.hostname}</span>
        <div className="text-[#a3a3a3] text-xs">
          {device.online ? '在线 · 空闲' : '离线'}
        </div>
      </div>
      <span className="text-[#737373] text-xs">→</span>
    </div>
  )
}