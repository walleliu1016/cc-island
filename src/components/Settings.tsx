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

  useEffect(() => {
    if (isOpen) {
      loadHooksStatus();
      loadSettings();
    }
  }, [isOpen]);

  const loadHooksStatus = async () => {
    try {
      const result = await invoke<HooksCheckResult>('check_claude_hooks');
      setHooksResult(result);
      // Pre-select all required hooks and configured optional hooks
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
      // Don't allow deselecting required hooks
      const hook = hooksResult?.hooks.find(h => h.name === name);
      if (hook?.required) return;
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedHooks(newSelected);
  };

  const saveHooks = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await invoke('update_claude_hooks', { hooks: Array.from(selectedHooks) });
      onSettingsChange?.();
      onClose(); // Auto close after save
    } catch (e) {
      setMessage({ text: `保存失败: ${e}`, type: 'error' });
    }
    setSaving(false);
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      await invoke('update_settings', { settings });
      onSettingsChange?.();
      onClose(); // Auto close after save
    } catch (e) {
      setMessage({ text: `保存失败: ${e}`, type: 'error' });
    }
    setSaving(false);
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-gray-900 rounded-xl w-full max-w-[400px] max-h-[500px] overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="text-white font-semibold">设置</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white/80 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('hooks')}
            className={`flex-1 py-2 text-sm transition-colors ${
              activeTab === 'hooks' ? 'text-white border-b-2 border-blue-500' : 'text-white/50'
            }`}
          >
            Hooks 配置
          </button>
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-2 text-sm transition-colors ${
              activeTab === 'general' ? 'text-white border-b-2 border-blue-500' : 'text-white/50'
            }`}
          >
            通用设置
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[350px] overflow-y-auto">
          {activeTab === 'hooks' && hooksResult && (
            <div className="space-y-3">
              {hooksResult.missing_required.length > 0 && (
                <div className="text-orange-400 text-xs mb-2">
                  ⚠️ 缺少必要的 Hooks: {hooksResult.missing_required.join(', ')}
                </div>
              )}

              {/* Required hooks - collapsible */}
              <div>
                <button
                  onClick={() => setShowRequired(!showRequired)}
                  className="w-full flex items-center justify-between p-2 rounded bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white/60 text-xs">必须的 Hooks</span>
                    <span className="text-white/40 text-xs">({hooksResult.hooks.filter(h => h.required).length})</span>
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

              <div className="text-white/60 text-xs mt-4 mb-2">
                可选 Hooks:
              </div>
              {hooksResult.hooks.filter(h => !h.required).map(hook => (
                <label
                  key={hook.name}
                  className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedHooks.has(hook.name)}
                    onChange={() => toggleHook(hook.name)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-white/80 text-sm flex-1">{getHookDisplayName(hook.name)}</span>
                  <span className="text-white/40 text-xs">{hook.timeout}s</span>
                </label>
              ))}

              <button
                onClick={saveHooks}
                disabled={saving}
                className="w-full py-2 mt-4 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-lg transition-colors text-sm"
              >
                {saving ? '保存中...' : '保存 Hooks 配置'}
              </button>
            </div>
          )}

          {activeTab === 'general' && settings && (
            <div className="space-y-4">
              {/* 勾选框区域 */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_allow_permissions}
                  onChange={e => setSettings({ ...settings, auto_allow_permissions: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-white/80 text-sm">自动允许所有权限</span>
                <span className="text-white/40 text-xs">(跳过权限确认)</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_deny_on_timeout}
                  onChange={e => setSettings({ ...settings, auto_deny_on_timeout: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-white/80 text-sm">超时时自动拒绝</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.show_notifications}
                  onChange={e => setSettings({ ...settings, show_notifications: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-white/80 text-sm">显示状态通知</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enable_logging}
                  onChange={e => setSettings({ ...settings, enable_logging: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-white/80 text-sm">启用日志记录</span>
                <span className="text-white/40 text-xs">(~/.cc-island/cc-island.log)</span>
              </label>

              {/* 输入框区域 */}
              <div className="pt-2 border-t border-white/10">
                <div className="mb-3">
                  <label className="text-white/60 text-xs block mb-1">
                    权限请求超时（秒）
                  </label>
                  <input
                    type="number"
                    value={settings.permission_timeout}
                    onChange={e => setSettings({ ...settings, permission_timeout: parseInt(e.target.value) || 300 })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-white/30"
                  />
                </div>

                <div className="mb-3">
                  <label className="text-white/60 text-xs block mb-1">
                    Ask 问题超时（秒）
                  </label>
                  <input
                    type="number"
                    value={settings.ask_timeout}
                    onChange={e => setSettings({ ...settings, ask_timeout: parseInt(e.target.value) || 120 })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-white/30"
                  />
                </div>

                <div className="mb-3">
                  <label className="text-white/60 text-xs block mb-1">
                    数据刷新间隔（毫秒）
                  </label>
                  <input
                    type="number"
                    value={settings.poll_interval}
                    onChange={e => setSettings({ ...settings, poll_interval: parseInt(e.target.value) || 500 })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-white/30"
                  />
                </div>

                <div>
                  <label className="text-white/60 text-xs block mb-1">
                    Hook 转发地址
                  </label>
                  <input
                    type="text"
                    placeholder="http://localhost:8080/hook"
                    value={settings.hook_forward_url || ''}
                    onChange={e => setSettings({ ...settings, hook_forward_url: e.target.value || null })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-white/30 placeholder-white/30"
                  />
                  <span className="text-white/30 text-xs mt-1 block">配置后将异步转发所有 Hook 数据到此地址</span>
                </div>
              </div>

              <button
                onClick={saveSettings}
                disabled={saving}
                className="w-full py-2 mt-4 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-lg transition-colors text-sm"
              >
                {saving ? '保存中...' : '保存设置'}
              </button>
            </div>
          )}

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
      </motion.div>
    </motion.div>
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
    // Pre-select all required hooks
    const selected = new Set<string>();
    result.hooks.forEach(h => {
      if (h.required) {
        selected.add(h.name);
      }
    });
    // Also select recommended optional hooks
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-gray-900 rounded-xl w-full max-w-[400px] overflow-hidden shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-white font-semibold">配置 Claude Code Hooks</h2>
        </div>

        <div className="p-4">
          <p className="text-white/70 text-sm mb-4">
            CC-Island 需要配置 Claude Code 的 Hooks 才能正常工作。
          </p>

          {/* Required hooks - collapsed by default */}
          <div className="mb-3">
            <button
              onClick={() => setShowRequired(!showRequired)}
              className="w-full flex items-center justify-between p-2.5 rounded bg-orange-500/10 hover:bg-orange-500/15 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-orange-400 text-sm font-medium">
                  必须的 Hooks ({requiredHooks.length})
                </span>
                <span className="text-orange-300/50 text-xs">
                  已自动选中
                </span>
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
                      <div
                        key={hook.name}
                        className="flex items-center justify-between py-1.5 px-2 text-sm"
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

          {/* Optional hooks */}
          <div className="text-white/50 text-xs mb-2">
            可选 Hooks：
          </div>
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {optionalHooks.map(hook => (
              <label
                key={hook.name}
                className="flex items-center gap-3 p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedHooks.has(hook.name)}
                  onChange={() => toggleHook(hook.name)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-white/80 text-sm flex-1">{getHookDisplayName(hook.name)}</span>
                <span className="text-white/40 text-xs">{hook.timeout}s</span>
              </label>
            ))}
          </div>

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
              className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-lg transition-colors text-sm"
            >
              {saving ? '保存中...' : '保存并继续'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}