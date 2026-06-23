// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, PopupItem, AskQuestion, AskOption, AppSettings } from '../types';
import { ProcessingSpinner } from './StatusIcons';
import { useAppStore } from '../stores/appStore';
import { getTheme } from '../theme';

interface MsgColorSet {
  bg: string;
  border: string;
  text: string;
}

function getMessageColors(isDark: boolean): Record<string, MsgColorSet> {
  if (isDark) {
    return {
      user: { bg: 'rgba(124,58,237,0.12)', border: '#7c3aed', text: '#7c3aed' },
      assistant: { bg: 'rgba(255,255,255,0.06)', border: '#9e9e9e', text: '#e0e0e0' },
      thinking: { bg: 'rgba(255,193,7,0.08)', border: '#ffc107', text: '#ffc107' },
      toolCall: { bg: 'rgba(124,58,237,0.12)', border: '#7c3aed', text: '#7c3aed' },
      toolResult: { bg: 'rgba(76,175,80,0.08)', border: '#4caf50', text: '#4caf50' },
      toolError: { bg: 'rgba(244,67,54,0.08)', border: '#f44336', text: '#f44336' },
      write: { bg: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(76,175,80,0.08) 100%)', border: '#4caf50', text: '#7c3aed' },
      edit: { bg: 'linear-gradient(135deg, rgba(255,152,0,0.08) 0%, rgba(244,67,54,0.08) 100%)', border: '#ff9800', text: '#e65100' },
      bash: { bg: 'rgba(124,58,237,0.12)', border: '#7c3aed', text: '#7c3aed' },
      todo: { bg: 'linear-gradient(135deg, rgba(76,175,80,0.08) 0%, rgba(139,195,74,0.08) 100%)', border: '#81c784', text: '#2e7d32' },
    };
  }
  return {
    user: { bg: 'rgba(109,40,217,0.08)', border: '#6d28d9', text: '#6d28d9' },
    assistant: { bg: 'rgba(0,0,0,0.04)', border: '#9ca3af', text: '#374151' },
    thinking: { bg: 'rgba(180,130,0,0.08)', border: '#b8860b', text: '#92600a' },
    toolCall: { bg: 'rgba(109,40,217,0.08)', border: '#6d28d9', text: '#6d28d9' },
    toolResult: { bg: 'rgba(22,163,74,0.08)', border: '#16a34a', text: '#15803d' },
    toolError: { bg: 'rgba(220,38,38,0.08)', border: '#dc2626', text: '#b91c1c' },
    write: { bg: 'linear-gradient(135deg, rgba(109,40,217,0.06) 0%, rgba(22,163,74,0.06) 100%)', border: '#16a34a', text: '#6d28d9' },
    edit: { bg: 'linear-gradient(135deg, rgba(217,119,6,0.06) 0%, rgba(220,38,38,0.06) 100%)', border: '#d97706', text: '#b45309' },
    bash: { bg: 'rgba(109,40,217,0.08)', border: '#6d28d9', text: '#6d28d9' },
    todo: { bg: 'linear-gradient(135deg, rgba(22,163,74,0.06) 0%, rgba(132,204,22,0.06) 100%)', border: '#4ade80', text: '#166534' },
  };
}

// Parse AskUserQuestion content
function parseAskQuestions(content: string): AskQuestion[] | null {
  try {
    let jsonStr = content;
    if (content.includes(':')) {
      const colonIndex = content.indexOf(':');
      jsonStr = content.substring(colonIndex + 1).trim();
    }
    const parsed = JSON.parse(jsonStr);
    if (parsed.questions && Array.isArray(parsed.questions)) {
      return parsed.questions as AskQuestion[];
    }
    return null;
  } catch {
    return null;
  }
}

