// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { TerminalInfo, RestartConfig, RestartPreset } from '../types';

interface RestartDialogProps {
  sessionId: string;
  projectName: string;
  firstPrompt?: string;
  onClose: () => void;
}

const CLAUDE_ARG_OPTIONS = [
  { label: 'Verbose', value: '--verbose', description: '详细输出' },
  { label: 'Debug', value: '--debug', description: '调试模式' },
  { label: 'Skip Permissions', value: '--dangerously-skip-permissions', description: '跳过权限检查' },
  { label: 'Print', value: '--print', description: '打印后退出' },
  { label: 'Continue', value: '--continue', description: '继续最近对话' },
  { label: 'Append', value: '--append', description: '追加模式' },
  { label: 'Sonnet', value: '--model sonnet', description: 'Sonnet 模型' },
  { label: 'Opus', value: '--model opus', description: 'Opus 模型' },
  { label: 'Haiku', value: '--model haiku', description: 'Haiku 模型' },
];

export function RestartDialog({ sessionId, projectName, firstPrompt, onClose }: RestartDialogProps) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>('');
  const [selectedArgs, setSelectedArgs] = useState<Set<string>>(new Set());
  const [customArgs, setCustomArgs] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [argDropdownOpen, setArgDropdownOpen] = useState(false);
  const [presets, setPresets] = useState<RestartPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const argDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available terminals and restart config on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [result, config] = await Promise.all([
          invoke<TerminalInfo[]>('get_available_terminals'),
          invoke<RestartConfig>('get_restart_config'),
        ]);
        setTerminals(result);
        if (result.length > 0) {
          setSelectedTerminal(result[0].bundle_id);
        }
        // Apply default args from config
        if (config.default_args.length > 0) {
          setSelectedArgs(new Set(config.default_args));
        }
        setPresets(config.saved_presets);
      } catch (e) {
        console.error('Failed to fetch data:', e);
        setError('获取配置失败');
      }
    };
    fetchData();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!dropdownOpen && !argDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (argDropdownRef.current && !argDropdownRef.current.contains(e.target as Node)) {
        setArgDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen, argDropdownOpen]);

  // Toggle arg chip
  const toggleArg = (arg: string) => {
    setSelectedArgs(prev => {
      const next = new Set(prev);
      if (next.has(arg)) {
        next.delete(arg);
      } else {
        next.add(arg);
      }
      return next;
    });
  };

  // Build final command preview
  const commandPreview = useMemo(() => {
    const parts: string[] = [];
    selectedArgs.forEach(arg => parts.push(arg));
    if (customArgs.trim()) {
      parts.push(customArgs.trim());
    }
    const argsStr = parts.length > 0 ? ` ${parts.join(' ')}` : '';
    return `claude --resume ${sessionId}${argsStr}`;
  }, [sessionId, selectedArgs, customArgs]);

  // Handle launch
  const handleLaunch = async () => {
    setIsLaunching(true);
    setError(null);
    try {
      const extraArgs = [...selectedArgs, customArgs.trim()].filter(Boolean).join(' ');
      await invoke('restart_session', {
        sessionId,
        terminalBundleId: selectedTerminal,
        extraArgs,
      });
      onClose();
    } catch (e) {
      console.error('Failed to restart session:', e);
      setError(typeof e === 'string' ? e : '启动失败');
    } finally {
      setIsLaunching(false);
    }
  };

  // Apply preset
  const applyPreset = (preset: RestartPreset) => {
    const args = preset.args.split(/\s+/).filter(Boolean);
    setSelectedArgs(new Set(args));
  };

  // Save current args as preset
  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    const args = [...selectedArgs, customArgs.trim()].filter(Boolean).join(' ');
    try {
      await invoke('save_restart_preset', { name, args });
      setPresets(prev => {
        const filtered = prev.filter(p => p.name !== name);
        return [...filtered, { name, args }];
      });
      setPresetName('');
    } catch (e) {
      console.error('Failed to save preset:', e);
    }
  };

  // Delete preset
  const handleDeletePreset = async (name: string) => {
    try {
      await invoke('delete_restart_preset', { name });
      setPresets(prev => prev.filter(p => p.name !== name));
    } catch (e) {
      console.error('Failed to delete preset:', e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="rounded-xl p-4 w-full max-w-sm mx-4"
        style={{
          background: 'rgba(30,30,30,0.98)',
          border: '1px solid rgba(255,255,255,0.1)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Title */}
        <h3 className="text-white font-medium text-sm mb-1">
          重启会话: {projectName}
        </h3>
        {firstPrompt && (
          <p className="text-white/40 text-xs mb-3 truncate">{firstPrompt}</p>
        )}

        {/* Terminal selection - custom dropdown to avoid native OS popup */}
        <div className="mb-3 relative" ref={dropdownRef}>
          <label className="text-white/50 text-xs block mb-1">终端</label>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full px-3 py-2 rounded-lg text-sm text-white text-left flex items-center justify-between"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              outline: 'none',
            }}
          >
            <span>{terminals.find(t => t.bundle_id === selectedTerminal)?.display_name || '加载中...'}</span>
            <span className="text-white/40 text-xs">{dropdownOpen ? '▲' : '▼'}</span>
          </button>
          {dropdownOpen && (
            <div
              className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-50"
              style={{
                background: 'rgba(40,40,40,0.98)',
                border: '1px solid rgba(255,255,255,0.15)',
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {terminals.map(t => (
                <button
                  key={t.bundle_id}
                  type="button"
                  onClick={() => {
                    setSelectedTerminal(t.bundle_id);
                    setDropdownOpen(false);
                  }}
                  className="w-full px-3 py-2 text-sm text-left text-white hover:bg-white/10 transition-colors"
                >
                  {t.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Arg multi-select dropdown */}
        <div className="mb-3 relative" ref={argDropdownRef}>
          <label className="text-white/50 text-xs block mb-1">Claude 参数</label>
          <button
            type="button"
            onClick={() => setArgDropdownOpen(!argDropdownOpen)}
            className="w-full px-3 py-2 rounded-lg text-sm text-white text-left flex items-center justify-between"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              outline: 'none',
            }}
          >
            <span className="truncate">
              {selectedArgs.size > 0
                ? `已选 ${selectedArgs.size} 项`
                : '选择参数...'}
            </span>
            <span className="text-white/40 text-xs ml-2">{argDropdownOpen ? '▲' : '▼'}</span>
          </button>
          {argDropdownOpen && (
            <div
              className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-50"
              style={{
                background: 'rgba(40,40,40,0.98)',
                border: '1px solid rgba(255,255,255,0.15)',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {CLAUDE_ARG_OPTIONS.map(opt => {
                const isSelected = selectedArgs.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleArg(opt.value)}
                    className="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-white/10 transition-colors"
                    style={{ color: isSelected ? '#c084fc' : 'rgba(255,255,255,0.7)' }}
                  >
                    <span
                      className="w-4 h-4 flex items-center justify-center rounded border flex-shrink-0"
                      style={{
                        borderColor: isSelected ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.2)',
                        background: isSelected ? 'rgba(168,85,247,0.3)' : 'transparent',
                      }}
                    >
                      {isSelected && <span className="text-[10px]">✓</span>}
                    </span>
                    <span>{opt.label}</span>
                    <span className="ml-auto text-white/30 flex-shrink-0">{opt.description}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Saved presets */}
        {presets.length > 0 && (
          <div className="mb-3">
            <label className="text-white/50 text-xs block mb-1">已保存预设</label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(preset => (
                <span
                  key={preset.name}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.6)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <button onClick={() => applyPreset(preset)} className="hover:text-white transition-colors">
                    {preset.name}
                  </button>
                  <button
                    onClick={() => handleDeletePreset(preset.name)}
                    className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Custom args */}
        <div className="mb-3">
          <label className="text-white/50 text-xs block mb-1">自定义参数</label>
          <input
            type="text"
            value={customArgs}
            onChange={e => setCustomArgs(e.target.value)}
            placeholder="--additional-arg value"
            className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/30"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              outline: 'none',
            }}
          />
        </div>

        {/* Save preset */}
        <div className="mb-3 flex gap-1.5">
          <input
            type="text"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            placeholder="预设名称"
            className="flex-1 px-3 py-2 rounded-lg text-xs text-white placeholder-white/30"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSavePreset}
            disabled={!presetName.trim()}
            className="px-3 py-2 rounded-lg text-xs text-white/60 hover:text-white/80 disabled:opacity-30 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            保存
          </button>
        </div>

        {/* Command preview - multi-line */}
        <div className="mb-4">
          <label className="text-white/50 text-xs block mb-1">命令预览</label>
          <div
            className="px-3 py-2 rounded-lg text-xs font-mono text-white/70 break-all min-h-[40px]"
            style={{ background: 'rgba(0,0,0,0.3)' }}
          >
            {commandPreview}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 text-red-400 text-xs">{error}</div>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isLaunching}
            className="px-4 py-2 rounded-lg text-xs text-white/60 hover:text-white/80 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            取消
          </button>
          <button
            onClick={handleLaunch}
            disabled={isLaunching || !selectedTerminal}
            className="px-4 py-2 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50"
            style={{
              background: isLaunching ? 'rgba(168,85,247,0.5)' : 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
            }}
          >
            {isLaunching ? '启动中...' : '启动'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
