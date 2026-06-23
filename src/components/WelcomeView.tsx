// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ClaudeInstance } from '../types';
import { useAppStore } from '../stores/appStore';
import { getTheme } from '../theme';

const FLAG_OPTIONS = [
  { value: '--verbose', label: '--verbose' },
  { value: '--debug', label: '--debug' },
  { value: '--resume', label: '--resume' },
];

const PERMISSION_MODES = [
  { value: 'default', label: 'default' },
  { value: 'acceptEdits', label: 'acceptEdits' },
  { value: 'auto', label: 'auto' },
  { value: 'bypassPermissions', label: 'bypassPermissions' },
  { value: 'dontAsk', label: 'dontAsk' },
  { value: 'plan', label: 'plan' },
];

interface WelcomeViewProps {
  productName: string;
  models: string[];
  historySessions: ClaudeInstance[];
  onSelectSession: (sessionId: string) => void;
  onSessionCreated: () => void;
}

export function CreateSessionModal({
  models, onClose, onCreated,
}: {
  models: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const [projectPath, setProjectPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(models[0] || 'sonnet');
  const [flags, setFlags] = useState<string[]>([]);
  const [permissionMode, setPermissionMode] = useState('default');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const toggleFlag = (flag: string) => {
    setFlags(prev => prev.includes(flag) ? prev.filter(f => f !== flag) : [...prev, flag]);
  };

  const handleCreate = async () => {
    if (!projectPath.trim()) {
      setCreateError('请输入项目路径');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      await invoke('spawn_claude', {
        projectPath: projectPath.trim(),
        prompt: prompt.trim() || null,
        model: model || null,
        flags: flags.length > 0 ? flags : null,
        permissionMode: permissionMode || null,
      });
      setProjectPath('');
      setPrompt('');
      onCreated();
      onClose();
    } catch (e: any) {
      setCreateError(typeof e === 'string' ? e : e?.message || '启动失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />
      <div
        className="relative rounded-xl p-5 w-full max-w-lg mx-4 shadow-2xl"
        style={{ background: colors.bgModal, border: `1px solid ${colors.borderMedium}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: colors.textPrimary }}>新建 Claude 会话</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: colors.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.background = colors.bgCardHover; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Project Path */}
        <div className="mb-3">
          <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>项目路径 *</label>
          <div className="flex gap-2">
            <input
              type="text" value={projectPath} onChange={e => setProjectPath(e.target.value)}
              placeholder="/path/to/your/project"
              className="flex-1 px-3 py-2 rounded-md text-sm outline-none transition-colors"
              style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
              onFocus={e => (e.target.style.borderColor = colors.accentPrimary)}
              onBlur={e => (e.target.style.borderColor = colors.bgInputBorder)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              autoFocus
            />
            <button
              onClick={async () => {
                const selected = await open({ directory: true, title: '选择项目目录' });
                if (selected) setProjectPath(selected);
              }}
              className="px-3 py-2 rounded-md text-xs font-medium transition-colors flex-shrink-0 flex items-center gap-1"
              style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; e.currentTarget.style.color = colors.textPrimary; }}
              onMouseLeave={e => { e.currentTarget.style.background = colors.bgInput; e.currentTarget.style.color = colors.textSecondary; }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M2 3.5A1.5 1.5 0 013.5 2h2.17a1.5 1.5 0 011.34.83L7.5 4h4A1.5 1.5 0 0113 5.5v5A1.5 1.5 0 0111.5 12h-8A1.5 1.5 0 012 10.5v-7z" stroke="currentColor" strokeWidth="1" fill="none"/>
              </svg>
              选择
            </button>
          </div>
        </div>

        {/* Prompt */}
        <div className="mb-3">
          <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>初始提示</label>
          <textarea
            value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="可选的初始提示词..."
            rows={2}
            className="w-full px-3 py-2 rounded-md text-sm outline-none transition-colors resize-none"
            style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
            onFocus={e => (e.target.style.borderColor = 'rgba(124,58,237,0.4)')}
            onBlur={e => (e.target.style.borderColor = colors.bgInputBorder)}
          />
        </div>

        {/* Model + Permission Mode */}
        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>模型</label>
            <div className="relative">
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm outline-none cursor-pointer appearance-none"
                style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
              >
                {models.map(m => (
                  <option key={m} value={m} style={{ background: colors.selectOptionBg, color: colors.selectOptionText }}>{m}</option>
                ))}
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ color: colors.textMuted }}>
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>权限模式</label>
            <div className="relative">
              <select value={permissionMode} onChange={e => setPermissionMode(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm outline-none cursor-pointer appearance-none"
                style={{ background: colors.bgInput, border: `1px solid ${colors.bgInputBorder}`, color: colors.textPrimary }}
              >
                {PERMISSION_MODES.map(m => (
                  <option key={m.value} value={m.value} style={{ background: colors.selectOptionBg, color: colors.selectOptionText }}>{m.label}</option>
                ))}
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ color: colors.textMuted }}>
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Flags */}
        <div className="mb-4">
          <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>附加参数</label>
          <div className="flex gap-2 flex-wrap">
            {FLAG_OPTIONS.map(opt => {
              const active = flags.includes(opt.value);
              return (
                <button key={opt.value} onClick={() => toggleFlag(opt.value)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: active ? `${colors.accentPrimary}33` : colors.bgInput,
                    border: active ? `1px solid ${colors.accentPrimary}55` : `1px solid ${colors.bgInputBorder}`,
                    color: active ? colors.accentHover : colors.textSecondary,
                  }}
                >{opt.label}</button>
              );
            })}
          </div>
        </div>

        {createError && <div className="text-xs text-[#ef4444] mb-3 px-1">{createError}</div>}

        <button onClick={handleCreate} disabled={creating || !projectPath.trim()}
          className="w-full py-2 rounded-md text-sm font-semibold transition-all"
          style={{
            background: creating || !projectPath.trim() ? 'rgba(124,58,237,0.2)' : 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
            color: creating || !projectPath.trim() ? colors.textMuted : '#f1f5f9',
            cursor: creating || !projectPath.trim() ? 'not-allowed' : 'pointer',
            boxShadow: creating || !projectPath.trim() ? 'none' : '0 4px 16px rgba(124,58,237,0.25)',
          }}
        >{creating ? '启动中...' : '启动 Claude'}</button>
      </div>
    </div>
  );
}

function HistoryModal({ sessions, onSelect, onClose }: { sessions: ClaudeInstance[]; onSelect: (id: string) => void; onClose: () => void }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />
      <div
        className="relative rounded-xl p-4 w-full max-w-md mx-4 shadow-2xl max-h-[70vh] flex flex-col"
        style={{ background: colors.bgModal, border: `1px solid ${colors.borderMedium}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: colors.textPrimary }}>全部历史会话 ({sessions.length})</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: colors.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.background = colors.bgCardHover; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex flex-col gap-1" style={{ scrollbarWidth: 'thin' }}>
          {sessions.map(session => (
            <button key={session.session_id}
              onClick={() => { onSelect(session.session_id); onClose(); }}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left group"
              style={{ background: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.bgCardHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div className="flex items-center justify-center font-bold flex-shrink-0 rounded-md"
                style={{ width: 24, height: 24, background: 'linear-gradient(135deg, #6366f1, #a855f7)', fontSize: 11, color: '#f1f5f9' }}
              >{(session.project_name || '?').charAt(0).toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate" style={{ color: colors.textPrimary }}>{session.project_name || 'Unknown'}</div>
                {(session.ai_title || session.first_prompt) && (
                  <div className="text-[10px] truncate mt-0.5" style={{ color: colors.textMuted }}>{session.ai_title || session.first_prompt}</div>
                )}
              </div>
              <span className="text-[10px] flex-shrink-0" style={{ color: colors.textMuted }}>
                {session.ended_at ? new Date(session.ended_at * 1000).toLocaleDateString() : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WelcomeView({ productName, models, historySessions, onSelectSession, onSessionCreated }: WelcomeViewProps) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const initials = (productName || 'C').charAt(0).toUpperCase();
  const [showCreate, setShowCreate] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const recentFive = historySessions.slice(0, 5);
  const hasMore = historySessions.length > 5;

  return (
    <div className="flex-1 overflow-y-auto flex items-center justify-center" style={{ background: colors.bgApp, scrollbarWidth: 'thin' }}>
      <div className="max-w-md mx-auto px-8 py-10 w-full">
        {/* Logo + Title */}
        <div className="flex items-center gap-4 mb-8 justify-center">
          <div
            className="flex items-center justify-center font-extrabold flex-shrink-0"
            style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)', fontSize: 22, boxShadow: '0 8px 24px rgba(124,58,237,0.25)', color: '#f1f5f9' }}
          >{initials}</div>
          <div>
            <div className="text-xl font-bold" style={{ color: colors.textPrimary }}>{productName || 'CC-Island'}</div>
            <div className="text-xs" style={{ color: colors.textMuted }}>Claude Code 会话管理中心</div>
          </div>
        </div>

        {/* New Session Button */}
        <button
          onClick={() => setShowCreate(true)}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all mb-8 flex items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
            color: '#f1f5f9',
            boxShadow: '0 4px 16px rgba(124,58,237,0.2)',
          }}
          onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 6px 24px rgba(124,58,237,0.35)')}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,58,237,0.2)')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
          新建会话
        </button>

        {/* Recent Sessions */}
        {recentFive.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: colors.textSecondary }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7 4v3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              最近会话
            </h3>
            <div className="flex flex-col gap-1">
              {recentFive.map(session => (
                <button key={session.session_id} onClick={() => onSelectSession(session.session_id)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left group"
                  style={{ background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.bgCard)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="flex items-center justify-center font-bold flex-shrink-0 rounded-md"
                    style={{ width: 24, height: 24, background: 'linear-gradient(135deg, #6366f1, #a855f7)', fontSize: 11, color: '#f1f5f9' }}
                  >{(session.project_name || '?').charAt(0).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate" style={{ color: colors.textPrimary }}>{session.project_name || 'Unknown'}</div>
                    {(session.ai_title || session.first_prompt) && (
                      <div className="text-xs truncate mt-0.5" style={{ color: colors.textMuted }}>{(session.ai_title || session.first_prompt)}</div>
                    )}
                  </div>
                  <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: colors.textMuted }}>
                    {session.ended_at ? new Date(session.ended_at * 1000).toLocaleDateString() : ''}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: colors.textMuted }}>
                    <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
            {hasMore && (
              <button
                onClick={() => setShowAllHistory(true)}
                className="w-full mt-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                style={{ background: colors.bgInput, color: colors.textMuted }}
                onMouseEnter={e => { e.currentTarget.style.background = colors.bgCardHover; e.currentTarget.style.color = colors.textSecondary; }}
                onMouseLeave={e => { e.currentTarget.style.background = colors.bgInput; e.currentTarget.style.color = colors.textMuted; }}
              >
                查看全部 {historySessions.length} 个会话
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M3 2l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-xs" style={{ color: colors.textMuted }}>
            暂无历史会话
          </div>
        )}

        {/* Create Modal */}
        {showCreate && (
          <CreateSessionModal models={models} onClose={() => setShowCreate(false)} onCreated={onSessionCreated} />
        )}

        {/* All History Modal */}
        {showAllHistory && (
          <HistoryModal
            sessions={historySessions}
            onSelect={onSelectSession}
            onClose={() => setShowAllHistory(false)}
          />
        )}
      </div>
    </div>
  );
}
