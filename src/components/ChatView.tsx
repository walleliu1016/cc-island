import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { PopupItem, AskQuestion, AskOption, FullChatMessage, ToolUseBlock, ToolResultBlock } from '../types';
import { ProcessingSpinner } from './StatusIcons';
import { MarkdownText } from './MarkdownRenderer';

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

  const goToPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const canGoNext = currentAnswers.length > 0;
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
                onClick={goToPrev}
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
                  onClick={goToNext}
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
                onClick={goToNext}
                disabled={!canGoNext}
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

// ============== New Message Views (Swift Style) ==============

// User Message View - Right-aligned bubble, white/15% opacity background
function UserMessageView({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] px-2 py-1.5 rounded-2xl bg-white/[0.15]">
        <MarkdownText text={text} colorClass="text-white" fontSize="text-xs" />
      </div>
    </div>
  );
}

// Interrupted Message View
function InterruptedMessageView() {
  return (
    <div className="text-xs text-red-500">
      Interrupted
    </div>
  );
}

// Tool Call View - Status dot + tool name + preview, expandable
function ToolCallView({ block }: { block: ToolUseBlock }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Generate preview from input
  const preview = block.input.file_path ||
    block.input.command ||
    block.input.pattern ||
    Object.values(block.input)[0] || '';

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className="flex items-center gap-1 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
        <span className="text-[11px] font-medium text-amber-500">{block.name}</span>
        <span className="text-[11px] text-white/60 truncate flex-1 max-w-[200px]">
          {preview.slice(0, 50)}
        </span>
        <motion.span
          className="text-white/30 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          →
        </motion.span>
      </div>
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="ml-2 text-[11px] text-white/50 bg-white/[0.05] rounded p-1.5 mt-0.5"
        >
          {Object.entries(block.input).map(([key, value]) => (
            <div key={key}>
              <span className="text-white/30">{key}: </span>
              <span className="text-white/60 truncate">{String(value).slice(0, 100)}</span>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

// Tool Result View - Claude format: ⎿ result indented below
function ToolResultView({ block }: { block: ToolResultBlock }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Determine what content to show
  let displayContent = '';
  let isLongContent = false;

  // Use stdout/stderr if available (from toolUseResult)
  if (block.stdout && block.stdout.length > 0) {
    displayContent = block.stdout;
    if (block.stderr && block.stderr.length > 0) {
      displayContent += '\n[stderr]\n' + block.stderr;
    }
  } else if (block.stderr && block.stderr.length > 0) {
    displayContent = block.stderr;
  } else if (block.content) {
    displayContent = block.content;
  }

  // Handle special cases
  if (block.noOutputExpected && displayContent.includes('(completed with no output)')) {
    displayContent = '';  // Don't show "(completed with no output)" text
  }

  if (block.interrupted) {
    displayContent = '[interrupted]';
  }

  if (block.returnCodeInterpretation) {
    displayContent = block.returnCodeInterpretation;
  }

  if (block.backgroundTaskId) {
    displayContent = `[background: ${block.backgroundTaskId}]`;
  }

  isLongContent = displayContent.length > 200;

  // If no content to display, show status only
  if (!displayContent || displayContent.length === 0) {
    return (
      <div className="flex items-start gap-1 ml-2">
        <span className="text-white/30 text-[11px]">⎿</span>
        <span className={`text-[11px] ${block.is_error ? 'text-red-400/70' : 'text-green-400/70'}`}>
          {block.is_error ? 'Error' : 'Done'}
        </span>
      </div>
    );
  }

  const previewContent = isLongContent && !isExpanded
    ? displayContent.slice(0, 200) + '...'
    : displayContent;

  return (
    <div className="flex items-start gap-1 ml-2">
      <span className="text-white/30 text-[11px] flex-shrink-0">⎿</span>
      <div className="flex-1 min-w-0">
        <div className={`text-[11px] font-mono ${
          block.is_error ? 'text-red-400/80' : 'text-white/70'
        } bg-white/[0.04] px-1.5 py-1 rounded ${
          !isExpanded && isLongContent ? 'max-h-20 overflow-hidden' : ''
        }`}>
          <pre className="whitespace-pre-wrap break-all">{previewContent}</pre>
        </div>
        {isLongContent && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[10px] text-white/40 hover:text-white/70 mt-0.5"
          >
            {isExpanded ? '收起' : '展开'}
          </button>
        )}
      </div>
    </div>
  );
}

// Processing Indicator View - Claude orange spinner + "Processing..."
function ProcessingIndicatorView() {
  return (
    <div className="flex items-center gap-1.5">
      <ProcessingSpinner size={6} />
      <span className="text-xs text-[#d97857]">Processing...</span>
    </div>
  );
}

// ============== Main ChatView ==============

interface ChatViewProps {
  sessionId: string;
  cwd: string;
  projectName: string;
  onClose?: () => void;
}

export function ChatView({ sessionId, cwd, projectName, onClose }: ChatViewProps) {
  const [messages, setMessages] = useState<FullChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingPopup, setPendingPopup] = useState<PopupItem | null>(null);
  const [askAnswers, setAskAnswers] = useState<string[][]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch messages and popups periodically
  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('ChatView fetching data:', { sessionId, cwd });
        if (!cwd) {
          console.warn('ChatView: cwd is empty, skipping fetch');
          return;
        }

        // Try Tauri invoke first, fallback to HTTP API
        let fullChatData: FullChatMessage[];
        try {
          fullChatData = await invoke<FullChatMessage[]>('get_full_chat', { sessionId, cwd });
          console.log('ChatView received from Tauri:', { messagesCount: fullChatData.length });
        } catch (tauriError) {
          console.warn('Tauri invoke failed, using HTTP API:', tauriError);
          const response = await fetch(`http://localhost:17527/full_chat?session_id=${sessionId}&cwd=${encodeURIComponent(cwd)}`);
          fullChatData = await response.json();
          console.log('ChatView received from HTTP:', { messagesCount: fullChatData.length });
        }

        const popupsData = await invoke<PopupItem[]>('get_popups');

        console.log('ChatView full data:', {
          messagesCount: fullChatData.length,
          messages: fullChatData.slice(0, 3),
          popupsCount: popupsData.length
        });

        setMessages(fullChatData);

        // Find pending popup for this session
        const sessionPopup = popupsData.find(
          p => p.session_id === sessionId && p.status === 'pending'
        );
        setPendingPopup(sessionPopup || null);

        // Initialize ask answers from popup
        if (sessionPopup?.ask_data?.questions && askAnswers.length === 0) {
          setAskAnswers(sessionPopup.ask_data.questions.map(() => []));
        }

        // Check if processing (last message is assistant with no complete content)
        const lastMsg = fullChatData[fullChatData.length - 1];
        const isLastAssistant = lastMsg?.role === 'assistant';
        const hasIncompleteTool = lastMsg?.content.some(b =>
          b.type === 'tooluse' && typeof b.data !== 'string'
        );
        setIsProcessing(isLastAssistant && hasIncompleteTool);
      } catch (e) {
        console.error('Failed to fetch data:', e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 500);
    return () => clearInterval(interval);
  }, [sessionId, cwd, askAnswers.length]);

  // Auto scroll to bottom when new messages arrive
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
    try {
      const popups = await invoke<PopupItem[]>('get_popups');
      const askPendingPopup = popups.find(
        p => p.session_id === sessionId && p.status === 'pending' && p.type === 'ask'
      );

      if (!askPendingPopup) {
        console.log('No pending ask popup found');
        return;
      }

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
    <div className="flex flex-col h-full bg-black w-full rounded-b-xl">
      {/* Top Navigation Bar */}
      <div className="flex items-center px-2 py-1.5 border-b border-white/10 bg-black/20">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          className="flex items-center justify-center w-6 h-6 text-white/50 hover:text-white/80 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M12.707 5.293a1 1 0 0 0-1.414-1.414l-5 5a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414-1.414L8.414 10l4.293-4.293z"/>
          </svg>
        </button>
        <span className="ml-1.5 text-xs font-medium text-white/80 truncate">
          {projectName}
        </span>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-2 py-1.5 scrollbar-thin"
      >
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-2"
            >
              {msg.role === 'user' ? (
                // User message - tool results or text
                <div className="space-y-1">
                  {msg.content.map((block, idx) => (
                    <div key={idx}>
                      {block.type === 'text' && typeof block.data === 'string' && (
                        <UserMessageView text={block.data} />
                      )}
                      {block.type === 'toolresult' && typeof block.data !== 'string' && (
                        <ToolResultView block={block.data as ToolResultBlock} />
                      )}
                      {block.type === 'interrupted' && (
                        <InterruptedMessageView />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                // Assistant message - text + tool calls
                <div className="space-y-1">
                  {msg.content.map((block, idx) => (
                    <div key={idx}>
                      {block.type === 'text' && typeof block.data === 'string' && (
                        <MarkdownText text={block.data} colorClass="text-white/90" fontSize="text-xs" />
                      )}
                      {block.type === 'tooluse' && typeof block.data !== 'string' && (
                        <ToolCallView block={block.data as ToolUseBlock} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Processing indicator */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-2"
          >
            <ProcessingIndicatorView />
          </motion.div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="text-white/30 text-xs text-center py-4">
            <div className="mb-1">No messages yet</div>
            <div className="text-white/20 text-[10px]">
              Chat history shows full conversation from JSONL file.
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar - Permission Buttons */}
      {pendingPopup?.type === 'permission' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-2 py-2 border-t border-white/10 bg-black/20"
        >
          <div className="flex items-center gap-1 mb-2">
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-medium text-amber-500">
              {pendingPopup.permission_data?.tool_name}
            </span>
            {pendingPopup.permission_data?.action && (
              <span className="text-[11px] text-white/40 truncate">
                {pendingPopup.permission_data.action}
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => handleRespond('deny')}
              className="px-3 py-1.5 text-xs font-medium text-white/70 bg-white/10 hover:bg-red-500/80 hover:text-white rounded-lg transition-all"
            >
              Deny
            </button>
            <button
              onClick={() => handleRespond('allow')}
              className="px-3 py-1.5 text-xs font-medium text-black bg-white hover:bg-white/90 rounded-lg transition-all"
            >
              Allow
            </button>
          </div>
        </motion.div>
      )}

      {/* Ask User Question Bar */}
      {pendingPopup?.type === 'ask' && pendingPopup.ask_data && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-2 py-2 border-t border-white/10 bg-black/20"
        >
          <QuestionWizard
            questions={pendingPopup.ask_data.questions}
            selectedAnswers={askAnswers}
            onChange={setAskAnswers}
            onSubmit={handleAskRespond}
            onCancel={() => handleRespond('deny')}
          />
        </motion.div>
      )}
    </div>
  );
}