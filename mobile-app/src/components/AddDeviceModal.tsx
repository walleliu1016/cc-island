// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react'

interface AddDeviceModalProps {
  onClose: () => void
  onAdd: (token: string) => void
}

export function AddDeviceModal({ onClose, onAdd }: AddDeviceModalProps) {
  const [token, setToken] = useState('')

  const handleSubmit = () => {
    if (token.trim()) {
      onAdd(token.trim())
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-[#0f0f0f]/80 flex items-center justify-center z-50">
      <div className="bg-white rounded-[12px] w-[90%] max-w-sm shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5]">
          <span className="text-[#1a1a1a] text-lg font-medium">添加设备</span>
          <button onClick={onClose} className="text-[#737373] text-lg">×</button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="text-[#737373] text-xs mb-1">设备 Token</div>
          <input
            type="text"
            placeholder="粘贴从桌面端复制的 Token"
            value={token}
            onChange={e => setToken(e.target.value)}
            className="w-full px-3 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-[8px] text-[#1a1a1a] text-sm outline-none focus:border-[#22c55e]"
          />

          <div className="text-[#737373] text-xs mt-3 mb-4">
            在桌面端设置中查看设备 Token，或扫描二维码自动填入
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-[#f5f5f5] rounded-[8px] text-[#737373] text-sm"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!token.trim()}
              className="flex-1 py-2 bg-[#22c55e] rounded-[8px] text-white text-sm font-medium disabled:bg-[#e5e5e5] disabled:text-[#737373]"
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}