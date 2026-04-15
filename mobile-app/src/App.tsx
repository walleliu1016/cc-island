import { useState, useEffect, useCallback } from 'react'
import { InstanceList } from './components/InstanceList'
import { PopupCard } from './components/PopupCard'
import { useWebSocket } from './hooks/useWebSocket'
import { WsMessage, ClaudeInstance, PopupItem } from './types'
import { SettingsModal } from './components/SettingsModal'

function App() {
  const [instances, setInstances] = useState<ClaudeInstance[]>([])
  const [popups, setPopups] = useState<PopupItem[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [serverUrl, setServerUrl] = useState<string>(() =>
    localStorage.getItem('cc-island-url') || ''
  )
  const [password, setPassword] = useState<string>(() =>
    localStorage.getItem('cc-island-password') || ''
  )
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const pendingPopups = popups.filter(p => p.status === 'pending')
  const activeInstances = instances.filter(i => i.status.type !== 'ended')

  const handleMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'state_update':
        setInstances(msg.instances || [])
        setPopups(msg.popups || [])
        break
      case 'new_popup':
        if (msg.popup) {
          setPopups(prev => [...prev, msg.popup!])
          // Show browser notification if permitted
          if ('Notification' in window && Notification.permission === 'granted') {
            const toolName = msg.popup.permission_data?.tool_name || 'AskUserQuestion'
            new Notification(`${msg.popup.project_name} 需要授权`, {
              body: `工具: ${toolName}`,
              tag: msg.popup.id,
            })
          }
        }
        break
      case 'session_notification':
        if ('Notification' in window && Notification.permission === 'granted' && msg.notification) {
          const text = msg.notification.notification_type === 'started'
            ? `${msg.notification.project_name} 已启动`
            : `${msg.notification.project_name} 已停止`
          new Notification(text, { tag: 'session-' + msg.notification.timestamp })
        }
        break
    }
  }, [])

  const { connect, disconnect, send, status } = useWebSocket(handleMessage)

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  // Auto-connect when URL is set
  useEffect(() => {
    if (serverUrl && password) {
      const wsUrl = serverUrl.replace(/^http/, 'ws')
      connect(wsUrl, password)
    }
  }, [serverUrl, password, connect])

  // Update connection status
  useEffect(() => {
    setIsConnected(status === 'connected')
    setConnectionError(status === 'error' ? '连接失败' : null)
  }, [status])

  const handleRespondPopup = useCallback((popupId: string, decision?: string, answers?: string[][]) => {
    send({
      type: 'respond_popup',
      popup_id: popupId,
      decision,
      answers,
    })
  }, [send])

  const handleSaveSettings = useCallback((url: string, pwd: string) => {
    localStorage.setItem('cc-island-url', url)
    localStorage.setItem('cc-island-password', pwd)
    setServerUrl(url)
    setPassword(pwd)
    setShowSettings(false)
    // Reconnect with new settings
    disconnect()
  }, [disconnect])

  // Show settings on first load if no URL configured
  useEffect(() => {
    if (!serverUrl) {
      setShowSettings(true)
    }
  }, [serverUrl])

  return (
    <div className="flex flex-col w-full h-full bg-nexus-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nexus-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-nexus-success' : 'bg-nexus-error'}`} />
          <span className="text-nexus-text text-sm font-medium">
            CC-Island Remote
          </span>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="text-nexus-text2 hover:text-nexus-text transition-colors p-1"
        >
          ⚙️
        </button>
      </div>

      {/* Connection Error */}
      {connectionError && !showSettings && (
        <div className="px-4 py-2 bg-nexus-error/20 text-nexus-error text-sm text-center">
          {connectionError} - 点击 ⚙️ 检查配置
        </div>
      )}

      {/* Pending Popups (Priority) */}
      {pendingPopups.length > 0 && (
        <div className="px-4 py-2">
          <div className="text-nexus-warning text-xs font-medium mb-2">
            需要授权 ({pendingPopups.length})
          </div>
          <div className="flex flex-col gap-2">
            {pendingPopups.map(popup => (
              <PopupCard
                key={popup.id}
                popup={popup}
                onRespond={handleRespondPopup}
              />
            ))}
          </div>
        </div>
      )}

      {/* Instance List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {activeInstances.length > 0 ? (
          <InstanceList instances={activeInstances} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-nexus-text2">
            {!isConnected ? (
              <div className="text-center">
                <div className="text-4xl mb-3">🔌</div>
                <div className="text-sm">未连接到 CC-Island</div>
                <button
                  onClick={() => setShowSettings(true)}
                  className="mt-3 px-4 py-2 bg-nexus-accent text-white rounded-lg text-sm"
                >
                  配置连接
                </button>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-4xl mb-3">💤</div>
                <div className="text-sm">没有活动的 Claude 实例</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          initialUrl={serverUrl}
          initialPassword={password}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default App