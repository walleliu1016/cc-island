// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { useCloudWebSocket } from '../hooks/useCloudWebSocket';
import { PopupState, SessionState, PermissionData, AskData } from '../types';
import { ChatView } from './ChatView';

interface DeviceDetailPageProps {
  deviceToken: string;
  onBack: () => void;
}

export function DeviceDetailPage({ deviceToken, onBack }: DeviceDetailPageProps) {
  const { state, respondPopup, requestChatHistory } = useCloudWebSocket(deviceToken);
  const [chatSession, setChatSession] = useState<{ sessionId: string; projectName: string } | null>(null);

  const pendingPopups = state.popups.filter(p => p.status === 'pending');
  const activeSessions = state.sessions.filter(s => s.status !== 'ended');

  const handleViewChat = (sessionId: string, projectName: string) => {
    requestChatHistory(sessionId);
    setChatSession({ sessionId, projectName });
  };

  // If viewing chat, show ChatView
  if (chatSession) {
    return (
      <ChatView
        projectName={chatSession.projectName}
        onClose={() => setChatSession(null)}
        messages={state.chatMessages[chatSession.sessionId] || []}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-white/10">
        <button onClick={onBack} className="text-white/70 mr-3">
          ←
        </button>
        <span className="text-white text-lg font-medium">
          {deviceToken.slice(0, 8)}...
        </span>
        <span className={`ml-2 text-xs ${
          state.status === 'connected' ? 'text-green-400' : 'text-red-400'
        }`}>
          {state.status === 'connected' ? '在线' : '离线'}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {/* Sessions */}
        <div className="mb-4">
          <div className="text-white/60 text-xs mb-2">活跃会话</div>
          {activeSessions.length === 0 ? (
            <div className="text-white/30 text-sm">暂无活跃会话</div>
          ) : (
            activeSessions.map(session => (
              <SessionCard
                key={session.session_id}
                session={session}
                onViewChat={() => handleViewChat(session.session_id, session.project_name || '未知项目')}
              />
            ))
          )}
        </div>

        {/* Popups */}
        <div>
          <div className="text-white/60 text-xs mb-2">待审批</div>
          {pendingPopups.length === 0 ? (
            <div className="text-white/30 text-sm">暂无待审批</div>
          ) : (
            pendingPopups.map(popup => (
              <PopupCard
                key={popup.id}
                popup={popup}
                onRespond={(decision, answers) => respondPopup(popup.id, decision, answers)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session, onViewChat }: { session: SessionState; onViewChat: () => void }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.05] mb-2">
      <div className="text-white text-sm">{session.project_name || '未知项目'}</div>
      <div className="text-white/50 text-xs mt-1">{session.status}</div>
      {session.current_tool && (
        <div className="text-amber-400 text-xs mt-1">工具: {session.current_tool}</div>
      )}
      <button
        onClick={onViewChat}
        className="mt-2 px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-white/70 text-xs transition-colors"
      >
        查看对话
      </button>
    </div>
  );
}

function PopupCard({ popup, onRespond }: { popup: PopupState; onRespond: (d: string | null, a?: string[][]) => void }) {
  if (popup.type === 'permission') {
    const permData = popup.data as PermissionData;
    return (
      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-2">
        <div className="text-amber-400 text-sm font-medium">需要授权</div>
        <div className="text-white text-xs mt-1">{permData?.tool_name}</div>
        {permData?.action && (
          <div className="text-white/50 text-xs mt-1 truncate">{permData.action}</div>
        )}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onRespond('deny')}
            className="px-3 py-1 bg-white/10 rounded text-white/70 text-xs"
          >
            拒绝
          </button>
          <button
            onClick={() => onRespond('allow')}
            className="px-3 py-1 bg-white rounded text-black text-xs"
          >
            允许
          </button>
        </div>
      </div>
    );
  }

  // Ask popup - show question preview
  const askData = popup.data as AskData;
  return (
    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mb-2">
      <div className="text-blue-400 text-sm font-medium">问题</div>
      <div className="text-white text-xs mt-1">
        {askData?.questions?.[0]?.question || '等待用户回答'}
      </div>
    </div>
  );
}