import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage, PopupItem, AskQuestion, AskOption } from '../types';
import { ProcessingSpinner } from './StatusIcons';

// Terminal-style colors
const Colors = {
  user: '#d97857',        // Claude orange
  assistant: '#66c075',   // Green
  toolCall: '#ffb700',    // Amber for tool name
  toolResult: '#66c075',  // Green
  thinking: '#ffb700',    // Amber
  interrupted: '#ff4d4d', // Red
  dim: 'rgba(255,255,255,0.4)',
  codeBg: 'rgba(255,255,255,0.05)',
};

// Parse AskUserQuestion content
function parseAskQuestions(content: string): AskQuestion[] | null {
  try {
    // Content format: "AskUserQuestion: {json}" or just "{json}"
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
      // Multi-select: toggle
      if (newAnswers[currentIndex].includes(label)) {
        newAnswers[currentIndex] = newAnswers[currentIndex].filter(a => a !== label);
      } else {
        newAnswers[currentIndex] = [...newAnswers[currentIndex], label];
      }
    } else {
      // Single-select: replace
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
                    // Checkbox for multi-select (square)
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
                    // Radio for single-select
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
          {/* Left: Prev button or Cancel */}
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

          {/* Right: Next or Submit */}
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

// Parse AskUserQuestion answers from content
function parseAskAnswers(content: string): string[][] | null {
  try {
    // Content format: "AskUserQuestion Answers: {"answers": [["A", "B"], ["C"]]}"
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
// Format tool content for display - human readable format
function formatToolContent(toolName: string | undefined, content: string): React.ReactNode {
  if (!toolName) return content;

  try {
    // Content format: "ToolName: {json}"
    let jsonStr = content;
    if (content.includes(':')) {
      const colonIndex = content.indexOf(':');
      jsonStr = content.substring(colonIndex + 1).trim();
    }
    const parsed = JSON.parse(jsonStr);

    switch (toolName) {
      case 'Bash':
        return formatBashTool(parsed);
      case 'Read':
        return formatReadTool(parsed);
      case 'Write':
        return formatWriteTool(parsed);
      case 'Edit':
        return formatEditTool(parsed);
      case 'WebFetch':
        return formatWebFetchTool(parsed);
      case 'WebSearch':
        return formatWebSearchTool(parsed);
      case 'Glob':
        return formatGlobTool(parsed);
      case 'Grep':
        return formatGrepTool(parsed);
      default:
        return JSON.stringify(parsed, null, 2);
    }
  } catch {
    return content;
  }
}

// Bash: Show command with description
function formatBashTool(input: { command?: string; description?: string; timeout?: number }): React.ReactNode {
  return (
    <div className="space-y-2">
      {input.description && (
        <div className="text-xs text-white/50">{input.description}</div>
      )}
      {input.command && (
        <div className="bg-black/30 rounded px-2 py-1.5 font-mono text-xs text-green-400/90 whitespace-pre-wrap">
          {input.command}
        </div>
      )}
    </div>
  );
}

// Read: Show file path with line info
function formatReadTool(input: { file_path?: string; offset?: number; limit?: number }): React.ReactNode {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/40">
          <path d="M2 2a1 1 0 0 1 1-1h4l3 3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2z"/>
        </svg>
        <span className="text-white/70">{input.file_path}</span>
      </div>
      {(input.offset || input.limit) && (
        <div className="text-xs text-white/40">
          Lines {input.offset || 1}-{input.limit ? (input.offset || 1) + input.limit - 1 : 'end'}
        </div>
      )}
    </div>
  );
}

// Write: Show file path and preview content
function formatWriteTool(input: { file_path?: string; content?: string }): React.ReactNode {
  const preview = input.content?.slice(0, 200) || '';
  const hasMore = input.content && input.content.length > 200;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/40">
          <path d="M2 2a1 1 0 0 1 1-1h4l3 3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2z"/>
        </svg>
        <span className="text-white/70">{input.file_path}</span>
      </div>
      {preview && (
        <div className="bg-black/30 rounded px-2 py-1.5 font-mono text-xs text-white/60 whitespace-pre-wrap">
          {preview}{hasMore && '...'}
        </div>
      )}
    </div>
  );
}

// Edit: Show file path and change summary
function formatEditTool(input: { file_path?: string; old_string?: string; new_string?: string; replace_all?: boolean }): React.ReactNode {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/40">
          <path d="M2 2a1 1 0 0 1 1-1h4l3 3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2z"/>
        </svg>
        <span className="text-white/70">{input.file_path}</span>
        {input.replace_all && <span className="text-amber-400/80">(replace all)</span>}
      </div>
      {input.old_string && (
        <div className="space-y-1">
          <div className="text-xs text-red-400/70">− {input.old_string.slice(0, 50)}{input.old_string.length > 50 && '...'}</div>
          <div className="text-xs text-green-400/70">+ {input.new_string?.slice(0, 50)}{input.new_string && input.new_string.length > 50 && '...'}</div>
        </div>
      )}
    </div>
  );
}

// WebFetch: Show URL
function formatWebFetchTool(input: { url?: string; prompt?: string }): React.ReactNode {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-blue-400/80">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 0a6 6 0 0 1 6 6 6 6 0 0 1-6 6 6 6 0 0 1-6-6 6 6 0 0 1 6-6zm0 1a5 5 0 0 0-5 5 5 5 0 0 0 5 5 5 5 0 0 0 5-5 5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1 3-3z"/>
        </svg>
        <span className="truncate">{input.url}</span>
      </div>
      {input.prompt && <div className="text-xs text-white/40">{input.prompt}</div>}
    </div>
  );
}

