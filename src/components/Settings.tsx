import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { HooksCheckResult, AppSettings } from '../types';

// Hooks 中文描述映射
const HOOK_DESCRIPTIONS: Record<string, string> = {
  SessionStart: '会话开始',
  SessionEnd: '会话结束',
  PreToolUse: '工具执行前',
  PostToolUse: '工具执行后',
  PermissionRequest: '权限请求',
  Notification: '通知/询问',
  UserPromptSubmit: '用户输入提交',
  Stop: '生成停止',
  PostToolUseFailure: '工具失败后',
  PreCompact: '压缩前',
  PostCompact: '压缩后',
  SubagentStart: '子代理启动',
  SubagentStop: '子代理停止',
};

// 获取 hook 显示名称
const getHookDisplayName = (name: string): string => {
  const desc = HOOK_DESCRIPTIONS[name];
  return desc ? `${name}（${desc}）` : name;
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange?: () => void;
}

export function SettingsModal({ isOpen, onClose, onSettingsChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'hooks' | 'general'>('hooks');
  const [hooksResult, setHooksResult] = useState<HooksCheckResult | null>(null);
  const [selectedHooks, setSelectedHooks] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string>('');
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrCodeSvg, setQRCodeSvg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setActiveTab('hooks');
      loadHooksStatus();
      loadSettings();
    }
  }, [isOpen]);

  useEffect(() => {
    if (settings?.cloud_mode) {
      invoke<string>('get_device_token').then(setDeviceToken).catch(() => setDeviceToken(''));
    }
  }, [settings?.cloud_mode]);

  const generateQRCode = async () => {
    try {
      const serverUrl = settings?.cloud_server_url || '';
      const svg = await invoke<string>('generate_device_qrcode', { serverUrl });
      setQRCodeSvg(svg);
      setShowQRModal(true);
    } catch (e) {
      console.error('Failed to generate QR code:', e);
    }
  };

  const loadHooksStatus = async () => {
    try {
      const result = await invoke<HooksCheckResult>('check_claude_hooks');
      setHooksResult(result);
      const selected = new Set<string>();
      result.hooks.forEach(h => {
        if (h.required || h.configured) {
          selected.add(h.name);
        }
      });
      setSelectedHooks(selected);
    } catch (e) {
      console.error('Failed to check hooks:', e);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await invoke<AppSettings>('get_settings');
      setSettings(s);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const toggleHook = (name: string) => {
    const newSelected = new Set(selectedHooks);
    if (newSelected.has(name)) {
      const hook = hooksResult?.hooks.find(h => h.name === name);
      if (hook?.required) return;
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedHooks(newSelected);
  };

  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      // Save hooks
      await invoke('update_claude_hooks', { hooks: Array.from(selectedHooks) });
      // Save settings
      if (settings) {
        await invoke('update_settings', { settings });
      }
      onSettingsChange?.();
      setMessage({ text: '保存成功', type: 'success' });
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage({ text: `保存失败: ${e}`, type: 'error' });
    }
    setSaving(false);
  };

  if (!isOpen || !settings || !hooksResult) return null;

  const requiredCount = hooksResult.hooks.filter(h => h.required).length;
  const configuredCount = hooksResult.hooks.filter(h => h.configured).length;

  return (
    <div className="flex flex-col h-[360px] bg-black w-full rounded-b-xl">
      {/* Top Navigation Bar with Save Button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex items-center justify-center w-8 h-8 text-white/50 hover:text-white/80 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
            </svg>
          </button>
          <span className="ml-2 text-sm font-medium text-white/80">设置</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            saveAll();
          }}
          disabled={saving}
          className="px-3 py-1.5 bg-white hover:bg-white/90 disabled:bg-white/50 text-black rounded-lg transition-colors text-xs font-medium"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setActiveTab('hooks')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'hooks'
              ? 'text-white border-b-2 border-white'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          Hooks 配置 ({configuredCount}/{requiredCount})
        </button>
        <button
          onClick={() => setActiveTab('general')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === 'general'
              ? 'text-white border-b-2 border-white'
              : 'text-white/50 hover:text-white/70'
          }`}
        >
          通用设置
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin">
        <AnimatePresence mode="wait">
          {activeTab === 'hooks' ? (
            <motion.div
              key="hooks"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
            >
              {hooksResult.missing_required.length > 0 && (
                <div className="text-orange-400 text-xs mb-3 p-2 bg-orange-500/10 rounded">
                  ⚠️ 缺少必要的 Hooks: {hooksResult.missing_required.join(', ')}
                </div>
              )}

              {/* Required hooks - collapsible */}
              <div className="mb-3">
                <button
                  onClick={() => setShowRequired(!showRequired)}
                  className="w-full flex items-center justify-between p-2 rounded bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white/60 text-xs">必须的 Hooks</span>
                    <span className="text-white/40 text-xs">({requiredCount})</span>
                  </div>
                  <motion.span
                    animate={{ rotate: showRequired ? 180 : 0 }}
                    className="text-white/40 text-xs"
                  >
                    ▼
                  </motion.span>
                </button>
                <AnimatePresence>
                  {showRequired && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 space-y-1 pl-2">
                        {hooksResult.hooks.filter(h => h.required).map(hook => (
                          <div
                            key={hook.name}
                            className="flex items-center justify-between py-1 px-2 text-sm"
                          >
                            <span className="text-white/60">{getHookDisplayName(hook.name)}</span>
                            <span className="text-white/40 text-xs">{hook.timeout}s</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="text-white/60 text-xs mb-2">可选 Hooks:</div>
              {hooksResult.hooks.filter(h => !h.required).map(hook => (
                <label
                  key={hook.name}
                  className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors mb-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedHooks.has(hook.name)}
                    onChange={() => toggleHook(hook.name)}
                    className="w-4 h-4 rounded accent-white"
                  />
                  <span className="text-white/80 text-sm flex-1">{getHookDisplayName(hook.name)}</span>
                  <span className="text-white/40 text-xs">{hook.timeout}s</span>
                </label>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="general"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="space-y-3"
            >
              {/* Toggle Options */}
              <div className="space-y-1">
                <label className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.auto_allow_permissions}
                    onChange={e => setSettings({ ...settings, auto_allow_permissions: e.target.checked })}
                    className="w-4 h-4 rounded accent-white"
                  />
                  <div className="flex-1">
                    <span className="text-white/80 text-sm">自动允许所有权限</span>
                    <span className="text-white/40 text-xs ml-2">(跳过权限确认)</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.auto_deny_on_timeout}
                    onChange={e => setSettings({ ...settings, auto_deny_on_timeout: e.target.checked })}
                    className="w-4 h-4 rounded accent-white"
                  />
                  <span className="text-white/80 text-sm flex-1">超时时自动拒绝</span>
                </label>

                <label className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.show_notifications}
                    onChange={e => setSettings({ ...settings, show_notifications: e.target.checked })}
                    className="w-4 h-4 rounded accent-white"
                  />
                  <span className="text-white/80 text-sm flex-1">显示状态通知</span>
                </label>

                <label className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.enable_logging}
                    onChange={e => setSettings({ ...settings, enable_logging: e.target.checked })}
                    className="w-4 h-4 rounded accent-white"
                  />
                  <div className="flex-1">
                    <span className="text-white/80 text-sm">启用日志记录</span>
                    <span className="text-white/40 text-xs block">~/.cc-island/cc-island.log</span>
                  </div>
                </label>
              </div>

              {/* Numeric Inputs */}
              <div className="space-y-3 border-t border-white/10 pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-white/60 text-xs block mb-1">最大实例数</label>
                    <input
                      type="number"
                      value={settings.max_instances}
                      onChange={e => setSettings({ ...settings, max_instances: parseInt(e.target.value) || 10 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs block mb-1">弹窗队列</label>
                    <input
                      type="number"
                      value={settings.max_popup_queue}
                      onChange={e => setSettings({ ...settings, max_popup_queue: parseInt(e.target.value) || 5 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-white/60 text-xs block mb-1">权限超时(秒)</label>
                    <input
                      type="number"
                      value={settings.permission_timeout}
                      onChange={e => setSettings({ ...settings, permission_timeout: parseInt(e.target.value) || 300 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs block mb-1">Ask超时(秒)</label>
                    <input
                      type="number"
                      value={settings.ask_timeout}
                      onChange={e => setSettings({ ...settings, ask_timeout: parseInt(e.target.value) || 120 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-white/60 text-xs block mb-1">警告时间(秒)</label>
                    <input
                      type="number"
                      value={settings.warning_time}
                      onChange={e => setSettings({ ...settings, warning_time: parseInt(e.target.value) || 30 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs block mb-1">紧急时间(秒)</label>
                    <input
                      type="number"
                      value={settings.critical_time}
                      onChange={e => setSettings({ ...settings, critical_time: parseInt(e.target.value) || 10 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-white/60 text-xs block mb-1">刷新间隔(ms)</label>
                    <input
                      type="number"
                      value={settings.poll_interval}
                      onChange={e => setSettings({ ...settings, poll_interval: parseInt(e.target.value) || 500 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs block mb-1">通知关闭(ms)</label>
                    <input
                      type="number"
                      value={settings.notification_auto_close}
                      onChange={e => setSettings({ ...settings, notification_auto_close: parseInt(e.target.value) || 5000 })}
                      className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-white/60 text-xs block mb-1">Hook转发地址</label>
                  <input
                    type="text"
                    placeholder="http://localhost:8080/hook"
                    value={settings.hook_forward_url || ''}
                    onChange={e => setSettings({ ...settings, hook_forward_url: e.target.value || null })}
                    className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30 placeholder-white/30"
                  />
                </div>

                {/* WebSocket Remote Access */}
                <div className="border-t border-white/10 pt-3 mt-3">
                  <div className="text-white/80 text-sm mb-2">手机远程访问</div>
                  <label className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.websocket_enabled || false}
                      onChange={e => setSettings({ ...settings, websocket_enabled: e.target.checked })}
                      className="w-4 h-4 rounded accent-white"
                    />
                    <div className="flex-1">
                      <span className="text-white/80 text-sm">启用 WebSocket</span>
                      <span className="text-white/40 text-xs ml-2">(手机远程控制)</span>
                    </div>
                  </label>

                  {settings.websocket_enabled && (
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="text-white/60 text-xs block mb-1">WebSocket 端口</label>
                        <input
                          type="number"
                          value={settings.websocket_port || 17528}
                          onChange={e => setSettings({ ...settings, websocket_port: parseInt(e.target.value) || 17528 })}
                          className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30"
                        />
                      </div>
                      <div>
                        <label className="text-white/60 text-xs block mb-1">连接密码</label>
                        <input
                          type="password"
                          placeholder="设置密码以保护连接"
                          value={settings.websocket_password || ''}
                          onChange={e => setSettings({ ...settings, websocket_password: e.target.value || null })}
                          className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30 placeholder-white/30"
                        />
                      </div>
                      <div className="text-white/40 text-xs">
                        手机连接地址: ws://本机IP:{settings.websocket_port || 17528}
                      </div>
                    </div>
                  )}
                </div>

                {/* Cloud Relay Configuration */}
                <div className="border-t border-white/10 pt-3 mt-3">
                  <div className="text-white/80 text-sm mb-2">云转发配置</div>

                  <label className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.cloud_mode || false}
                      onChange={e => setSettings({ ...settings, cloud_mode: e.target.checked })}
                      className="w-4 h-4 rounded accent-white"
                    />
                    <div className="flex-1">
                      <span className="text-white/80 text-sm">启用云转发</span>
                      <span className="text-white/40 text-xs ml-2">(公网访问)</span>
                    </div>
                  </label>

                  {settings.cloud_mode && (
                    <div className="mt-2 space-y-2">
                      <div>
                        <label className="text-white/60 text-xs block mb-1">云服务器地址</label>
                        <input
                          type="text"
                          placeholder="wss://cloud.example.com:17528"
                          value={settings.cloud_server_url || ''}
                          onChange={e => setSettings({ ...settings, cloud_server_url: e.target.value || null })}
                          className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30 placeholder-white/30"
                        />
                      </div>

                      <div>
                        <label className="text-white/60 text-xs block mb-1">设备名称 (可选)</label>
                        <input
                          type="text"
                          placeholder="我的电脑"
                          value={settings.device_name || ''}
                          onChange={e => setSettings({ ...settings, device_name: e.target.value || null })}
                          className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-white/30 placeholder-white/30"
                        />
                      </div>

                      <div className="bg-white/[0.08] rounded p-2 mt-2">
                        <div className="text-white/50 text-xs">设备 Token:</div>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-white/70 text-xs bg-black/30 px-1 rounded flex-1 truncate">
                            {deviceToken || '加载中...'}
                          </code>
                          <button
                            onClick={() => deviceToken && navigator.clipboard.writeText(deviceToken)}
                            className="text-white/50 hover:text-white px-2 py-1 text-xs"
                            disabled={!deviceToken}
                          >
                            复制
                          </button>
                          <button
                            onClick={generateQRCode}
                            className="text-white/50 hover:text-white px-2 py-1 text-xs"
                          >
                            二维码
                          </button>
                        </div>
                      </div>

                      <div className="text-white/40 text-xs">
                        将此Token输入到手机App即可连接此设备
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Message */}
        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-3 p-2 rounded text-sm text-center ${
                message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* QR Code Modal */}
      <AnimatePresence>
        {showQRModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/80"
            onClick={() => setShowQRModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-black/90 rounded-lg p-4 max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-white text-sm mb-2">扫描二维码连接设备</div>
              <div className="bg-white p-4 rounded-lg">
                <img
                  src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(qrCodeSvg)))}`}
                  alt="QR Code"
                  className="w-[200px] h-[200px]"
                />
              </div>
              <button
                onClick={() => setShowQRModal(false)}
                className="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 text-white/70 rounded-lg text-sm"
              >
                关闭
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Initial setup modal shown on first launch
interface HooksSetupModalProps {
  result: HooksCheckResult;
  onComplete: () => void;
}

export function HooksSetupModal({ result, onComplete }: HooksSetupModalProps) {
  const [selectedHooks, setSelectedHooks] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [showRequired, setShowRequired] = useState(false);

  useEffect(() => {
    const selected = new Set<string>();
    result.hooks.forEach(h => {
      if (h.required) {
        selected.add(h.name);
      }
    });
    ['Stop', 'PostToolUseFailure'].forEach(name => {
      if (result.hooks.find(h => h.name === name)) {
        selected.add(name);
      }
    });
    setSelectedHooks(selected);
  }, [result]);

  const toggleHook = (name: string) => {
    const newSelected = new Set(selectedHooks);
    if (newSelected.has(name)) {
      const hook = result.hooks.find(h => h.name === name);
      if (hook?.required) return;
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedHooks(newSelected);
  };

  const saveAndContinue = async () => {
    setSaving(true);
    try {
      await invoke('update_claude_hooks', { hooks: Array.from(selectedHooks) });
      onComplete();
    } catch (e) {
      console.error('Failed to save hooks:', e);
    }
    setSaving(false);
  };

  const skipSetup = () => {
    onComplete();
  };

  const requiredHooks = result.hooks.filter(h => h.required);
  const optionalHooks = result.hooks.filter(h => !h.required);

  return (
    <div className="flex flex-col h-[360px] bg-black w-full rounded-b-xl">
      {/* Top Navigation Bar */}
      <div className="flex items-center px-3 py-2 border-b border-white/10">
        <span className="text-sm font-medium text-white/80">配置 Claude Code Hooks</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <p className="text-white/70 text-sm mb-4">
          CC-Island 需要配置 Claude Code 的 Hooks 才能正常工作。
        </p>

        {/* Required hooks */}
        <div className="mb-3">
          <button
            onClick={() => setShowRequired(!showRequired)}
            className="w-full flex items-center justify-between p-2 rounded bg-orange-500/10 hover:bg-orange-500/15 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-orange-400 text-sm font-medium">必须的 Hooks ({requiredHooks.length})</span>
              <span className="text-orange-300/50 text-xs">已自动选中</span>
            </div>
            <motion.span
              animate={{ rotate: showRequired ? 180 : 0 }}
              className="text-orange-400/50 text-xs"
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {showRequired && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1 pl-2">
                  {requiredHooks.map(hook => (
                    <div key={hook.name} className="flex items-center justify-between py-1.5 px-2 text-sm">
                      <span className="text-white/60">{getHookDisplayName(hook.name)}</span>
                      <span className="text-white/40 text-xs">{hook.timeout}s</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Optional hooks */}
        <div className="text-white/50 text-xs mb-2">可选 Hooks：</div>
        <div className="space-y-1 max-h-[140px] overflow-y-auto">
          {optionalHooks.map(hook => (
            <label
              key={hook.name}
              className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedHooks.has(hook.name)}
                onChange={() => toggleHook(hook.name)}
                className="w-4 h-4 rounded accent-white"
              />
              <span className="text-white/80 text-sm flex-1">{getHookDisplayName(hook.name)}</span>
              <span className="text-white/40 text-xs">{hook.timeout}s</span>
            </label>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={skipSetup}
            className="flex-1 py-2 bg-white/10 hover:bg-white/15 text-white/70 rounded-lg transition-colors text-sm"
          >
            稍后配置
          </button>
          <button
            onClick={saveAndContinue}
            disabled={saving}
            className="flex-1 py-2 bg-white hover:bg-white/90 disabled:bg-white/50 text-black rounded-lg transition-colors text-sm font-medium"
          >
            {saving ? '保存中...' : '保存并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}
