// mobile-app/src/components/ChatView.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react'
import { ChatMessageData } from '../types'

interface ChatViewProps {
  projectName: string
  onClose: () => void
  messages: ChatMessageData[]
}

export function ChatView({ projectName, onClose, messages }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp)

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[#262626]">
        <button onClick={onClose} className="text-[#a3a3a3] mr-3 text-lg">←</button>
        <span className="text-[#f5f5f5] text-lg font-medium truncate flex-1">{projectName}</span>
        <span className="text-[#737373] text-xs">{sortedMessages.length} 条消息</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {sortedMessages.length === 0 ? (
          <div className="text-[#737373] text-sm text-center py-8">暂无聊天记录</div>
        ) : (
          sortedMessages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessageData }) {
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  switch (message.messageType) {
    case 'user':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#3b82f6] text-xs font-medium">你</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#f5f5f5] text-sm">{message.content}</div>
        </div>
      )

    case 'assistant':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#22c55e] text-xs font-medium">Claude</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#f5f5f5] text-sm">{message.content}</div>
        </div>
      )

    case 'toolCall':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#f59e0b] text-xs font-medium">工具: {message.toolName || '未知'}</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#a3a3a3] text-xs bg-[#1a1a1a] rounded-[8px] px-2 py-1 truncate">
            {message.content.slice(0, 200)}{message.content.length > 200 && '...'}
          </div>
        </div>
      )

    case 'toolResult':
      return (
        <div className="mb-3 pl-4 border-l-2 border-[#262626]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#a855f7] text-xs font-medium">结果</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#a3a3a3] text-xs truncate">
            {message.content.slice(0, 500)}{message.content.length > 500 && '...'}
          </div>
        </div>
      )

    case 'thinking':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#06b6d4] text-xs font-medium">思考中</span>
            <span className="text-[#737373] text-xs">{time}</span>
          </div>
          <div className="text-[#737373] text-xs italic">
            {message.content.slice(0, 100)}{message.content.length > 100 && '...'}
          </div>
        </div>
      )

    default:
      return null
  }
}