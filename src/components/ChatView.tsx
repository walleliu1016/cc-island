import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage, PopupItem } from '../types';
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

interface ChatViewProps {
  sessionId: string;
  projectName: string;
  onClose?: () => void;
}

// Format tool content for display
function formatToolContent(content: string): string {
  try {
    // Try to parse as JSON for better formatting
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Return as-is if not valid JSON
    return content;
  }
}

// Code block component for tool input/output
function CodeBlock({ content, fileName }: { content: string; fileName?: string }) {
  const lines = content.split('\n');

  return (
    <div className="mt-2 rounded-lg overflow-hidden" style={{ backgroundColor: Colors.codeBg }}>
      {/* File header */}
      {fileName && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/40">
            <path d="M2 2a1 1 0 0 1 1-1h4l3 3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2z"/>
          </svg>
          <span className="text-xs text-white/60">{fileName}</span>
        </div>
      )}
      {/* Code content */}
      <div className="px-3 py-2 overflow-x-auto">
        <pre className="text-xs font-mono leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="text-white/20 w-6 text-right mr-3 select-none">{i + 1}</span>
              <span className="text-green-400/90">{line}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

// Message item component
function MessageItem({ msg }: { msg: ChatMessage }) {
  if (msg.messageType === 'toolCall') {
    const formatted = formatToolContent(msg.content);
    return (
      <div className="py-1">
        {/* Tool name with status */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: Colors.toolCall }}>
            {msg.toolName}
          </span>
          <span className="text-xs text-white/40">Waiting for approval...</span>
        </div>
        {/* Code block */}
        <CodeBlock content={formatted} fileName={msg.toolName ? `${msg.toolName.toLowerCase()}_input.json` : undefined} />
      </div>
    );
  }

  if (msg.messageType === 'toolResult') {
    return (
      <div className="py-1">
        <div className="text-xs text-white/40 mb-1">Result</div>
        <div className="text-sm text-white/70">{msg.content}</div>
      </div>
    );
  }

  if (msg.messageType === 'user') {
    return (
      <div className="py-1">
        <div className="text-xs text-white/40 mb-1">You</div>
        <div className="text-sm text-white/90">{msg.content}</div>
      </div>
    );
  }

  return null;
}

export function ChatView({ sessionId, projectName, onClose }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingPopup, setPendingPopup] = useState<PopupItem | null>(null);
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
  }, [sessionId]);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle respond to popup
  const handleRespond = async (decision: 'allow' | 'deny') => {
    if (!pendingPopup) return;
    try {
      await invoke('respond_popup', {
        popupId: pendingPopup.id,
        decision,
      });
      setPendingPopup(null);
      // Close ChatView and return to instance list after responding
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
          onClick={onClose}
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
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3"
            >
              <MessageItem msg={msg} />
            </motion.div>
          ))}
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
          {/* Tool info */}
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

          {/* Action buttons */}
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