// Multi-step Question Wizard Component
function QuestionWizard({
  questions,
  selectedAnswers,
  onChange,
  onSubmit,
  onCancel,
  readOnly = false
}: {
  questions: AskQuestion[];
  selectedAnswers: string[][];
  onChange: (answers: string[][]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  readOnly?: boolean;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentQuestion = questions[currentIndex];
  const currentAnswers = selectedAnswers[currentIndex] || [];
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  const handleToggle = (label: string) => {
    if (readOnly) return;
    const newAnswers = [...selectedAnswers];
    if (!newAnswers[currentIndex]) {
      newAnswers[currentIndex] = [];
    }
    if (currentQuestion.multiSelect) {
      if (newAnswers[currentIndex].includes(label)) {
        newAnswers[currentIndex] = newAnswers[currentIndex].filter(a => a !== label);
      } else {
        newAnswers[currentIndex] = [...newAnswers[currentIndex], label];
      }
    } else {
      newAnswers[currentIndex] = [label];
    }
    onChange(newAnswers);
  };

  const canSubmit = questions.every((_, i) => (selectedAnswers[i] || []).length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header - Progress */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: colors.borderLight }}>
        <div className="text-xs" style={{ color: colors.textMuted }}>
          问题 {currentIndex + 1} / {questions.length}
        </div>
        <div className="flex items-center gap-1">
          {questions.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className="w-1.5 h-1.5 rounded-full transition-colors"
              style={{
                background: idx === currentIndex ? colors.textPrimary :
                  idx < currentIndex ? colors.textMuted : colors.bgCardHover,
              }}
            />
          ))}
        </div>
      </div>

      {/* Question Content */}
      <div className="flex-1 px-3 py-3 overflow-y-auto">
        {currentQuestion.header && (
          <div className="text-xs mb-1" style={{ color: colors.textMuted }}>{currentQuestion.header}</div>
        )}
        <div className="text-sm mb-4" style={{ color: colors.textPrimary }}>{currentQuestion.question}</div>

        {/* Options */}
        <div className="space-y-1.5">
          {currentQuestion.options.map((option: AskOption) => {
            const isSelected = currentAnswers.includes(option.label);
            return (
              <button
                key={option.label}
                onClick={() => handleToggle(option.label)}
                disabled={readOnly}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex items-start gap-2.5 border ${
                  readOnly ? 'cursor-default' : 'cursor-pointer'
                }`}
                style={{
                  background: isSelected ? colors.bgCard : colors.bgCardHover,
                  color: isSelected ? colors.textPrimary : colors.textSecondary,
                  borderColor: isSelected ? colors.borderMedium : 'transparent',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = colors.bgCard; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = colors.bgCardHover; }}
              >
                <span className="mt-0.5 flex-shrink-0">
                  {currentQuestion.multiSelect ? (
                    <span className="w-4 h-4 border flex items-center justify-center transition-colors"
                      style={{
                        borderColor: isSelected ? colors.textPrimary : colors.borderMedium,
                        background: isSelected ? colors.accentPrimary : 'transparent',
                      }}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={colors.textInverse} strokeWidth="2">
                          <path d="M1.5 5.5L3.5 7.5L8.5 2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                  ) : (
                    <span className="w-4 h-4 rounded-full border flex items-center justify-center transition-colors"
                      style={{ borderColor: isSelected ? colors.textPrimary : colors.borderMedium }}
                    >
                      {isSelected && <span className="w-2 h-2 rounded-full" style={{ background: colors.textPrimary }} />}
                    </span>
                  )}
                </span>
                <span className="flex-1">
                  <span className="font-medium">{option.label}</span>
                  {option.description && (
                    <span className="ml-1" style={{ color: colors.textMuted }}>{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="px-3 py-3 border-t" style={{ borderColor: colors.borderLight }}>
        <div className="flex items-center justify-between">
          <div>
            {currentIndex > 0 ? (
              <button
                onClick={() => setCurrentIndex(currentIndex - 1)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                style={{ color: colors.textSecondary }}
                onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.background = colors.bgCardHover; }}
                onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.background = 'transparent'; }}
              >
                ← 上一题
              </button>
            ) : readOnly ? (
              <div />
            ) : (
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                style={{ color: colors.textSecondary }}
                onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; e.currentTarget.style.background = colors.bgCardHover; }}
                onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.background = 'transparent'; }}
              >
                取消
              </button>
            )}
          </div>
          <div>
            {readOnly ? (
              currentIndex < questions.length - 1 ? (
                <button
                  onClick={() => setCurrentIndex(currentIndex + 1)}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg transition-all"
                  style={{ color: colors.textInverse, background: colors.textPrimary }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                >
                  下一题 →
                </button>
              ) : (
                <div className="px-4 py-1.5 text-xs font-medium" style={{ color: colors.textMuted }}>
                  已结束
                </div>
              )
            ) : currentIndex < questions.length - 1 ? (
              <button
                onClick={() => setCurrentIndex(currentIndex + 1)}
                disabled={currentAnswers.length === 0}
                className="px-4 py-1.5 text-xs font-medium rounded-lg transition-all"
                style={{ color: colors.textInverse, background: colors.textPrimary, opacity: currentAnswers.length === 0 ? 0.4 : 1 }}
                onMouseEnter={e => { if (currentAnswers.length > 0) e.currentTarget.style.opacity = '0.9'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = currentAnswers.length === 0 ? '0.4' : '1'; }}
              >
                下一题 →
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!canSubmit}
                className="px-4 py-1.5 text-xs font-medium rounded-lg transition-all"
                style={{ color: colors.textInverse, background: colors.textPrimary, opacity: !canSubmit ? 0.4 : 1 }}
                onMouseEnter={e => { if (canSubmit) e.currentTarget.style.opacity = '0.9'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = canSubmit ? '1' : '0.4'; }}
              >
                提交
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Parse AskUserQuestion answers from content
function parseAskAnswers(content: string): string[][] | null {
  try {
    const jsonMatch = content.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.answers && Array.isArray(parsed.answers)) {
        return parsed.answers as string[][];
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Truncated content component with expand/collapse
function Truncatable({ content, maxHeight = 150 }: { content: React.ReactNode; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsTruncate, setNeedsTruncate] = useState(false);
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);

  useEffect(() => {
    if (contentRef.current) {
      setNeedsTruncate(contentRef.current.scrollHeight > maxHeight);
    }
  }, [content, maxHeight]);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={`overflow-hidden transition-all ${!expanded && needsTruncate ? `max-h-[${maxHeight}px]` : ''}`}
        style={{ maxHeight: !expanded && needsTruncate ? maxHeight : undefined }}
      >
        {content}
      </div>
      {!expanded && needsTruncate && (
        <div className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none" style={{ background: `linear-gradient(to top, ${colors.bgMain}, transparent)` }} />
      )}
      {needsTruncate && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-1 py-1.5 text-xs rounded transition-colors"
          style={{ color: colors.textMuted, background: colors.bgCard }}
          onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; }}
          onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; }}
        >
          {expanded ? '收起' : '展开更多'}
        </button>
      )}
    </div>
  );
}

// Bash tool card
function BashToolCard({ command, description }: { command?: string; description?: string }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  const isDark = theme === 'dark';
  const codeBg = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)';
  const codeText = isDark ? '#4ade80' : '#166534';
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: msgColors.bash.bg, borderLeft: `3px solid ${msgColors.bash.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold" style={{ color: msgColors.bash.text }}>$ Bash</span>
      </div>
      {description && (
        <div className="text-xs mb-2 italic" style={{ color: colors.textMuted }}>{description}</div>
      )}
      {command && (
        <Truncatable content={
          <pre className="rounded px-2 py-1.5 font-mono text-sm whitespace-pre-wrap overflow-x-auto" style={{ background: codeBg, color: codeText }}>
            {command}
          </pre>
        } />
      )}
    </div>
  );
}

// Write tool card
function WriteToolCard({ filePath, content }: { filePath?: string; content?: string }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  const isDark = theme === 'dark';
  const codeBg = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)';
  const filename = filePath?.split('/').pop() || filePath;
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: msgColors.write.bg, borderLeft: `3px solid ${msgColors.write.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">📝</span>
        <span className="text-xs font-semibold" style={{ color: msgColors.write.text }}>Write</span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: colors.bgCardHover, color: msgColors.write.text }}>
          {filename}
        </span>
      </div>
      {filePath && filePath !== filename && (
        <div className="text-xs font-mono mb-2 truncate" style={{ color: colors.textMuted }}>{filePath}</div>
      )}
      {content && (
        <Truncatable content={
          <pre className="rounded px-2 py-1.5 font-mono text-sm whitespace-pre-wrap overflow-x-auto" style={{ background: codeBg, color: colors.textPrimary }}>
            {content.slice(0, 500)}{content.length > 500 && '...'}
          </pre>
        } />
      )}
    </div>
  );
}

// Edit tool card with diff style
function EditToolCard({ filePath, oldString, newString, replaceAll }: { filePath?: string; oldString?: string; newString?: string; replaceAll?: boolean }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  const isDark = theme === 'dark';
  const diffRemovedBg = isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.08)';
  const diffRemovedText = isDark ? '#fca5a5' : '#b91c1c';
  const diffAddedBg = isDark ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.08)';
  const diffAddedText = isDark ? '#86efac' : '#166534';
  const filename = filePath?.split('/').pop() || filePath;
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: msgColors.edit.bg, borderLeft: `3px solid ${msgColors.edit.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">✏️</span>
        <span className="text-xs font-semibold" style={{ color: msgColors.edit.text }}>Edit</span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: colors.bgCardHover, color: msgColors.edit.text }}>
          {filename}
        </span>
        {replaceAll && <span className="text-xs" style={{ color: colors.textMuted }}>(全部替换)</span>}
      </div>
      {filePath && filePath !== filename && (
        <div className="text-xs font-mono mb-2 truncate" style={{ color: colors.textMuted }}>{filePath}</div>
      )}
      {oldString && (
        <div className="space-y-1">
          <div className="flex items-start gap-2 rounded px-2 py-1.5" style={{ background: diffRemovedBg }}>
            <span className="text-xs font-bold flex-shrink-0" style={{ color: diffRemovedText }}>−</span>
            <pre className="text-sm font-mono whitespace-pre-wrap flex-1 overflow-x-auto" style={{ color: diffRemovedText }}>
              {oldString.slice(0, 200)}{oldString.length > 200 && '...'}
            </pre>
          </div>
          <div className="flex items-start gap-2 rounded px-2 py-1.5" style={{ background: diffAddedBg }}>
            <span className="text-xs font-bold flex-shrink-0" style={{ color: diffAddedText }}>+</span>
            <pre className="text-sm font-mono whitespace-pre-wrap flex-1 overflow-x-auto" style={{ color: diffAddedText }}>
              {newString?.slice(0, 200)}{newString && newString.length > 200 && '...'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Read tool card
function ReadToolCard({ filePath, offset, limit }: { filePath?: string; offset?: number; limit?: number }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  const filename = filePath?.split('/').pop() || filePath;
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: msgColors.toolCall.bg, borderLeft: `3px solid ${msgColors.toolCall.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">📄</span>
        <span className="text-xs font-semibold" style={{ color: msgColors.toolCall.text }}>Read</span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: colors.bgCardHover, color: colors.textSecondary }}>
          {filename}
        </span>
      </div>
      {filePath && filePath !== filename && (
        <div className="text-xs font-mono mb-1 truncate" style={{ color: colors.textMuted }}>{filePath}</div>
      )}
      {(offset || limit) && (
        <div className="text-xs" style={{ color: colors.textMuted }}>
          行 {offset || 1} - {limit ? (offset || 1) + limit - 1 : '末尾'}
        </div>
      )}
    </div>
  );
}

// Generic tool card
function ToolCard({ toolName, description, input }: { toolName: string; description?: string; input?: unknown }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  const isDark = theme === 'dark';
  const codeBg = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)';
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: msgColors.toolCall.bg, borderLeft: `3px solid ${msgColors.toolCall.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">⚙️</span>
        <span className="text-xs font-semibold" style={{ color: msgColors.toolCall.text }}>{toolName}</span>
      </div>
      {description && (
        <div className="text-xs mb-2 italic" style={{ color: colors.textMuted }}>{description}</div>
      )}
      {input !== undefined && input !== null && (
        <Truncatable content={
          <pre className="rounded px-2 py-1.5 font-mono text-sm whitespace-pre-wrap overflow-x-auto" style={{ background: codeBg, color: colors.textSecondary }}>
            {JSON.stringify(input, null, 2)}
          </pre>
        } />
      )}
    </div>
  );
}

// Tool result card
function ToolResultCard({ content, isError }: { content: string; isError?: boolean }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  const mc = isError ? msgColors.toolError : msgColors.toolResult;
  return (
    <div className="rounded-lg p-3 mb-2 ml-3" style={{ background: mc.bg, borderLeft: `3px solid ${mc.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold" style={{ color: mc.text }}>
          {isError ? '❌ Error' : '✓ Result'}
        </span>
      </div>
      <Truncatable content={
        <pre className="text-sm font-mono whitespace-pre-wrap overflow-x-auto" style={{ color: colors.textSecondary }}>
          {content.slice(0, 500)}{content.length > 500 && '...'}
        </pre>
      } />
    </div>
  );
}

// Thinking block
function ThinkingBlock({ content }: { content: string }) {
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: msgColors.thinking.bg, borderLeft: `3px solid ${msgColors.thinking.border}` }}>
      <div className="text-xs font-semibold mb-2" style={{ color: msgColors.thinking.text }}>
        💭 Thinking
      </div>
      <div className="text-xs italic whitespace-pre-wrap" style={{ color: colors.textMuted }}>
        {content.slice(0, 300)}{content.length > 300 && '...'}
      </div>
    </div>
  );
}

// Message header with role label and timestamp
function MessageHeader({ role, timestamp }: { role: string; timestamp: number }) {
  const time = new Date(timestamp);
  const timeStr = time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const isToday = time.toDateString() === new Date().toDateString();
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-t-lg" style={{ background: colors.bgCard }}>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: msgColors[role]?.text || colors.textPrimary }}>
        {role === 'user' ? 'YOU' : role === 'assistant' ? 'CLAUDE' : role}
      </span>
      <span className="text-xs" style={{ color: colors.textMuted }}>
        {isToday ? timeStr : `${dateStr} ${timeStr}`}
      </span>
    </div>
  );
}

// Format tool content for display
function formatToolContent(toolName: string | undefined, content: string): React.ReactNode {
  if (!toolName) return content;

  try {
    let jsonStr = content;
    if (content.includes(':')) {
      const colonIndex = content.indexOf(':');
      jsonStr = content.substring(colonIndex + 1).trim();
    }
    const parsed = JSON.parse(jsonStr);

    switch (toolName) {
      case 'Bash':
        return <BashToolCard command={parsed.command} description={parsed.description} />;
      case 'Read':
        return <ReadToolCard filePath={parsed.file_path} offset={parsed.offset} limit={parsed.limit} />;
      case 'Write':
        return <WriteToolCard filePath={parsed.file_path} content={parsed.content} />;
      case 'Edit':
        return <EditToolCard filePath={parsed.file_path} oldString={parsed.old_string} newString={parsed.new_string} replaceAll={parsed.replace_all} />;
      default:
        return <ToolCard toolName={toolName} description={parsed.description} input={parsed} />;
    }
  } catch {
    return <ToolCard toolName={toolName} input={content} />;
  }
}

interface ChatViewProps {
  sessionId: string;
  projectName: string;
  onClose?: () => void;
}

export function ChatView({ sessionId, projectName, onClose }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingPopup, setPendingPopup] = useState<PopupItem | null>(null);
  const [askAnswers, setAskAnswers] = useState<string[][]>([]);
  const [showThinking, setShowThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const theme = useAppStore(s => s.theme);
  const colors = getTheme(theme);
  const msgColors = getMessageColors(theme === 'dark');

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await invoke<AppSettings>('get_settings');
        setShowThinking(settings.show_thinking_messages);
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    };
    loadSettings();
  }, []);

  // Fetch messages and popups periodically
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [messagesData, popupsData] = await Promise.all([
          invoke<ChatMessage[]>('get_chat_messages', { sessionId }),
          invoke<PopupItem[]>('get_popups'),
        ]);

        setMessages(messagesData);

        const sessionPopup = popupsData.find(
          p => p.session_id === sessionId && p.status === 'pending'
        );
        setPendingPopup(sessionPopup || null);

        if (sessionPopup?.ask_data?.questions && askAnswers.length === 0) {
          setAskAnswers(sessionPopup.ask_data.questions.map(() => []));
        } else if (askAnswers.length === 0) {
          const askMsg = messagesData.find(m => m.toolName === 'AskUserQuestion');
          if (askMsg) {
            const questions = parseAskQuestions(askMsg.content);
            if (questions && questions.length > 0) {
              setAskAnswers(questions.map(() => []));
            }
          }
        }

        const now = Date.now() / 1000;
        const hasRecentActivity = messagesData.some(m =>
          (m.messageType === 'thinking' || m.messageType === 'toolCall') &&
          m.timestamp / 1000 > now - 3
        );
        setIsProcessing(hasRecentActivity);
      } catch (e) {
        console.error('Failed to fetch data:', e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 500);
    return () => clearInterval(interval);
  }, [sessionId, askAnswers.length]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    const filtered = messages.filter(m => showThinking || m.messageType !== 'thinking');
    if (filtered.length > 100) {
      return filtered.slice(-100);
    }
    return filtered;
  }, [messages, showThinking]);

  // Auto scroll to bottom
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      prevMessagesLengthRef.current = messages.length;
    }
  }, [messages]);

  // Handle permission response
  const handleRespond = async (decision: 'allow' | 'deny') => {
    if (!pendingPopup) return;
    try {
      await invoke('respond_popup', {
        popupId: pendingPopup.id,
        decision,
      });
      setPendingPopup(null);
      onClose?.();
    } catch (e) {
      console.error('Response failed:', e);
    }
  };

  // Handle ask response
  const handleAskRespond = async () => {
    const askPopup = messages.find(m => m.toolName === 'AskUserQuestion');
    if (!askPopup) return;

    try {
      const popups = await invoke<PopupItem[]>('get_popups');
      const askPendingPopup = popups.find(
        p => p.session_id === sessionId && p.status === 'pending' && p.type === 'ask'
      );

      if (!askPendingPopup) return;

      await invoke('respond_popup', {
        popupId: askPendingPopup.id,
        answers: askAnswers,
      });
      setAskAnswers([]);
      onClose?.();
    } catch (e) {
      console.error('Response failed:', e);
    }
  };

  return (
    <div className="flex flex-col h-full w-full rounded-b-xl" style={{ background: colors.bgMain }}>
      {/* Top Navigation Bar - only shown when onClose provided (Island mode) */}
      {onClose && (
        <div className="flex items-center px-3 py-2 border-b" style={{ borderColor: colors.borderLight }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex items-center justify-center w-8 h-8 transition-colors"
            style={{ color: colors.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
            </svg>
          </button>
          <span className="ml-2 text-sm font-medium truncate" style={{ color: colors.textSecondary }}>
            {projectName}
          </span>
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin"
      >
        {/* Live ask popup - rendered from pendingPopup directly (because the
            AskUserQuestion message is NOT added to chat_history during the
            blocking PermissionRequest flow). Only render here if there's no
            matching AskUserQuestion message yet, to avoid duplicate wizards. */}
        {pendingPopup?.type === 'ask' &&
          pendingPopup.ask_data?.questions &&
          pendingPopup.ask_data.questions.length > 0 &&
          !filteredMessages.some(m => m.toolName === 'AskUserQuestion') && (
            <div className="mb-3 rounded-lg overflow-hidden" style={{ background: colors.bgCard }}>
              <QuestionWizard
                questions={pendingPopup.ask_data.questions}
                selectedAnswers={askAnswers}
                onChange={setAskAnswers}
                onSubmit={handleAskRespond}
                onCancel={() => handleRespond('deny')}
                readOnly={false}
              />
            </div>
          )}

        {filteredMessages.map((msg) => {
          const askQuestions = msg.toolName === 'AskUserQuestion' ? parseAskQuestions(msg.content) : null;

          if (askQuestions) {
            const hasPendingPopup = pendingPopup?.type === 'ask' && pendingPopup?.ask_data;
            return (
              <div
                key={msg.id}
                className="mb-3 rounded-lg overflow-hidden"
                style={{ background: colors.bgCard }}
              >
                <QuestionWizard
                  questions={askQuestions}
                  selectedAnswers={askAnswers}
                  onChange={setAskAnswers}
                  onSubmit={handleAskRespond}
                  onCancel={() => handleRespond('deny')}
                  readOnly={!hasPendingPopup}
                />
              </div>
            );
          }

          // Tool call
          if (msg.messageType === 'toolCall') {
            return (
              <div key={msg.id} className="mb-2">
                {formatToolContent(msg.toolName, msg.content)}
              </div>
            );
          }

          // User message
          if (msg.messageType === 'user') {
            if (msg.toolName === 'AskUserQuestionAnswer') {
              const answerData = parseAskAnswers(msg.content);
              if (answerData) {
                return (
                  <div key={msg.id} className="mb-3 rounded-lg overflow-hidden" style={{ background: msgColors.user.bg, borderLeft: `3px solid ${msgColors.user.border}` }}>
                    <MessageHeader role="user" timestamp={msg.timestamp} />
                    <div className="p-3">
                      <div className="text-xs mb-2" style={{ color: colors.textMuted }}>Your Answers</div>
                      <div className="space-y-1">
                        {answerData.map((answer, idx) => (
                          <div key={idx} className="text-sm" style={{ color: colors.textPrimary }}>
                            <span style={{ color: colors.textMuted }}>Q{idx + 1}:</span> {answer.join(', ')}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
            }
            return (
              <div key={msg.id} className="mb-3 rounded-lg overflow-hidden" style={{ background: msgColors.user.bg, borderLeft: `3px solid ${msgColors.user.border}` }}>
                <MessageHeader role="user" timestamp={msg.timestamp} />
                <div className="p-3 text-base" style={{ color: colors.textPrimary }}>
                  {msg.content}
                </div>
              </div>
            );
          }

          // Assistant message
          if (msg.messageType === 'assistant') {
            let textContent: string = msg.content;
            try {
              const parsed = JSON.parse(msg.content);
              if (Array.isArray(parsed)) {
                const nonThinkingElements = parsed.filter(el => el.type !== 'thinking');
                if (nonThinkingElements.length > 0) {
                  textContent = nonThinkingElements
                    .map(el => el.type === 'text' && el.text ? el.text : JSON.stringify(el))
                    .join('\n');
                } else {
                  return null;
                }
              }
            } catch {
              // Not JSON, use raw content
            }

            return (
              <div key={msg.id} className="mb-3 rounded-lg overflow-hidden" style={{ background: msgColors.assistant.bg, borderLeft: `3px solid ${msgColors.assistant.border}` }}>
                <MessageHeader role="assistant" timestamp={msg.timestamp} />
                <div className="p-3 text-base markdown-content" style={{ color: colors.textPrimary }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
                </div>
              </div>
            );
          }

          // Thinking messages
          if (msg.messageType === 'thinking') {
            return <ThinkingBlock key={msg.id} content={msg.content} />;
          }

          // Tool result
          if (msg.messageType === 'toolResult') {
            // Try to detect error from content
            const isError = msg.content.toLowerCase().includes('error') || msg.content.toLowerCase().includes('failed');
            return <ToolResultCard key={msg.id} content={msg.content} isError={isError} />;
          }

          // Interrupted
          if (msg.messageType === 'interrupted') {
            return (
              <div key={msg.id} className="mb-3 rounded-lg p-3" style={{ background: msgColors.toolError.bg, borderLeft: `3px solid ${msgColors.toolError.border}` }}>
                <span className="text-xs font-semibold" style={{ color: msgColors.toolError.text }}>
                  ⚠️ Interrupted
                </span>
              </div>
            );
          }

          return null;
        })}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-lg" style={{ background: colors.bgCard }}>
            <ProcessingSpinner size={10} />
            <span className="text-xs" style={{ color: colors.textMuted }}>Processing...</span>
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="text-xs text-center py-8" style={{ color: colors.textMuted }}>
            <div className="mb-2">暂无消息</div>
            <div className="text-[10px]" style={{ color: colors.textMuted, opacity: 0.7 }}>
              Chat history shows user input and tool calls.<br/>
              AI responses are displayed in the terminal.
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar - Permission Buttons */}
      {pendingPopup?.type === 'permission' && (
        <div className="px-3 py-3 border-t" style={{ borderColor: colors.borderLight }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold" style={{ color: msgColors.toolCall.text }}>
              {pendingPopup.permission_data?.tool_name}
            </span>
            {pendingPopup.permission_data?.action && (
              <span className="text-xs truncate" style={{ color: colors.textMuted }}>
                {pendingPopup.permission_data.action}
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => handleRespond('deny')}
              className="px-4 py-2 text-xs font-medium rounded-lg transition-all"
              style={{ color: colors.textSecondary, background: colors.bgCardHover }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.6)'; e.currentTarget.style.color = colors.textPrimary; }}
              onMouseLeave={e => { e.currentTarget.style.background = colors.bgCardHover; e.currentTarget.style.color = colors.textSecondary; }}
            >
              Deny
            </button>
            <button
              onClick={() => handleRespond('allow')}
              className="px-4 py-2 text-xs font-medium rounded-lg transition-all"
              style={{ color: colors.textInverse, background: colors.textPrimary }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              Allow
            </button>
          </div>
        </div>
      )}
    </div>
  );
}