// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, PopupItem, AskQuestion, AskOption, AppSettings } from '../types';
import { ProcessingSpinner } from './StatusIcons';

// Message type colors (purple theme)
const MessageColors = {
  user: { bg: 'rgba(124,58,237,0.12)', border: '#7c3aed', text: '#7c3aed' },
  assistant: { bg: 'rgba(255,255,255,0.06)', border: '#9e9e9e', text: '#e0e0e0' },
  thinking: { bg: 'rgba(255, 193, 7, 0.08)', border: '#ffc107', text: '#ffc107' },
  toolCall: { bg: 'rgba(124,58,237,0.12)', border: '#7c3aed', text: '#7c3aed' },
  toolResult: { bg: 'rgba(76, 175, 80, 0.08)', border: '#4caf50', text: '#4caf50' },
  toolError: { bg: 'rgba(244, 67, 54, 0.08)', border: '#f44336', text: '#f44336' },
  write: { bg: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(76, 175, 80, 0.08) 100%)', border: '#4caf50', text: '#7c3aed' },
  edit: { bg: 'linear-gradient(135deg, rgba(255, 152, 0, 0.08) 0%, rgba(244, 67, 54, 0.08) 100%)', border: '#ff9800', text: '#e65100' },
  bash: { bg: 'rgba(124,58,237,0.12)', border: '#7c3aed', text: '#7c3aed' },
  todo: { bg: 'linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, rgba(139, 195, 74, 0.08) 100%)', border: '#81c784', text: '#2e7d32' },
};

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="text-xs text-white/50">
          问题 {currentIndex + 1} / {questions.length}
        </div>
        <div className="flex items-center gap-1">
          {questions.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                idx === currentIndex ? 'bg-white' :
                idx < currentIndex ? 'bg-white/50' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Question Content */}
      <div className="flex-1 px-3 py-3 overflow-y-auto">
        {currentQuestion.header && (
          <div className="text-xs text-white/40 mb-1">{currentQuestion.header}</div>
        )}
        <div className="text-sm text-white/90 mb-4">{currentQuestion.question}</div>

        {/* Options */}
        <div className="space-y-1.5">
          {currentQuestion.options.map((option: AskOption) => {
            const isSelected = currentAnswers.includes(option.label);
            return (
              <button
                key={option.label}
                onClick={() => handleToggle(option.label)}
                disabled={readOnly}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex items-start gap-2.5 ${
                  isSelected
                    ? 'bg-white/20 text-white border border-white/30'
                    : 'bg-white/5 text-white/70 hover:bg-white/10 border border-transparent'
                } ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className="mt-0.5 flex-shrink-0">
                  {currentQuestion.multiSelect ? (
                    <span className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                      isSelected ? 'border-white bg-white/40' : 'border-white/30 bg-transparent'
                    }`}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1.5 5.5L3.5 7.5L8.5 2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                  ) : (
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected ? 'border-white' : 'border-white/30'
                    }`}>
                      {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
                    </span>
                  )}
                </span>
                <span className="flex-1">
                  <span className="font-medium">{option.label}</span>
                  {option.description && (
                    <span className="text-white/50 ml-1">{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="px-3 py-3 border-t border-white/10">
        <div className="flex items-center justify-between">
          <div>
            {currentIndex > 0 ? (
              <button
                onClick={() => setCurrentIndex(currentIndex - 1)}
                className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all"
              >
                ← 上一题
              </button>
            ) : readOnly ? (
              <div />
            ) : (
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all"
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
                  className="px-4 py-1.5 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-all"
                >
                  下一题 →
                </button>
              ) : (
                <div className="px-4 py-1.5 text-xs font-medium text-white/50">
                  已结束
                </div>
              )
            ) : currentIndex < questions.length - 1 ? (
              <button
                onClick={() => setCurrentIndex(currentIndex + 1)}
                disabled={currentAnswers.length === 0}
                className="px-4 py-1.5 text-xs font-medium text-black bg-white hover:bg-white/90 disabled:bg-white/40 rounded-lg transition-all"
              >
                下一题 →
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!canSubmit}
                className="px-4 py-1.5 text-xs font-medium text-black bg-white hover:bg-white/90 disabled:bg-white/40 rounded-lg transition-all"
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
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
      )}
      {needsTruncate && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-1 py-1.5 text-xs text-white/50 hover:text-white/70 bg-white/5 rounded transition-colors"
        >
          {expanded ? '收起' : '展开更多'}
        </button>
      )}
    </div>
  );
}

// Bash tool card
function BashToolCard({ command, description }: { command?: string; description?: string }) {
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: MessageColors.bash.bg, borderLeft: `3px solid ${MessageColors.bash.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold" style={{ color: MessageColors.bash.text }}>$ Bash</span>
      </div>
      {description && (
        <div className="text-xs text-white/50 mb-2 italic">{description}</div>
      )}
      {command && (
        <Truncatable content={
          <pre className="bg-black/40 rounded px-2 py-1.5 font-mono text-xs text-green-400/90 whitespace-pre-wrap overflow-x-auto">
            {command}
          </pre>
        } />
      )}
    </div>
  );
}

// Write tool card
function WriteToolCard({ filePath, content }: { filePath?: string; content?: string }) {
  const filename = filePath?.split('/').pop() || filePath;
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: MessageColors.write.bg, borderLeft: `3px solid ${MessageColors.write.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">📝</span>
        <span className="text-xs font-semibold" style={{ color: MessageColors.write.text }}>Write</span>
        <span className="text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded" style={{ color: MessageColors.write.text }}>
          {filename}
        </span>
      </div>
      {filePath && filePath !== filename && (
        <div className="text-xs text-white/40 font-mono mb-2 truncate">{filePath}</div>
      )}
      {content && (
        <Truncatable content={
          <pre className="bg-black/40 rounded px-2 py-1.5 font-mono text-xs text-white/80 whitespace-pre-wrap overflow-x-auto">
            {content.slice(0, 500)}{content.length > 500 && '...'}
          </pre>
        } />
      )}
    </div>
  );
}

// Edit tool card with diff style
function EditToolCard({ filePath, oldString, newString, replaceAll }: { filePath?: string; oldString?: string; newString?: string; replaceAll?: boolean }) {
  const filename = filePath?.split('/').pop() || filePath;
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: MessageColors.edit.bg, borderLeft: `3px solid ${MessageColors.edit.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">✏️</span>
        <span className="text-xs font-semibold" style={{ color: MessageColors.edit.text }}>Edit</span>
        <span className="text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded" style={{ color: MessageColors.edit.text }}>
          {filename}
        </span>
        {replaceAll && <span className="text-xs text-white/40">(全部替换)</span>}
      </div>
      {filePath && filePath !== filename && (
        <div className="text-xs text-white/40 font-mono mb-2 truncate">{filePath}</div>
      )}
      {oldString && (
        <div className="space-y-1">
          <div className="flex items-start gap-2 bg-red-500/10 rounded px-2 py-1.5">
            <span className="text-xs font-bold text-red-400/80 flex-shrink-0">−</span>
            <pre className="text-xs text-red-300/80 font-mono whitespace-pre-wrap flex-1 overflow-x-auto">
              {oldString.slice(0, 200)}{oldString.length > 200 && '...'}
            </pre>
          </div>
          <div className="flex items-start gap-2 bg-green-500/10 rounded px-2 py-1.5">
            <span className="text-xs font-bold text-green-400/80 flex-shrink-0">+</span>
            <pre className="text-xs text-green-300/80 font-mono whitespace-pre-wrap flex-1 overflow-x-auto">
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
  const filename = filePath?.split('/').pop() || filePath;
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: MessageColors.toolCall.bg, borderLeft: `3px solid ${MessageColors.toolCall.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">📄</span>
        <span className="text-xs font-semibold" style={{ color: MessageColors.toolCall.text }}>Read</span>
        <span className="text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded text-white/70">
          {filename}
        </span>
      </div>
      {filePath && filePath !== filename && (
        <div className="text-xs text-white/40 font-mono mb-1 truncate">{filePath}</div>
      )}
      {(offset || limit) && (
        <div className="text-xs text-white/40">
          行 {offset || 1} - {limit ? (offset || 1) + limit - 1 : '末尾'}
        </div>
      )}
    </div>
  );
}

// Generic tool card
function ToolCard({ toolName, description, input }: { toolName: string; description?: string; input?: unknown }) {
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: MessageColors.toolCall.bg, borderLeft: `3px solid ${MessageColors.toolCall.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs">⚙️</span>
        <span className="text-xs font-semibold" style={{ color: MessageColors.toolCall.text }}>{toolName}</span>
      </div>
      {description && (
        <div className="text-xs text-white/50 mb-2 italic">{description}</div>
      )}
      {input !== undefined && input !== null && (
        <Truncatable content={
          <pre className="bg-black/40 rounded px-2 py-1.5 font-mono text-xs text-white/70 whitespace-pre-wrap overflow-x-auto">
            {JSON.stringify(input, null, 2)}
          </pre>
        } />
      )}
    </div>
  );
}

// Tool result card
function ToolResultCard({ content, isError }: { content: string; isError?: boolean }) {
  const colors = isError ? MessageColors.toolError : MessageColors.toolResult;
  return (
    <div className="rounded-lg p-3 mb-2 ml-3" style={{ background: colors.bg, borderLeft: `3px solid ${colors.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold" style={{ color: colors.text }}>
          {isError ? '❌ Error' : '✓ Result'}
        </span>
      </div>
      <Truncatable content={
        <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap overflow-x-auto">
          {content.slice(0, 500)}{content.length > 500 && '...'}
        </pre>
      } />
    </div>
  );
}

// Thinking block
function ThinkingBlock({ content }: { content: string }) {
  return (
    <div className="rounded-lg p-3 mb-2" style={{ background: MessageColors.thinking.bg, borderLeft: `3px solid ${MessageColors.thinking.border}` }}>
      <div className="text-xs font-semibold mb-2" style={{ color: MessageColors.thinking.text }}>
        💭 Thinking
      </div>
      <div className="text-xs text-white/60 italic whitespace-pre-wrap">
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

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-t-lg">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MessageColors[role as keyof typeof MessageColors]?.text || '#fff' }}>
        {role === 'user' ? 'YOU' : role === 'assistant' ? 'CLAUDE' : role}
      </span>
      <span className="text-xs text-white/40">
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
    <div className="flex flex-col h-full bg-[#0f0f23] w-full rounded-b-xl">
      {/* Top Navigation Bar */}
      <div className="flex items-center px-3 py-2 border-b border-white/10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          className="flex items-center justify-center w-8 h-8 text-white/50 hover:text-white/80 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
          </svg>
        </button>
        <span className="ml-2 text-sm font-medium text-white/80 truncate">
          {projectName}
        </span>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin"
      >
        {filteredMessages.map((msg) => {
          const askQuestions = msg.toolName === 'AskUserQuestion' ? parseAskQuestions(msg.content) : null;

          if (askQuestions) {
            const hasPendingPopup = pendingPopup?.type === 'ask' && pendingPopup?.ask_data;
            return (
              <div
                key={msg.id}
                className="mb-3 bg-white/5 rounded-lg overflow-hidden"
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
                  <div key={msg.id} className="mb-3 rounded-lg overflow-hidden" style={{ background: MessageColors.user.bg, borderLeft: `3px solid ${MessageColors.user.border}` }}>
                    <MessageHeader role="user" timestamp={msg.timestamp} />
                    <div className="p-3">
                      <div className="text-xs text-white/50 mb-2">Your Answers</div>
                      <div className="space-y-1">
                        {answerData.map((answer, idx) => (
                          <div key={idx} className="text-sm text-white/90">
                            <span className="text-white/60">Q{idx + 1}:</span> {answer.join(', ')}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
            }
            return (
              <div key={msg.id} className="mb-3 rounded-lg overflow-hidden" style={{ background: MessageColors.user.bg, borderLeft: `3px solid ${MessageColors.user.border}` }}>
                <MessageHeader role="user" timestamp={msg.timestamp} />
                <div className="p-3 text-sm text-white/90">
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
              <div key={msg.id} className="mb-3 rounded-lg overflow-hidden" style={{ background: MessageColors.assistant.bg, borderLeft: `3px solid ${MessageColors.assistant.border}` }}>
                <MessageHeader role="assistant" timestamp={msg.timestamp} />
                <div className="p-3 text-sm text-white/90 markdown-content">
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
              <div key={msg.id} className="mb-3 rounded-lg p-3" style={{ background: MessageColors.toolError.bg, borderLeft: `3px solid ${MessageColors.toolError.border}` }}>
                <span className="text-xs font-semibold" style={{ color: MessageColors.toolError.text }}>
                  ⚠️ Interrupted
                </span>
              </div>
            );
          }

          return null;
        })}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-white/5">
            <ProcessingSpinner size={10} />
            <span className="text-white/40 text-xs">Processing...</span>
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="text-white/30 text-xs text-center py-8">
            <div className="mb-2">暂无消息</div>
            <div className="text-white/20 text-[10px]">
              Chat history shows user input and tool calls.<br/>
              AI responses are displayed in the terminal.
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar - Permission Buttons */}
      {pendingPopup?.type === 'permission' && (
        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold" style={{ color: MessageColors.toolCall.text }}>
              {pendingPopup.permission_data?.tool_name}
            </span>
            {pendingPopup.permission_data?.action && (
              <span className="text-xs text-white/40 truncate">
                {pendingPopup.permission_data.action}
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => handleRespond('deny')}
              className="px-4 py-2 text-xs font-medium text-white/70 bg-white/10 hover:bg-red-500/80 hover:text-white rounded-lg transition-all"
            >
              Deny
            </button>
            <button
              onClick={() => handleRespond('allow')}
              className="px-4 py-2 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-all"
            >
              Allow
            </button>
          </div>
        </div>
      )}
    </div>
  );
}