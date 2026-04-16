// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react'

interface SettingsModalProps {
  initialServerUrl: string
  onSave: (serverUrl: string) => void
  onClose: () => void
}

export function SettingsModal({ initialServerUrl, onSave, onClose }: SettingsModalProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const url = serverUrl.trim()
    if (!url) {
      setError('请输入云服务器地址')
      return
    }

    // Validate URL format
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      setError('地址必须以 ws:// 或 wss:// 开头')
      return
    }

    onSave(url)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-nexus-bg2 border border-nexus-border rounded-xl p-4 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-nexus-text text-lg font-semibold">配置云服务器</h2>
          <button onClick={onClose} className="text-nexus-text2 hover:text-nexus-text">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="text-nexus-text2 text-xs mb-1 block">
              云服务器地址
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
              placeholder="wss://cloud.example.com:17528"
              className="w-full bg-nexus-bg border border-nexus-border rounded-lg text-nexus-text px-3 py-2 text-sm outline-none focus:border-nexus-accent"
            />
            <div className="text-nexus-text2 text-xs mt-1">
              格式: wss://域名:端口 或 ws://IP:端口
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-xs bg-red-500/10 rounded px-2 py-1">
              {error}
            </div>
          )}

          <div className="text-nexus-text2 text-xs">
            <p className="mb-1">使用说明：</p>
            <ul className="list-disc list-inside">
              <li>在电脑端 CC-Island 设置中启用远程访问</li>
              <li>配置相同的云服务器地址</li>
              <li>添加设备时输入电脑显示的 Token</li>
            </ul>
          </div>

          <button
            type="submit"
            className="w-full bg-nexus-accent text-white rounded-lg py-2 text-sm font-medium"
          >
            保存
          </button>
        </form>
      </div>
    </div>
  )
}