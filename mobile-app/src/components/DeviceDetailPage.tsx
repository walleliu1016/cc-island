// mobile-app/src/components/DeviceDetailPage.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react'
import { ClaudeSession, HookHint, ChatMessageData } from '../types'
import { ChatView } from './ChatView'

// Terminal-style colors (matching desktop)
const TerminalColors = {
  prompt: '#d97857',  // Claude orange
  amber: '#ffb700',
  dim: 'rgba(255,255,255,0.4)',
}

// Processing Spinner - Animated symbol spinner matching Claude Island (desktop)
// Uses rotating symbols: · ✢ ✳ ∗ ✻ ✽
function ProcessingSpinner({ size = 12, animated = true }: { size?: number; animated?: boolean }) {
  const [phase, setPhase] = useState(0)
  const symbols = ['·', '✢', '✳', '∗', '✻', '✽']
  const color = animated ? TerminalColors.prompt : TerminalColors.dim

  useEffect(() => {
    if (!animated) return
    const timer = setInterval(() => {
      setPhase((p) => (p + 1) % symbols.length)
    }, 150)
    return () => clearInterval(timer)
  }, [animated])

  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 'bold',
        color,
        width: size,
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      {symbols[phase]}
    </span>
  )
}

// Amber spinner for waitingForApproval state (matching desktop)
function AmberSpinner({ size = 12 }: { size?: number }) {
  const [phase, setPhase] = useState(0)
  const symbols = ['·', '✢', '✳', '∗', '✻', '✽']

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((p) => (p + 1) % symbols.length)
    }, 150)
    return () => clearInterval(timer)
  }, [])

  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 'bold',
        color: TerminalColors.amber,
        width: size,
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      {symbols[phase]}
    </span>
  )
}

// Status indicator component - spinner for active states, static dot for idle
function StatusIndicator({ status, size = 12 }: { status: string; size?: number }) {
  // waitingForApproval - amber spinner (matching desktop)
  if (status === 'waitingForApproval') {
    return <AmberSpinner size={size} />
  }

  const isActive = status === 'thinking' || status === 'working' || status === 'waiting' || status === 'compacting'

  if (isActive) {
    return <ProcessingSpinner size={size} animated={true} />
  }

  // Idle/ended/error - static dim dot
  return (
    <span
      style={{
        fontSize: size,
        color: TerminalColors.dim,
        width: size,
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      ·
    </span>
  )
}

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
    const sessionPendingHint = pendingHints.find(h => h.session_id === chatSession.sessionId)
    return (
      <ChatView
        projectName={chatSession.projectName}
        onClose={() => setChatSession(null)}
        messages={chatMessages[chatSession.sessionId] || []}
        pendingHint={sessionPendingHint}
        onSubmitAnswers={(sessionId, answers) => handleRespond(sessionId, null, answers)}
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
                  pendingHint={pendingHints.find(h => h.session_id === session.sessionId)}
                  onViewChat={() => handleViewChat(session.sessionId, session.projectName)}
                  onRespond={handleRespond}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session, hasPendingHook, pendingHint, onViewChat, onRespond }: {
  session: ClaudeSession
  hasPendingHook: boolean
  pendingHint?: HookHint
  onViewChat: () => void
  onRespond: (sessionId: string, decision: string | null, answers?: string[][]) => void
}) {
  const statusInfo = getStatusInfo(session.status, session.currentTool, session.toolInput)
  const isAsk = pendingHint?.questions && pendingHint.questions.length > 0

  return (
    <div className="p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasPendingHook ? (
            <AmberSpinner size={12} />
          ) : (
            <StatusIndicator status={session.status} size={12} />
          )}
          <div className="text-[#f5f5f5] text-sm font-medium">{session.projectName}</div>
        </div>
        {/* Inline action buttons when has pending hook */}
        {hasPendingHook && pendingHint ? (
          isAsk ? (
            // Ask question - show "去回答" button
            <button
              onClick={onViewChat}
              className="px-3 py-1.5 text-xs font-medium text-black bg-white rounded-[8px]"
            >
              去回答
            </button>
          ) : (
            // Permission request - show Allow/Deny inline
            <div className="flex gap-2">
              <button
                onClick={() => onRespond(session.sessionId, 'deny')}
                className="px-3 py-1.5 text-xs text-white/80 bg-[#ef4444] rounded-[8px]"
              >
                Deny
              </button>
              <button
                onClick={() => onRespond(session.sessionId, 'allow')}
                className="px-3 py-1.5 text-xs font-medium text-black bg-white rounded-[8px]"
              >
                Allow
              </button>
            </div>
          )
        ) : (
          // No pending hook - show "查看对话" button
          <button
            onClick={onViewChat}
            className="px-3 py-1 bg-[#262626] rounded-[8px] text-[#a3a3a3] text-xs hover:bg-[#333]"
          >
            查看对话
          </button>
        )}
      </div>
      {/* Status text or tool info */}
      <div className="text-[#a3a3a3] text-xs mt-2">
        {hasPendingHook ? (
          pendingHint?.tool_name ? `${pendingHint.tool_name}: ${pendingHint.action || ''}` : '待处理'
        ) : (
          statusInfo.text
        )}
      </div>
    </div>
  )
}

function getStatusInfo(status: string, currentTool?: string, toolInput?: { command?: string; file_path?: string; action?: string; details?: string }): { text: string; color: string } {
  // Helper to get tool input summary (matching desktop)
  const getInputSummary = (): string => {
    if (!toolInput) return ''
    return toolInput.command || toolInput.file_path || toolInput.action || toolInput.details || ''
  }

  switch (status) {
    case 'idle':
      return { text: 'Idle', color: 'bg-[#737373]' }
    case 'thinking':
      return { text: 'Thinking', color: 'bg-[#22c55e]' }
    case 'working': {
      const toolName = currentTool || 'Working'
      const inputSummary = getInputSummary()
      return {
        text: inputSummary ? `${toolName}: ${inputSummary.slice(0, 20)}${inputSummary.length > 20 ? '...' : ''}` : toolName,
        color: 'bg-[#22c55e]'
      }
    }
    case 'waiting':
      return { text: 'Thinking', color: 'bg-[#22c55e]' }
    case 'waitingForApproval':
      return { text: '需要授权', color: 'bg-[#f59e0b]' }
    case 'error':
      return { text: '', color: 'bg-[#ef4444]' }
    case 'compacting':
      return { text: 'Compacting', color: 'bg-[#8b5cf6]' }
    case 'ended':
      return { text: '已结束', color: 'bg-[#737373]' }
    default:
      return { text: currentTool || '', color: 'bg-[#737373]' }
  }
}