// WebSearch: Show query
function formatWebSearchTool(input: { query?: string }): React.ReactNode {
  return (
    <div className="text-xs">
      <span className="text-white/40">Search:</span>{' '}
      <span className="text-white/70">{input.query}</span>
    </div>
  );
}

// Glob: Show pattern
function formatGlobTool(input: { pattern?: string; path?: string }): React.ReactNode {
  return (
    <div className="text-xs">
      <span className="text-white/40">Pattern:</span>{' '}
      <span className="text-white/70">{input.path}/{input.pattern}</span>
    </div>
  );
}

// Grep: Show pattern and path
function formatGrepTool(input: { pattern?: string; path?: string; output_mode?: string }): React.ReactNode {
  return (
    <div className="space-y-1">
      <div className="text-xs">
        <span className="text-white/40">Pattern:</span>{' '}
        <span className="text-amber-400/80">{input.pattern}</span>
      </div>
      <div className="text-xs text-white/50">in {input.path}</div>
    </div>
  );
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch messages and popups periodically
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [messagesData, popupsData] = await Promise.all([
          invoke<ChatMessage[]>('get_chat_messages', { sessionId }),
          invoke<PopupItem[]>('get_popups'),
        ]);

        setMessages(messagesData);

        // Find pending popup for this session
        const sessionPopup = popupsData.find(
          p => p.session_id === sessionId && p.status === 'pending'
        );
        setPendingPopup(sessionPopup || null);

        // Initialize ask answers from popup or from messages
        if (sessionPopup?.ask_data?.questions && askAnswers.length === 0) {
          setAskAnswers(sessionPopup.ask_data.questions.map(() => []));
        } else if (askAnswers.length === 0) {
          // Check messages for AskUserQuestion
          const askMsg = messagesData.find(m => m.toolName === 'AskUserQuestion');
          if (askMsg) {
            const questions = parseAskQuestions(askMsg.content);
            if (questions && questions.length > 0) {
              setAskAnswers(questions.map(() => []));
            }
          }
        }

        // Check if processing
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

  // Auto scroll to bottom only when new messages arrive
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
    // Only submit if we have a pending ask popup for this session
    const askPopup = messages.find(m => m.toolName === 'AskUserQuestion');
    if (!askPopup) return;

    // Find the pending popup by checking if there's an ask popup for this session
    try {
      // Get latest popups to find the ask popup
      const popups = await invoke<PopupItem[]>('get_popups');
      const askPendingPopup = popups.find(
        p => p.session_id === sessionId && p.status === 'pending' && p.type === 'ask'
      );

      if (!askPendingPopup) {
        console.log('No pending ask popup found, cannot submit');
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
        <AnimatePresence>
          {messages.map((msg) => {
            // Check if this is an AskUserQuestion
            const askQuestions = msg.toolName === 'AskUserQuestion' ? parseAskQuestions(msg.content) : null;

            if (askQuestions) {
              // Check if this AskUserQuestion has a pending popup
              const hasPendingPopup = pendingPopup?.type === 'ask' && pendingPopup?.ask_data;

              // Use QuestionWizard for interactive question answering
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
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
                </motion.div>
              );
            }

            // Regular tool call
            if (msg.messageType === 'toolCall') {
              const formatted = formatToolContent(msg.toolName, msg.content);
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-3"
                >
                  <div className="py-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: Colors.toolCall }}>
                        {msg.toolName}
                      </span>
                      <span className="text-xs text-white/40">Waiting for approval...</span>
                    </div>
                    <div className="mt-1.5">
                      {formatted}
                    </div>
                  </div>
                </motion.div>
              );
            }

            // User message
            if (msg.messageType === 'user') {
              // Check if this is an AskUserQuestion answer
              if (msg.toolName === 'AskUserQuestionAnswer') {
                const answerData = parseAskAnswers(msg.content);
                if (answerData) {
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-3"
                    >
                      <div className="py-1">
                        <div className="text-xs text-white/40 mb-1">Your Answers</div>
                        <div className="space-y-1">
                          {answerData.map((answer, idx) => (
                            <div key={idx} className="text-sm text-white/80">
                              <span className="text-white/50">Q{idx + 1}:</span>{' '}
                              {answer.join(', ')}
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  );
                }
              }
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-3"
                >
                  <div className="py-1">
                    <div className="text-xs text-white/40 mb-1">You</div>
                    <div className="text-sm text-white/90">{msg.content}</div>
                  </div>
                </motion.div>
              );
            }

            // Tool result
            if (msg.messageType === 'toolResult') {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-3"
                >
                  <div className="py-1">
                    <div className="text-xs text-white/40 mb-1">Result</div>
                    <div className="text-sm text-white/70">{msg.content}</div>
                  </div>
                </motion.div>
              );
            }

            return null;
          })}
        </AnimatePresence>

        {/* Processing indicator */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 py-2"
          >
            <ProcessingSpinner size={10} />
            <span className="text-white/40 text-xs">Processing...</span>
          </motion.div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="text-white/30 text-xs text-center py-8">
            <div className="mb-2">No messages yet</div>
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
            <span className="text-sm font-medium" style={{ color: Colors.toolCall }}>
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
