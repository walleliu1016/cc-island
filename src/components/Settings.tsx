// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { HooksCheckResult, AppSettings } from '../types';
import { useAppStore } from '../stores/appStore';
import { THEME_LABELS, ThemeId, getTheme } from '../theme';

type CloudConnectionStatus =
  | { type: 'Disconnected' }
  | { type: 'Connecting' }
  | { type: 'Connected' }
  | { type: 'Failed'; message: string };

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

const getHookDisplayName = (name: string): string => {
  const desc = HOOK_DESCRIPTIONS[name];
  return desc ? `${name}（${desc}）` : name;
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange?: () => void;
  className?: string;
  hideHeader?: boolean;
}

export function SettingsModal({ isOpen, onClose, onSettingsChange, className, hideHeader }: SettingsModalProps) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const [activeTab, setActiveTab] = useState<'hooks' | 'general' | 'remote'>('hooks');
  const [hooksResult, setHooksResult] = useState<HooksCheckResult | null>(null);
  const [selectedHooks, setSelectedHooks] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string>('');
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrCodeSvg, setQRCodeSvg] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<CloudConnectionStatus>({ type: 'Disconnected' });
  const pollingRef = useRef<number | null>(null);

  const pollConnectionStatus = async () => {
    if (settings?.cloud_mode) {
      try {
        const status = await invoke<CloudConnectionStatus>('get_cloud_connection_status');
        setConnectionStatus(status);
      } catch (e) {
        console.error('Failed to get connection status:', e);
      }
    }
  };

  useEffect(() => {
    if (isOpen && settings?.cloud_mode) {
      pollConnectionStatus();
      pollingRef.current = window.setInterval(pollConnectionStatus, 2000);
    } else {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isOpen, settings?.cloud_mode]);

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
      useAppStore.getState().setTheme(s.theme || 'dark');
      invoke('set_app_theme', { theme: s.theme || 'dark' }).catch(console.error);
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
    if (settings?.cloud_mode && !settings.cloud_server_url) {
      setMessage({ text: '请配置云服务器地址', type: 'error' });
      setSaving(false);
      return;
    }
    if (settings?.cloud_mode && settings.cloud_server_url) {
      const url = settings.cloud_server_url;
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        setMessage({ text: '云服务器地址必须以 ws:// 或 wss:// 开头', type: 'error' });
        setSaving(false);
        return;
      }
    }
    try {
      await invoke('update_claude_hooks', { hooks: Array.from(selectedHooks) });
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

  if (!isOpen) return null;

  const isLoading = !settings || !hooksResult;
  const requiredCount = hooksResult?.hooks.filter(h => h.required).length ?? 0;
  const configuredCount = hooksResult?.hooks.filter(h => h.configured).length ?? 0;

  // Shared style helpers
  const cardStyle: React.CSSProperties = { background: colors.bgCard, borderColor: colors.borderLight };
  const cardHoverStyle: React.CSSProperties = { background: colors.bgCardHover, borderColor: colors.borderLight };
  const inputStyle: React.CSSProperties = { background: colors.bgInput, borderColor: colors.borderMedium, color: colors.textPrimary };

  return (
    <div className={`flex flex-col ${className || 'h-full'} w-full rounded-b-xl`} style={{ background: colors.bgMain }}>
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3" style={{ color: colors.textMuted }}>
            <svg className="animate-spin w-6 h-6" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
            <span className="text-xs">加载设置中...</span>
          </div>
        </div>
      ) : (
      <>
      {!hideHeader && (
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
        <div className="flex items-center">
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="flex items-center justify-center w-8 h-8 transition-colors"
            style={{ color: colors.textMuted }}
            onMouseEnter={e => (e.currentTarget.style.color = colors.textPrimary)}
            onMouseLeave={e => (e.currentTarget.style.color = colors.textMuted)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
            </svg>
          </button>
          <span className="ml-2 text-sm font-medium" style={{ color: colors.textPrimary }}>设置</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); saveAll(); }}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg transition-opacity text-xs font-medium disabled:opacity-50"
          style={{ background: colors.accentGradient, color: '#ffffff' }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      )}

      <div className="flex" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
        <button
          onClick={() => setActiveTab('hooks')}
          className="flex-1 py-2 text-xs font-medium transition-colors"
          style={{
            color: activeTab === 'hooks' ? colors.textPrimary : colors.textMuted,
            borderBottom: activeTab === 'hooks' ? `2px solid ${colors.accentPrimary}` : '2px solid transparent',
          }}
        >
          Hooks ({configuredCount}/{requiredCount})
        </button>
        <button
          onClick={() => setActiveTab('general')}
          className="flex-1 py-2 text-xs font-medium transition-colors"
          style={{
            color: activeTab === 'general' ? colors.textPrimary : colors.textMuted,
            borderBottom: activeTab === 'general' ? `2px solid ${colors.accentPrimary}` : '2px solid transparent',
          }}
        >
          通用
        </button>
        <button
          onClick={() => setActiveTab('remote')}
          className="flex-1 py-2 text-xs font-medium transition-colors"
          style={{
            color: activeTab === 'remote' ? colors.textPrimary : colors.textMuted,
            borderBottom: activeTab === 'remote' ? `2px solid ${colors.accentPrimary}` : '2px solid transparent',
          }}
        >
          远程访问
        </button>
        {hideHeader && (
          <button
            onClick={(e) => { e.stopPropagation(); saveAll(); }}
            disabled={saving}
            className="px-3 py-1.5 my-0.5 mr-1 rounded-lg transition-opacity text-xs font-medium disabled:opacity-50"
            style={{ background: colors.accentGradient, color: '#ffffff' }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin">
        <AnimatePresence mode="wait">
          {activeTab === 'hooks' ? (
            <motion.div key="hooks" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.15 }}>
              {hooksResult.missing_required.length > 0 && (
                <div className="text-orange-400 text-xs mb-3 p-2 bg-orange-500/10 rounded">
                  ⚠️ 缺少必要的 Hooks: {hooksResult.missing_required.join(', ')}
                </div>
              )}
              <div className="mb-3">
                <button
                  onClick={() => setShowRequired(!showRequired)}
                  className="w-full flex items-center justify-between p-2 rounded-[10px] border transition-colors"
                  style={showRequired ? cardHoverStyle : cardStyle}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: colors.textSecondary }}>必须的 Hooks</span>
                    <span className="text-xs" style={{ color: colors.textMuted }}>({requiredCount})</span>
                  </div>
                  <motion.span animate={{ rotate: showRequired ? 180 : 0 }} className="text-xs" style={{ color: colors.textMuted }}>
                    ▼
                  </motion.span>
                </button>
                <AnimatePresence>
                  {showRequired && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-2 space-y-1 pl-2">
                        {hooksResult.hooks.filter(h => h.required).map(hook => (
                          <div key={hook.name} className="flex items-center justify-between py-1 px-2 text-sm">
                            <span style={{ color: colors.textSecondary }}>{getHookDisplayName(hook.name)}</span>
                            <span className="text-xs" style={{ color: colors.textMuted }}>{hook.timeout}s</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="text-xs mb-2" style={{ color: colors.textSecondary }}>可选 Hooks:</div>
              {hooksResult.hooks.filter(h => !h.required).map(hook => (
                <label
                  key={hook.name}
                  className="flex items-center gap-3 p-2 rounded-[10px] border cursor-pointer transition-colors mb-1"
                  style={cardStyle}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = colors.bgCard; }}
                >
                  <input type="checkbox" checked={selectedHooks.has(hook.name)} onChange={() => toggleHook(hook.name)} className="w-4 h-4 rounded" />
                  <span className="text-sm flex-1" style={{ color: colors.textPrimary }}>{getHookDisplayName(hook.name)}</span>
                  <span className="text-xs" style={{ color: colors.textMuted }}>{hook.timeout}s</span>
                </label>
              ))}
            </motion.div>
          ) : activeTab === 'general' ? (
            <motion.div key="general" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }} className="space-y-3">
              <div className="space-y-1">
                {[
                  { key: 'auto_allow_permissions', label: '自动允许执行命令', sub: '(Bash/Read等，Ask仍需确认)' },
                  { key: 'auto_deny_on_timeout', label: '超时时自动拒绝' },
                  { key: 'show_notifications', label: '显示状态通知' },
                  { key: 'enable_logging', label: '启用日志记录', sub: '~/.cc-island/cc-island.log' },
                  { key: 'show_thinking_messages', label: '显示思考过程', sub: '(ChatView中显示thinking内容)' },
                ].map(item => (
                  <label
                    key={item.key}
                    className="flex items-center gap-3 p-2 rounded-[10px] border cursor-pointer transition-colors"
                    style={cardStyle}
                    onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = colors.bgCard; }}
                  >
                    <input
                      type="checkbox"
                      checked={(settings as any)[item.key] as boolean}
                      onChange={e => setSettings({ ...settings, [item.key]: e.target.checked })}
                      className="w-4 h-4 rounded"
                    />
                    <div className="flex-1">
                      <span className="text-sm" style={{ color: colors.textPrimary }}>{item.label}</span>
                      {item.sub && <span className="text-xs ml-2" style={{ color: colors.textMuted }}>{item.sub}</span>}
                    </div>
                  </label>
                ))}
              </div>

              {/* Theme Selector */}
              <div style={{ borderTop: `1px solid ${colors.borderLight}`, paddingTop: '0.75rem' }}>
                <label className="text-xs block mb-2" style={{ color: colors.textSecondary }}>界面主题</label>
                <div className="relative">
                  <select
                    value={settings.theme || 'dark'}
                    onChange={e => {
                      const newTheme = e.target.value;
                      setSettings({ ...settings, theme: newTheme });
                      useAppStore.getState().setTheme(newTheme);
                      invoke('set_app_theme', { theme: newTheme }).catch(console.error);
                    }}
                    className="w-full px-3 py-2 border rounded-[10px] text-sm focus:outline-none appearance-none cursor-pointer"
                    style={{ ...inputStyle, borderColor: colors.borderMedium }}
                    onFocus={e => (e.currentTarget.style.borderColor = colors.accentPrimary)}
                    onBlur={e => (e.currentTarget.style.borderColor = colors.borderMedium)}
                  >
                    {(Object.keys(THEME_LABELS) as ThemeId[]).map(id => (
                      <option key={id} value={id} style={{ background: colors.selectOptionBg, color: colors.selectOptionText }}>
                        {THEME_LABELS[id]}
                      </option>
                    ))}
                  </select>
                  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1L5 5L9 1" stroke={colors.textSecondary} strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>

              {/* Numeric Inputs */}
              <div className="space-y-3" style={{ borderTop: `1px solid ${colors.borderLight}`, paddingTop: '0.75rem' }}>
                {[
                  [
                    { key: 'max_instances', label: '最大实例数' },
                    { key: 'max_popup_queue', label: '弹窗队列' },
                  ],
                  [
                    { key: 'permission_timeout', label: '权限超时(秒)' },
                    { key: 'ask_timeout', label: 'Ask超时(秒)' },
                  ],
                  [
                    { key: 'warning_time', label: '警告时间(秒)' },
                    { key: 'critical_time', label: '紧急时间(秒)' },
                  ],
                  [
                    { key: 'poll_interval', label: '刷新间隔(ms)' },
                    { key: 'notification_auto_close', label: '通知关闭(ms)' },
                  ],
                ].map((row, i) => (
                  <div className="grid grid-cols-2 gap-2" key={i}>
                    {row.map(field => (
                      <div key={field.key}>
                        <label className="text-xs block mb-1" style={{ color: colors.textSecondary }}>{field.label}</label>
                        <input
                          type="number"
                          value={(settings as any)[field.key]}
                          onChange={e => setSettings({ ...settings, [field.key]: parseInt(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 border rounded-[10px] text-xs focus:outline-none"
                          style={inputStyle}
                          onFocus={e => (e.currentTarget.style.borderColor = colors.accentPrimary)}
                          onBlur={e => (e.currentTarget.style.borderColor = colors.borderMedium)}
                        />
                      </div>
                    ))}
                  </div>
                ))}
                <div>
                  <label className="text-xs block mb-1" style={{ color: colors.textSecondary }}>Hook转发地址</label>
                  <input
                    type="text"
                    placeholder="http://localhost:8080/hook"
                    value={settings.hook_forward_url || ''}
                    onChange={e => setSettings({ ...settings, hook_forward_url: e.target.value || null })}
                    className="w-full px-2 py-1.5 border rounded-[10px] text-xs focus:outline-none"
                    style={{ ...inputStyle, color: settings.hook_forward_url ? colors.textPrimary : colors.textMuted }}
                    onFocus={e => (e.currentTarget.style.borderColor = colors.accentPrimary)}
                    onBlur={e => (e.currentTarget.style.borderColor = colors.borderMedium)}
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="remote" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }} className="space-y-3">
              <div className="text-sm mb-2" style={{ color: colors.textPrimary }}>通过云服务器实现手机远程访问</div>

              <label
                className="flex items-center gap-3 p-2 rounded-[10px] border cursor-pointer transition-colors"
                style={cardStyle}
                onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = colors.bgCard; }}
              >
                <input type="checkbox" checked={settings.cloud_mode || false} onChange={e => setSettings({ ...settings, cloud_mode: e.target.checked })} className="w-4 h-4 rounded" />
                <div className="flex-1">
                  <span className="text-sm" style={{ color: colors.textPrimary }}>启用远程访问</span>
                  <span className="text-xs ml-2" style={{ color: colors.textMuted }}>(通过云服务器)</span>
                </div>
              </label>

              {settings.cloud_mode && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="text-xs block mb-1" style={{ color: colors.textSecondary }}>云服务器地址</label>
                    <input
                      type="text" placeholder="wss://cloud.example.com:17528"
                      value={settings.cloud_server_url || ''}
                      onChange={e => setSettings({ ...settings, cloud_server_url: e.target.value || null })}
                      className="w-full px-2 py-1.5 border rounded-[10px] text-xs focus:outline-none"
                      style={inputStyle}
                      onFocus={e => (e.currentTarget.style.borderColor = colors.accentPrimary)}
                      onBlur={e => (e.currentTarget.style.borderColor = colors.borderMedium)}
                    />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: colors.textSecondary }}>设备名称 (可选)</label>
                    <input
                      type="text" placeholder="我的电脑"
                      value={settings.device_name || ''}
                      onChange={e => setSettings({ ...settings, device_name: e.target.value || null })}
                      className="w-full px-2 py-1.5 border rounded-[10px] text-xs focus:outline-none"
                      style={inputStyle}
                      onFocus={e => (e.currentTarget.style.borderColor = colors.accentPrimary)}
                      onBlur={e => (e.currentTarget.style.borderColor = colors.borderMedium)}
                    />
                  </div>

                  <div className="border rounded-[10px] p-2 mt-2" style={{ ...cardStyle }}>
                    <div className="text-xs" style={{ color: colors.textMuted }}>设备 Token:</div>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-black/30 px-1 rounded flex-1 truncate" style={{ color: colors.textPrimary }}>
                        {deviceToken || '加载中...'}
                      </code>
                      <button onClick={() => deviceToken && navigator.clipboard.writeText(deviceToken)} disabled={!deviceToken} className="px-2 py-1 text-xs" style={{ color: colors.textMuted }}>
                        复制
                      </button>
                      <button onClick={generateQRCode} className="px-2 py-1 text-xs" style={{ color: colors.textMuted }}>
                        二维码
                      </button>
                    </div>
                  </div>

                  <div className="text-xs" style={{ color: colors.textMuted }}>将此Token输入到手机App即可连接此设备</div>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs" style={{ color: colors.textMuted }}>连接状态:</span>
                    {connectionStatus.type === 'Disconnected' && <span className="text-xs" style={{ color: colors.textMuted }}>未连接</span>}
                    {connectionStatus.type === 'Connecting' && (
                      <span className="text-yellow-400 text-xs flex items-center gap-1">
                        <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>●</motion.span>
                        连接中...
                      </span>
                    )}
                    {connectionStatus.type === 'Connected' && <span className="text-green-400 text-xs flex items-center gap-1"><span>●</span>已连接</span>}
                    {connectionStatus.type === 'Failed' && <span className="text-red-400 text-xs flex items-center gap-1"><span>●</span>连接失败: {connectionStatus.message}</span>}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`mt-3 p-2 rounded text-sm text-center ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
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
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/80"
            onClick={() => setShowQRModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
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
      </>)}
    </div>
  );
}

// Initial setup modal shown on first launch
interface HooksSetupModalProps {
  result: HooksCheckResult;
  onComplete: () => void;
  className?: string;
  hideHeader?: boolean;
}

export function HooksSetupModal({ result, onComplete, className, hideHeader }: HooksSetupModalProps) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const [selectedHooks, setSelectedHooks] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [showRequired, setShowRequired] = useState(false);

  useEffect(() => {
    const selected = new Set<string>();
    result.hooks.forEach(h => { if (h.required) selected.add(h.name); });
    ['Stop', 'PostToolUseFailure'].forEach(name => {
      if (result.hooks.find(h => h.name === name)) selected.add(name);
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
    } catch (e) { console.error('Failed to save hooks:', e); }
    setSaving(false);
  };

  const requiredHooks = result.hooks.filter(h => h.required);
  const optionalHooks = result.hooks.filter(h => !h.required);

  const cardStyle: React.CSSProperties = { background: colors.bgCard, borderColor: colors.borderLight };

  return (
    <div className={`flex flex-col ${className || 'h-full'} w-full rounded-b-xl`} style={{ background: colors.bgMain }}>
      {!hideHeader && (
      <div className="flex items-center px-3 py-2" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
        <span className="text-sm font-medium" style={{ color: colors.textPrimary }}>配置 Claude Code Hooks</span>
      </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <p className="text-sm mb-4" style={{ color: colors.textPrimary }}>CC-Island 需要配置 Claude Code 的 Hooks 才能正常工作。</p>

        <div className="mb-3">
          <button
            onClick={() => setShowRequired(!showRequired)}
            className="w-full flex items-center justify-between p-2 rounded bg-orange-500/10 hover:bg-orange-500/15 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-orange-400 text-sm font-medium">必须的 Hooks ({requiredHooks.length})</span>
              <span className="text-orange-300/50 text-xs">已自动选中</span>
            </div>
            <motion.span animate={{ rotate: showRequired ? 180 : 0 }} className="text-orange-400/50 text-xs">▼</motion.span>
          </button>

          <AnimatePresence>
            {showRequired && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-2 space-y-1 pl-2">
                  {requiredHooks.map(hook => (
                    <div key={hook.name} className="flex items-center justify-between py-1.5 px-2 text-sm">
                      <span style={{ color: colors.textSecondary }}>{getHookDisplayName(hook.name)}</span>
                      <span className="text-xs" style={{ color: colors.textMuted }}>{hook.timeout}s</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="text-xs mb-2" style={{ color: colors.textMuted }}>可选 Hooks：</div>
        <div className="space-y-1 max-h-[140px] overflow-y-auto">
          {optionalHooks.map(hook => (
            <label
              key={hook.name}
              className="flex items-center gap-3 p-2 rounded-[10px] border cursor-pointer transition-colors"
              style={cardStyle}
              onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = colors.bgCard; }}
            >
              <input type="checkbox" checked={selectedHooks.has(hook.name)} onChange={() => toggleHook(hook.name)} className="w-4 h-4 rounded" />
              <span className="text-sm flex-1" style={{ color: colors.textPrimary }}>{getHookDisplayName(hook.name)}</span>
              <span className="text-xs" style={{ color: colors.textMuted }}>{hook.timeout}s</span>
            </label>
          ))}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onComplete}
            className="flex-1 py-2 border rounded-lg transition-colors text-sm"
            style={{ background: colors.bgCard, borderColor: colors.borderLight, color: colors.textPrimary }}
          >
            稍后配置
          </button>
          <button
            onClick={saveAndContinue} disabled={saving}
            className="flex-1 py-2 rounded-lg transition-opacity text-sm font-medium disabled:opacity-50"
            style={{ background: colors.accentGradient, color: '#ffffff' }}
          >
            {saving ? '保存中...' : '保存并继续'}
          </button>
        </div>
      </div>
    </div>
  );
}
