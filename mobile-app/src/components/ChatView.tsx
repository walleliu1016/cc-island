// mobile-app/src/components/ChatView.tsx
// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChatMessageData } from '../types'
import ReactMarkdown from 'react-markdown'

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

// Assistant message with markdown rendering and expand/collapse
function AssistantMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const MAX_LENGTH = 300
  const isLong = content.length > MAX_LENGTH
  const displayContent = expanded || !isLong ? content : content.slice(0, MAX_LENGTH)

  return (
    <div className="flex items-start gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-white/60 mt-1.5 flex-shrink-0" />
      <div className="text-sm text-white/90 flex-1 markdown-content">
        <ReactMarkdown>{displayContent}</ReactMarkdown>
        {isLong && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-white/50 mt-1 hover:text-white/70"
          >
            ...展开全文
          </button>
        )}
        {isLong && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-white/50 mt-1 hover:text-white/70"
          >
            收起
          </button>
        )}
      </div>
    </div>
  )
}
function ProcessingSpinner({ size = 12 }: { size?: number }) {
  const [phase, setPhase] = useState(0);
  const symbols = ['·', '✢', '✳', '∗', '✻', '✽'];

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((p) => (p + 1) % symbols.length);
    }, 150);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 'bold',
        color: Colors.user,
        width: size,
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      {symbols[phase]}
    </span>
  );
}

// Ask question types
interface AskOption {
  label: string
  description?: string
}

