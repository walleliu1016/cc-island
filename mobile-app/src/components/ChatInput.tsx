// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import React, { useState } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled = false }) => {
  const [text, setText] = useState('')

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSend(text.trim())
      setText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-center gap-2 p-2 border-t border-gray-200 bg-white">
      <input
        type="text"
        className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:outline-none"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        disabled={disabled}
      />
      <button
        className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:bg-gray-300 disabled:text-gray-500"
        onClick={handleSend}
        disabled={!text.trim() || disabled}
      >
        发送
      </button>
    </div>
  )
}