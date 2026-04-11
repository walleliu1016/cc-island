import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage, ChatMessageType } from '../types';
import { ProcessingSpinner } from './StatusIcons';

// Terminal-style colors
const Colors = {
  user: '#d97857',     // Claude orange
  assistant: '#66c075', // Green
  toolCall: '#6699ff',  // Blue
  toolResult: '#66c075', // Green
  thinking: '#ffb700',  // Amber
  interrupted: '#ff4d4d', // Red
  dim: 'rgba(255,255,255,0.4)',
};

// Message type icon
function MessageIcon({ type }: { type: ChatMessageType }) {
  switch (type) {
    case 'user':
      return <span style={{ color: Colors.user }}>›</span>;
    case 'assistant':
      return <span style={{ color: Colors.assistant }}>◆</span>;
    case 'toolCall':
      return <span style={{ color: Colors.toolCall }}>⚙</span>;
    case 'toolResult':
      return <span style={{ color: Colors.toolResult }}>✓</span>;
    case 'thinking':
      return <ProcessingSpinner size={10} />;
    case 'interrupted':
      return <span style={{ color: Colors.interrupted }}>✗</span>;
    default:
      return null;
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch messages periodically
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const data = await invoke<ChatMessage[]>('get_chat_messages', { sessionId });
        setMessages(data);
        // Check if there's a recent thinking/toolCall message (within last 3 seconds)
        const now = Date.now() / 1000;
        const hasRecentActivity = data.some(m =>
          (m.messageType === 'thinking' || m.messageType === 'toolCall') &&
          m.timestamp / 1000 > now - 3
        );
        setIsProcessing(hasRecentActivity);
      } catch (e) {
        console.error('Failed to fetch chat messages:', e);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 500);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Truncate content for display
  const truncateContent = (content: string, maxLength: number = 200): string => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-white/70 text-sm font-medium truncate">
          {projectName}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors p-1"
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 scrollbar-thin"
      >
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2"
            >
              {/* Icon */}
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
                <MessageIcon type={msg.messageType} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Tool name for tool calls */}
                {msg.toolName && (
                  <span className="text-white/40 text-xs mr-1">
                    [{msg.toolName}]
                  </span>
                )}

                {/* Message content */}
                <span
                  className="text-sm break-all"
                  style={{ color: Colors[msg.messageType] || Colors.dim }}
                >
                  {truncateContent(msg.content)}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Processing indicator */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 py-1"
          >
            <ProcessingSpinner size={10} />
            <span className="text-white/40 text-xs">Processing...</span>
          </motion.div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="text-white/30 text-xs text-center py-4">
            No messages yet
          </div>
        )}
      </div>
    </div>
  );
}