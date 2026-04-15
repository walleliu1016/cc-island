import { useState } from 'react'

interface SettingsModalProps {
  initialUrl: string
  initialPassword: string
  onSave: (url: string, password: string) => void
  onClose: () => void
}

export function SettingsModal({ initialUrl, initialPassword, onSave, onClose }: SettingsModalProps) {
  const [url, setUrl] = useState(initialUrl)
  const [password, setPassword] = useState(initialPassword)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(url.trim(), password.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-nexus-bg2 border border-nexus-border rounded-xl p-4 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-nexus-text text-lg font-semibold">配置连接</h2>
          <button onClick={onClose} className="text-nexus-text2 hover:text-nexus-text">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="text-nexus-text2 text-xs mb-1 block">
              CC-Island WebSocket URL
            </label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="ws://192.168.1.100:17528"
              className="w-full bg-nexus-bg border border-nexus-border rounded-lg text-nexus-text px-3 py-2 text-sm outline-none focus:border-nexus-accent"
            />
            <div className="text-nexus-text2 text-xs mt-1">
              格式: ws://IP:端口 或 wss://域名:端口
            </div>
          </div>

          <div>
            <label className="text-nexus-text2 text-xs mb-1 block">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="WebSocket 密码"
              className="w-full bg-nexus-bg border border-nexus-border rounded-lg text-nexus-text px-3 py-2 text-sm outline-none focus:border-nexus-accent"
            />
          </div>

          <div className="text-nexus-text2 text-xs">
            <p className="mb-1">使用说明：</p>
            <ul className="list-disc list-inside">
              <li>在电脑上启用 CC-Island WebSocket（设置中开启）</li>
              <li>确保手机和电脑在同一网络或有公网访问</li>
              <li>输入电脑 IP 地址和配置的端口（默认 17528）</li>
            </ul>
          </div>

          <button
            type="submit"
            className="w-full bg-nexus-accent text-white rounded-lg py-2 text-sm font-medium"
          >
            保存并连接
          </button>
        </form>
      </div>
    </div>
  )
}