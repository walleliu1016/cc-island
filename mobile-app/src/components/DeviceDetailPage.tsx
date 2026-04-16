// mobile-app/src/components/DeviceDetailPage.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useCloudWebSocket } from '../hooks/useCloudWebSocket'
import { SessionState } from '../types'
import { ChatView } from './ChatView'
import { PopupCard } from './PopupCard'

interface DeviceDetailPageProps {
  deviceToken: string
  deviceName: string
  serverUrl: string
  onBack: () => void
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void
}

export function DeviceDetailPage({ deviceToken, deviceName, serverUrl, onBack, showToast }: DeviceDetailPageProps) {
  const { state, respondPopup, requestChatHistory } = useCloudWebSocket({ deviceToken, serverUrl })
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

  const pendingPopups = state.popups.filter(p => p.status === 'pending' && !dismissingPopups.includes(p.id))
  const activeSessions = state.sessions.filter(s => s.status !== 'ended')

  const handleViewChat = (sessionId: string, projectName: string) => {
    requestChatHistory(sessionId)
    setChatSession({ sessionId, projectName })
  }

  const handleRespond = (popupId: string, decision?: string | null, answers?: string[][]) => {
    // Start dismiss animation
    setDismissingPopups(prev => [...prev, popupId])

    // Show toast
    if (decision === 'allow') {
      showToast('已允许', 'success')
    } else if (decision === 'deny') {
      showToast('已拒绝', 'error')
    } else {
      showToast('已提交', 'success')
    }

    // Actually respond after animation starts
    dismissTimeoutRef.current = window.setTimeout(() => {
      respondPopup(popupId, decision ?? null, answers)
      setDismissingPopups(prev => prev.filter(id => id !== popupId))
    }, 200)
  }

  // If viewing chat, show ChatView
  if (chatSession) {
    return (
      <ChatView
        projectName={chatSession.projectName}
        onClose={() => setChatSession(null)}
        messages={state.chatMessages[chatSession.sessionId] || []}
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
          <div className={`w-2 h-2 rounded-full ${state.status === 'connected' ? 'bg-[#22c55e]' : 'bg-[#737373]'}`} />
          <span className={`text-xs ${state.status === 'connected' ? 'text-[#22c55e]' : 'text-[#737373]'}`}>
            {state.status === 'connected' ? '在线' : '离线'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sessions Section */}
        <div className="px-4 py-3">
          <div className="text-[#a3a3a3] text-xs mb-2">会话列表</div>
          {activeSessions.length === 0 ? (
            <div className="text-[#737373] text-sm py-4">暂无活跃会话</div>
          ) : (
            <div className="space-y-2">
              {activeSessions.map(session => (
                <SessionCard
                  key={session.session_id}
                  session={session}
                  onViewChat={() => handleViewChat(session.session_id, session.project_name || '未知项目')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        {pendingPopups.length > 0 && (
          <div className="px-4 py-2 border-t border-[#262626]">
            <div className="text-[#a3a3a3] text-xs">
              待处理 ({pendingPopups.length})
            </div>
          </div>
        )}

        {/* Popups Section */}
        <div className="px-4 py-3 space-y-3">
          <AnimatePresence>
            {pendingPopups.map(popup => (
              <PopupCard
                key={popup.id}
                popup={popup}
                onRespond={handleRespond}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function SessionCard({ session, onViewChat }: { session: SessionState; onViewChat: () => void }) {
  return (
    <div className="p-3 rounded-[8px] bg-[#1a1a1a] border border-[#262626]">
      <div className="text-[#f5f5f5] text-sm font-medium">{session.project_name || '未知项目'}</div>
      <div className="text-[#a3a3a3] text-xs mt-1">
        {session.current_tool ? `工具: ${session.current_tool}` : session.status}
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