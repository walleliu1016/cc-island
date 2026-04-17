// mobile-app/src/components/DeviceDetailPage.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ClaudeSession, HookHint, ChatMessageData, AskData } from '../types'
import { ChatView } from './ChatView'
import { PopupCard } from './PopupCard'

// Extended device info with cached hostname
interface DeviceInfoExtended {
  hostname?: string
  cached_hostname?: string  // Cached hostname for offline display
  registered_at?: string
  online?: boolean
}

interface DeviceDetailPageProps {
  deviceInfo?: DeviceInfoExtended
  sessions: ClaudeSession[]
  hookHints: HookHint[]
  chatMessages: Record<string, ChatMessageData[]>
  connected: boolean
  onBack: () => void
  onRespondHook: (sessionId: string, decision: string | null, answers?: string[][]) => void
  onRequestChatHistory: (sessionId: string) => void
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void
}

export function DeviceDetailPage({
  deviceInfo,
  sessions,
  hookHints,
  chatMessages,
  connected,
  onBack,
  onRespondHook,
  onRequestChatHistory,
  showToast,
}: DeviceDetailPageProps) {
  const [chatSession, setChatSession] = useState<{ sessionId: string; projectName: string } | null>(null)
  const [dismissingPopups, setDismissingPopups] = useState<string[]>([])
  const dismissTimeoutRef = useRef<number | null>(null)

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current)
      }
    }
  }, [])

  // Use hostname from: online info > cached info > '未知设备' (never fallback to token)
  const deviceName = deviceInfo?.hostname || deviceInfo?.cached_hostname || '未知设备'
  const pendingHints = hookHints.filter(h => h.urgent && !dismissingPopups.includes(h.session_id))
  // Deduplicate sessions by sessionId (in case of duplicates from server)
  const activeSessions = sessions.filter(s => s.status !== 'ended').filter((s, i, arr) =>
    arr.findIndex(x => x.sessionId === s.sessionId) === i
  )

  const handleViewChat = (sessionId: string, projectName: string) => {
    onRequestChatHistory(sessionId)
    setChatSession({ sessionId, projectName })
  }

  const handleRespond = (sessionId: string, decision?: string | null, answers?: string[][]) => {
    setDismissingPopups(prev => [...prev, sessionId])

    if (decision === 'allow') {
      showToast('已允许', 'success')
    } else if (decision === 'deny') {
      showToast('已拒绝', 'error')
    } else {
      showToast('已提交', 'success')
    }

    dismissTimeoutRef.current = window.setTimeout(() => {
      onRespondHook(sessionId, decision ?? null, answers)
      setDismissingPopups(prev => prev.filter(id => id !== sessionId))
    }, 200)
  }

  // If viewing chat, show ChatView
  if (chatSession) {
    return (
      <ChatView
        projectName={chatSession.projectName}
        onClose={() => setChatSession(null)}
        messages={chatMessages[chatSession.sessionId] || []}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[#a3a3a3] text-lg">←</button>
          <span className="text-[#f5f5f5] text-lg font-medium">{deviceName}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
          <span className={`text-xs ${connected ? 'text-[#22c55e]' : 'text-[#737373]'}`}>
            {connected ? '在线' : '离线'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sessions Section */}
        <div className="px-4 py-3">
          <div className="text-[#a3a3a3] text-xs mb-2">会话列表 ({activeSessions.length})</div>
          {activeSessions.length === 0 ? (
            <div className="text-[#737373] text-sm py-4">暂无活跃会话</div>
          ) : (
            <div className="space-y-2">
              {activeSessions.map(session => (
                <SessionCard
                  key={session.sessionId}
                  session={session}
                  hasPendingHook={pendingHints.some(h => h.session_id === session.sessionId)}
                  onViewChat={() => handleViewChat(session.sessionId, session.projectName)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        {pendingHints.length > 0 && (
          <div className="px-4 py-2 border-t border-[#262626]">
            <div className="text-[#f59e0b] text-xs">
              待处理 ({pendingHints.length})
            </div>
          </div>
        )}

        {/* Popups Section */}
        <div className="px-4 py-3 space-y-3">
          <AnimatePresence>
            {pendingHints.map(hint => (
              <HookHintCard
                key={hint.session_id}
                hint={hint}
                session={sessions.find(s => s.sessionId === hint.session_id)}
                onRespond={handleRespond}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session, hasPendingHook, onViewChat }: {
  session: ClaudeSession
  hasPendingHook: boolean
  onViewChat: () => void
}) {
  const statusInfo = getStatusInfo(session.status, session.currentTool)

  return (
    <div className="p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626]">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusInfo.color}`} />
        <div className="text-[#f5f5f5] text-sm font-medium">{session.projectName}</div>
        {hasPendingHook && <span className="text-[#f59e0b] text-xs">⚠</span>}
      </div>
      <div className="text-[#a3a3a3] text-xs mt-1">
        {statusInfo.text}
      </div>
      <button
        onClick={onViewChat}
        className="mt-2 px-3 py-1 bg-[#262626] rounded-[8px] text-[#a3a3a3] text-xs hover:bg-[#1a1a1a]"
      >
        查看对话
      </button>
    </div>
  )
}

function HookHintCard({ hint, session, onRespond }: {
  hint: HookHint
  session?: ClaudeSession
  onRespond: (sessionId: string, decision: string | null, answers?: string[][]) => void
}) {
  const projectName = session?.projectName || '未知项目'
  const isPermission = hint.hook_type === 'PermissionRequest'

  if (!isPermission && hint.questions) {
    // Ask popup - use PopupCard
    return (
      <PopupCard
        popup={{
          id: hint.session_id,
          session_id: hint.session_id,
          project_name: projectName,
          type: 'ask',
          data: { questions: hint.questions } as AskData,
          ask_data: { questions: hint.questions } as AskData,
          status: 'pending',
          created_at: hint.timestamp,
        }}
        onRespond={(_popupId, decision, answers) => onRespond(hint.session_id, decision ?? null, answers)}
      />
    )
  }

  // Permission popup
  return (
    <div className="bg-white rounded-[12px] p-4 shadow-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#f59e0b]">⚠</span>
        <span className="text-[#1a1a1a] text-sm font-medium">{projectName}</span>
      </div>
      <div className="text-[#737373] text-xs mb-3">
        {hint.tool_name}: {hint.action || ''}
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => onRespond(hint.session_id, 'deny')}
          className="flex-1 py-2 bg-[#ef4444] text-white rounded-[8px] text-xs font-medium"
        >
          拒绝
        </button>
        <button
          onClick={() => onRespond(hint.session_id, 'allow')}
          className="flex-1 py-2 bg-[#22c55e] text-white rounded-[8px] text-xs font-medium"
        >
          允许
        </button>
      </div>
    </div>
  )
}

function getStatusInfo(status: string, currentTool?: string): { text: string; color: string } {
  switch (status) {
    case 'idle':
      return { text: '空闲', color: 'bg-[#737373]' }
    case 'thinking':
      return { text: '思考中...', color: 'bg-[#22c55e]' }
    case 'working':
      return { text: `执行: ${currentTool || '工具'}`, color: 'bg-[#22c55e]' }
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
      return { text: currentTool || status, color: 'bg-[#737373]' }
  }
}