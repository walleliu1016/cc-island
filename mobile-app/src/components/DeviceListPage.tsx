// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { SessionState, PopupState, ConnectionStatus } from '../types'

interface DeviceState {
  status: ConnectionStatus
  sessions: SessionState[]
  popups: PopupState[]
}

interface DeviceListPageProps {
  sessions: Array<SessionState & { deviceToken: string }>
  popups: Array<PopupState & { deviceToken: string }>
  deviceStates: Record<string, DeviceState>
  serverConnected: boolean
  serverUrl: string
  onSelectDevice: (token: string) => void
  onRespondPopup: (deviceToken: string, popupId: string, decision: string | null) => void
  onAddDevice: () => void
  onOpenSettings: () => void
}

export function DeviceListPage({
  sessions,
  popups,
  deviceStates,
  serverConnected,
  serverUrl,
  onSelectDevice,
  onRespondPopup,
  onAddDevice,
  onOpenSettings,
}: DeviceListPageProps) {
  // Sort by priority: popups first, then processing sessions
  const pendingPopups = popups.filter(p => p.status === 'pending')
  const activeSessions = sessions.filter(s => s.status !== 'ended')

  // Sessions with pending popups (highest priority)
  const popupSessionIds = new Set(pendingPopups.map(p => p.session_id))

  // Processing sessions (with current_tool)
  const processingSessions = activeSessions
    .filter(s => !popupSessionIds.has(s.session_id))
    .filter(s => s.current_tool || s.status === 'working')

  // Idle sessions
  const idleSessions = activeSessions
    .filter(s => !popupSessionIds.has(s.session_id))
    .filter(s => !s.current_tool && s.status !== 'working')

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-2">
          {/* Cloud connection status */}
          <div className={`w-2 h-2 rounded-full ${serverConnected ? 'bg-[#22c55e]' : serverUrl ? 'bg-[#f59e0b]' : 'bg-[#737373]'}`} />
          <span className="text-[#a3a3a3] text-sm">
            {serverConnected ? '☁ 已连接' : serverUrl ? '☁ 连接中' : '☁ 未配置'}
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
        {/* Pending popups section */}
        {pendingPopups.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-[#a3a3a3] text-xs mb-2">待处理 ({pendingPopups.length})</div>
            <div className="space-y-3">
              {pendingPopups.map(popup => (
                <PopupRow
                  key={popup.id}
                  popup={popup}
                  session={sessions.find(s => s.session_id === popup.session_id)}
                  onRespond={(decision) => onRespondPopup(popup.deviceToken, popup.id, decision)}
                  onViewDetails={() => onSelectDevice(popup.deviceToken)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Sessions section */}
        {(processingSessions.length > 0 || idleSessions.length > 0) && (
          <div className="px-4 py-3 border-t border-[#262626]">
            <div className="text-[#a3a3a3] text-xs mb-2">会话 ({processingSessions.length + idleSessions.length})</div>
            <div className="space-y-2">
              {/* Processing sessions first */}
              {processingSessions.map(session => (
                <SessionRow
                  key={session.session_id}
                  session={session}
                  deviceState={deviceStates[session.deviceToken]}
                  onClick={() => onSelectDevice(session.deviceToken)}
                />
              ))}
              {/* Idle sessions */}
              {idleSessions.map(session => (
                <SessionRow
                  key={session.session_id}
                  session={session}
                  deviceState={deviceStates[session.deviceToken]}
                  onClick={() => onSelectDevice(session.deviceToken)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {activeSessions.length === 0 && pendingPopups.length === 0 && (
          <div className="text-center py-12 px-4">
            <div className="text-[#737373] text-sm mb-4">
              {serverUrl ? '暂无活跃会话' : '请先配置云服务器地址'}
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

function PopupRow({
  popup,
  session,
  onRespond,
  onViewDetails,
}: {
  popup: PopupState & { deviceToken: string }
  session?: SessionState & { deviceToken: string }
  onRespond: (decision: 'allow' | 'deny') => void
  onViewDetails: () => void
}) {
  const projectName = session?.project_name || popup.project_name || '未知项目'
  const isAsk = popup.type === 'ask'

  return (
    <div className="bg-white rounded-[12px] p-4 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[#f59e0b]">⚠</span>
          <span className="text-[#1a1a1a] text-sm font-medium truncate">{projectName}</span>
        </div>
        <button
          onClick={onViewDetails}
          className="text-[#737373] text-xs hover:text-[#1a1a1a]"
        >
          详情 →
        </button>
      </div>

      {isAsk ? (
        <div className="mb-3">
          <span className="text-[#3b82f6] text-xs font-medium">有问题待回答</span>
        </div>
      ) : (
        <div className="text-[#737373] text-xs mb-3 truncate">
          {(popup.data as { tool_name?: string; action?: string })?.tool_name || '权限请求'}
          {(popup.data as { action?: string })?.action && `: ${(popup.data as { action?: string }).action}`}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => onRespond('deny')}
          className="flex-1 py-2 bg-[#ef4444] text-white rounded-[8px] text-xs font-medium"
        >
          拒绝
        </button>
        <button
          onClick={() => isAsk ? onViewDetails() : onRespond('allow')}
          className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] text-xs font-medium"
        >
          {isAsk ? '去回答' : '允许'}
        </button>
      </div>
    </div>
  )
}

function SessionRow({
  session,
  deviceState,
  onClick,
}: {
  session: SessionState & { deviceToken: string }
  deviceState?: DeviceState
  onClick: () => void
}) {
  const projectName = session.project_name || '未知项目'
  const deviceConnected = deviceState?.status === 'connected'

  // Parse status JSON
  const statusInfo = parseSessionStatus(session.status, session.current_tool)

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626] cursor-pointer"
    >
      {/* Status indicator */}
      <div className="w-4 flex items-center justify-center">
        <div className={`w-2 h-2 rounded-full ${statusInfo.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <span className="text-[#f5f5f5] text-sm font-medium truncate">{projectName}</span>
        <div className="text-[#a3a3a3] text-xs truncate">
          {statusInfo.text}
        </div>
      </div>

      {/* Device connection indicator */}
      <div className={`w-2 h-2 rounded-full ${deviceConnected ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
    </div>
  )
}

// Parse status JSON and return display info
function parseSessionStatus(statusJson: string, currentTool?: string): { text: string; color: string } {
  try {
    const status = JSON.parse(statusJson) as { type: string; data?: string }

    switch (status.type) {
      case 'idle':
        return { text: '空闲', color: 'bg-[#737373]' }
      case 'thinking':
        return { text: '思考中...', color: 'bg-[#22c55e]' }
      case 'working':
        const toolName = status.data || currentTool || '工具'
        return { text: `执行: ${toolName}`, color: 'bg-[#22c55e]' }
      case 'waiting':
        return { text: '等待继续', color: 'bg-[#3b82f6]' }
      case 'waitingForApproval':
        return { text: '需要授权', color: 'bg-[#f59e0b]' }
      case 'error':
        return { text: '错误', color: 'bg-[#ef4444]' }
      case 'compacting':
        return { text: '压缩上下文', color: 'bg-[#8b5cf6]' }
      case 'ended':
        return { text: '已结束', color: 'bg-[#737373]' }
      default:
        return { text: currentTool || statusJson, color: 'bg-[#737373]' }
    }
  } catch {
    // Fallback for non-JSON status (legacy format)
    return { text: currentTool || statusJson, color: 'bg-[#737373]' }
  }
}