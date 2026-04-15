import { useCloudWebSocket } from '../hooks/useCloudWebSocket';
import { PopupState, SessionState } from '../types';

interface DeviceDetailPageProps {
  deviceToken: string;
  onBack: () => void;
}

export function DeviceDetailPage({ deviceToken, onBack }: DeviceDetailPageProps) {
  const { state, respondPopup } = useCloudWebSocket(deviceToken);

  const pendingPopups = state.popups.filter(p => p.status === 'pending');
  const activeSessions = state.sessions.filter(s => s.status !== 'ended');

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
              <SessionCard key={session.session_id} session={session} />
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

function SessionCard({ session }: { session: SessionState }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.05] mb-2">
      <div className="text-white text-sm">{session.project_name || '未知项目'}</div>
      <div className="text-white/50 text-xs mt-1">{session.status}</div>
      {session.current_tool && (
        <div className="text-amber-400 text-xs mt-1">工具: {session.current_tool}</div>
      )}
    </div>
  );
}

function PopupCard({ popup, onRespond }: { popup: PopupState; onRespond: (d: string | null, a?: string[][]) => void }) {
  if (popup.popup_type === 'permission') {
    return (
      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-2">
        <div className="text-amber-400 text-sm font-medium">需要授权</div>
        <div className="text-white text-xs mt-1">{popup.data?.tool_name}</div>
        {popup.data?.action && (
          <div className="text-white/50 text-xs mt-1 truncate">{popup.data.action}</div>
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

  // Ask popup - simplified
  return (
    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mb-2">
      <div className="text-blue-400 text-sm font-medium">问题</div>
      <div className="text-white text-xs mt-1">点击查看详情</div>
    </div>
  );
}