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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Sort messages by timestamp
  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp)

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-white/10">
        <button onClick={onClose} className="text-white/70 mr-3">
          ←
        </button>
        <span className="text-white text-lg font-medium truncate flex-1">
          {projectName}
        </span>
        <span className="text-white/40 text-xs">
          {sortedMessages.length} 条消息
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2">
        {sortedMessages.length === 0 ? (
          <div className="text-white/30 text-sm text-center py-8">
            暂无聊天记录
          </div>
        ) : (
          sortedMessages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))
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
            <span className="text-blue-400 text-xs font-medium">你</span>
            <span className="text-white/30 text-xs">{time}</span>
          </div>
          <div className="text-white/90 text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      )

    case 'assistant':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-400 text-xs font-medium">Claude</span>
            <span className="text-white/30 text-xs">{time}</span>
          </div>
          <div className="text-white/90 text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      )

    case 'toolCall':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-400 text-xs font-medium">
              工具: {message.toolName || '未知'}
            </span>
            <span className="text-white/30 text-xs">{time}</span>
          </div>
          <div className="text-white/70 text-xs bg-white/5 rounded px-2 py-1 font-mono truncate">
            {message.content.slice(0, 200)}
            {message.content.length > 200 && '...'}
          </div>
        </div>
      )

    case 'toolResult':
      return (
        <div className="mb-3 pl-4 border-l-2 border-white/10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-purple-400 text-xs font-medium">结果</span>
            <span className="text-white/30 text-xs">{time}</span>
          </div>
          <div className="text-white/60 text-xs font-mono whitespace-pre-wrap break-words">
            {message.content.slice(0, 500)}
            {message.content.length > 500 && '...'}
          </div>
        </div>
      )

    case 'thinking':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cyan-400 text-xs font-medium">思考中</span>
            <span className="text-white/30 text-xs">{time}</span>
          </div>
          <div className="text-white/50 text-xs italic">
            {message.content.slice(0, 100)}
            {message.content.length > 100 && '...'}
          </div>
        </div>
      )

    case 'interrupted':
      return (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-red-400 text-xs font-medium">已中断</span>
            <span className="text-white/30 text-xs">{time}</span>
          </div>
          <div className="text-white/50 text-xs italic">
            会话被中断
          </div>
        </div>
      )

    default:
      return null
  }
}