interface AskQuestion {
  header: string
  question: string
  multi_select: boolean
  options: AskOption[]
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

// Multi-step Question Wizard Component
function QuestionWizard({
  questions,
  selectedAnswers,
  onChange,
  readOnly = false,
  onSubmit
}: {
  questions: AskQuestion[];
  selectedAnswers: string[][];
  onChange: (answers: string[][]) => void;
  readOnly?: boolean
  onSubmit?: () => void
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

    if (currentQuestion.multi_select) {
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

  return (
    <div className="flex flex-col">
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
                  {currentQuestion.multi_select ? (
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
              <div className="px-3 py-1.5 text-xs font-medium text-white/50">
                第一题
              </div>
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
            ) : onSubmit ? (
              <button
                onClick={onSubmit}
                disabled={!canGoNext}
                className="px-4 py-1.5 text-xs font-medium text-black bg-green-500 hover:bg-green-400 disabled:bg-white/40 rounded-lg transition-all"
              >
                提交答案
              </button>
            ) : (
              <div className="px-4 py-1.5 text-xs font-medium text-white/50">
                请在其他端提交
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Format tool content for display - human readable format
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
        return <pre className="bg-black/30 rounded px-2 py-1.5 font-mono text-xs text-white/70 whitespace-pre-wrap">{JSON.stringify(parsed, null, 2)}</pre>;
    }
  } catch {
    return content;
  }
}

// Bash: Show command with description in code block style
function formatBashTool(input: { command?: string; description?: string; timeout?: number }): React.ReactNode {
  return (
    <div className="space-y-2">
      {input.description && (
        <div className="text-xs text-white/50">{input.description}</div>
      )}
      {input.command && (
        <pre className="bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-green-400 whitespace-pre-wrap">
          {input.command}
        </pre>
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
        <code className="text-white/70">{input.file_path}</code>
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
        <code className="text-white/70">{input.file_path}</code>
      </div>
      {preview && (
        <pre className="bg-black/30 rounded px-2 py-1.5 font-mono text-xs text-white/60 whitespace-pre-wrap">
          {preview}{hasMore && '...'}
        </pre>
      )}
    </div>
  );
}

// Edit: Show file path and change summary with diff style
function formatEditTool(input: { file_path?: string; old_string?: string; new_string?: string; replace_all?: boolean }): React.ReactNode {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/40">
          <path d="M2 2a1 1 0 0 1 1-1h4l3 3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2z"/>
        </svg>
        <code className="text-white/70">{input.file_path}</code>
        {input.replace_all && <span className="text-amber-400/80 text-xs">(replace all)</span>}
      </div>
      {input.old_string && (
        <div className="space-y-1 font-mono text-xs">
          <pre className="bg-red-500/10 text-red-400/80 px-2 py-1 rounded">− {input.old_string.slice(0, 100)}{input.old_string.length > 100 && '...'}</pre>
          <pre className="bg-green-500/10 text-green-400/80 px-2 py-1 rounded">+ {input.new_string?.slice(0, 100)}{input.new_string && input.new_string.length > 100 && '...'}</pre>
        </div>
      )}
    </div>
  );
}

// WebFetch: Show URL
function formatWebFetchTool(input: { url?: string; prompt?: string }): React.ReactNode {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-blue-400">
          <path d="M10.5 1.5a1.5 1.5 0 0 1 0 3h-1v1h1a2.5 2.5 0 0 0 0-5h-1v1h1zm-8 0a1.5 1.5 0 0 0 0 3h1v1h-1a2.5 2.5 0 0 1 0-5h1v1h-1z"/>
          <path d="M5 4.5h2v1H5zm0 2h2v1H5z"/>
        </svg>
        <a href={input.url} target="_blank" rel="noopener" className="text-blue-400/80 underline truncate">{input.url}</a>
      </div>
      {input.prompt && <div className="text-xs text-white/40">{input.prompt}</div>}
    </div>
  );
}

// WebSearch: Show query
function formatWebSearchTool(input: { query?: string }): React.ReactNode {
  return (
    <div className="text-xs">
      <span className="text-white/40">Search: </span>
      <span className="text-white/70">{input.query}</span>
    </div>
  );
}

// Glob: Show pattern
function formatGlobTool(input: { pattern?: string; path?: string }): React.ReactNode {
  return (
    <div className="text-xs">
      <span className="text-white/40">Pattern: </span>
      <code className="text-white/70">{input.path}/{input.pattern}</code>
    </div>
  );
}

// Grep: Show pattern and path
function formatGrepTool(input: { pattern?: string; path?: string; output_mode?: string }): React.ReactNode {
  return (
    <div className="space-y-1">
      <div className="text-xs">
        <span className="text-white/40">Pattern: </span>
        <code className="text-amber-400/80">{input.pattern}</code>
      </div>
      <div className="text-xs text-white/50">in <code>{input.path}</code></div>
    </div>
  );
}

interface ChatViewProps {
  projectName: string
  onClose: () => void
  messages: ChatMessageData[]
  pendingHint?: { session_id: string; questions?: AskQuestion[] }
  onSubmitAnswers?: (sessionId: string, answers: string[][]) => void
}

export function ChatView({ projectName, onClose, messages, pendingHint, onSubmitAnswers }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [askAnswers, setAskAnswers] = useState<string[][]>([])
  const [submitted, setSubmitted] = useState(false)

  // Detect processing state
  const isProcessing = messages.some(m =>
    (m.messageType === 'thinking' || m.messageType === 'toolCall') &&
    m.timestamp > Date.now() - 3000
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Initialize ask answers from messages
  useEffect(() => {
    if (askAnswers.length === 0) {
      // Use pendingHint if available (live questions from hook)
      const questions = pendingHint?.questions;
      if (questions && questions.length > 0) {
        setAskAnswers(questions.map(() => []));
      } else {
        // Fallback: parse from messages
        const askMsg = messages.find(m => m.toolName === 'AskUserQuestion');
        if (askMsg) {
          const parsed = parseAskQuestions(askMsg.content);
          if (parsed && parsed.length > 0) {
            setAskAnswers(parsed.map(() => []));
          }
        }
      }
    }
  }, [messages, pendingHint, askAnswers.length]);

  // Dedupe messages by id (same message may be pushed multiple times from incremental updates)
  const uniqueMessages = messages.reduce((acc, msg) => {
    if (!acc.find(m => m.id === msg.id)) {
      acc.push(msg)
    }
    return acc
  }, [] as ChatMessageData[])
  const sortedMessages = [...uniqueMessages].sort((a, b) => a.timestamp - b.timestamp)

  // Debug log
  console.log('[ChatView] messages:', messages.length, 'sorted:', sortedMessages.map(m => ({ id: m.id, type: m.messageType, tool: m.toolName, content: m.content.slice(0, 50) })))

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[#262626]">
        <button onClick={onClose} className="text-[#a3a3a3] mr-3 text-lg">←</button>
        <span className="text-[#f5f5f5] text-lg font-medium truncate flex-1">{projectName}</span>
        <span className="text-[#737373] text-xs">{sortedMessages.length} 条消息</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {/* Processing indicator */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2 py-3"
          >
            <ProcessingSpinner size={12} />
            <span className="text-white/40 text-sm">Processing...</span>
          </motion.div>
        )}

        {/* Empty state */}
        {sortedMessages.length === 0 && !isProcessing && (
          <div className="text-white/30 text-xs text-center py-8">
            <div className="mb-2">No messages yet</div>
            <div className="text-white/20 text-[10px]">
              Chat history shows user input and tool calls.<br/>
              AI responses are displayed in the terminal.
            </div>
          </div>
        )}

        {/* Messages list */}
        {sortedMessages.length > 0 && (
          <AnimatePresence>
            {sortedMessages.map(msg => {
              // Check if this is an AskUserQuestion with pending hint (interactive)
              const askQuestions = msg.toolName === 'AskUserQuestion' ? parseAskQuestions(msg.content) : null;
              const hasPendingAsk = pendingHint?.questions && pendingHint?.questions.length > 0;

              // If we have pending hint for AskUserQuestion, only render the interactive version once
              // Skip rendering the message-based AskUserQuestion to avoid duplicates
              if (askQuestions && hasPendingAsk) {
                // Render interactive version from pendingHint (once)
                return (
                  <motion.div
                    key={`pending-${pendingHint!.session_id}`}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 bg-white/5 rounded-lg overflow-hidden mx-2"
                  >
                    <QuestionWizard
                      questions={pendingHint!.questions!}
                      selectedAnswers={askAnswers}
                      onChange={setAskAnswers}
                      readOnly={submitted}
                      onSubmit={!submitted && onSubmitAnswers ? () => {
                        onSubmitAnswers(pendingHint!.session_id, askAnswers);
                        setSubmitted(true);
                      } : undefined}
                    />
                  </motion.div>
                );
              }

              // If no pending hint but message has AskUserQuestion, render readonly version
              if (askQuestions && !hasPendingAsk) {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 bg-white/5 rounded-lg overflow-hidden mx-2"
                  >
                    <QuestionWizard
                      questions={askQuestions}
                      selectedAnswers={askAnswers}
                      onChange={setAskAnswers}
                      readOnly={true}
                    />
                  </motion.div>
                );
              }

              // User message - RIGHT aligned (same as desktop)
              if (msg.messageType === 'user') {
                // Check if this is an AskUserQuestion answer
                if (msg.toolName === 'AskUserQuestionAnswer') {
                  const answerData = parseAskAnswers(msg.content);
                  if (answerData) {
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="mb-3 flex justify-end"
                      >
                        <div className="max-w-[80%] px-3 py-2 rounded-2xl bg-white/15">
                          <div className="text-xs text-white/50 mb-1">Your Answers</div>
                          <div className="space-y-1">
                            {answerData.map((answer, idx) => (
                              <div key={idx} className="text-sm text-white/90">
                                <span className="text-white/60">Q{idx + 1}: </span>
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
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="mb-3 flex justify-end"
                  >
                    <div className="max-w-[80%] px-3 py-2 rounded-2xl bg-white/15 text-sm text-white/90">
                      {msg.content}
                    </div>
                  </motion.div>
                );
              }

              // Tool call - LEFT aligned (same as desktop)
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
                      </div>
                      <div className="mt-1.5">
                        {formatted}
                      </div>
                    </div>
                  </motion.div>
                );
              }

              // Tool result - LEFT aligned, compact (same as desktop)
              if (msg.messageType === 'toolResult') {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-2"
                  >
                    <div className="flex items-start gap-2 pl-4">
                      <span className="w-1 h-1 rounded-full bg-green-400/60 mt-1 flex-shrink-0" />
                      <div className="text-xs text-white/70 flex-1">{msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</div>
                    </div>
                  </motion.div>
                );
              }

              // Thinking messages are now hidden (internal reasoning not needed for display)
              // if (msg.messageType === 'thinking') { ... }

              // Assistant - LEFT aligned with dot indicator, markdown rendered
              if (msg.messageType === 'assistant') {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-3"
                  >
                    <AssistantMessage content={msg.content} />
                  </motion.div>
                )
              }

              // Interrupted
              if (msg.messageType === 'interrupted') {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mb-3"
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400/60 mt-1.5 flex-shrink-0" />
                      <div className="text-xs text-red-400/80">Interrupted</div>
                    </div>
                  </motion.div>
                );
              }

              return null;
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}