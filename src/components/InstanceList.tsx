import { motion } from 'framer-motion';
import { ClaudeInstance, PopupItem } from '../types';

interface InstanceListProps {
  instances: ClaudeInstance[];
  popups?: PopupItem[];
  onJump: (sessionId: string) => void;
}

export function InstanceList({ instances, popups = [], onJump }: InstanceListProps) {
  if (instances.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {instances.map((instance) => (
        <InstanceItem
          key={instance.session_id}
          instance={instance}
          pendingPopup={popups.find(p => p.session_id === instance.session_id && p.status === 'pending')}
          onJump={onJump}
        />
      ))}
    </div>
  );
}

function InstanceItem({
  instance,
  pendingPopup,
  onJump
}: {
  instance: ClaudeInstance;
  pendingPopup?: PopupItem;
  onJump: (sessionId: string) => void;
}) {
  // 状态配置：颜色、背景、图标、文本
  const getStatusDisplay = () => {
    // 有待处理的弹窗 = 等待权限/问题
    if (pendingPopup) {
      if (pendingPopup.type === 'permission') {
        return {
          icon: '🔐',
          label: '等待权限审核',
          subLabel: pendingPopup.permission_data?.tool_name || '',
          colorClass: 'text-orange-400',
          bgClass: 'bg-orange-500/10 border-orange-500/30',
          dotClass: 'bg-orange-400',
          animate: true,
        };
      } else if (pendingPopup.type === 'ask') {
        return {
          icon: '💬',
          label: '等待用户回答',
          subLabel: pendingPopup.ask_data?.questions?.[0]?.header || '',
          colorClass: 'text-blue-400',
          bgClass: 'bg-blue-500/10 border-blue-500/30',
          dotClass: 'bg-blue-400',
          animate: true,
        };
      }
    }

    // 根据实例状态
    switch (instance.status) {
      case 'working':
        return {
          icon: '⚡',
          label: '正在执行',
          subLabel: instance.current_tool || '',
          detail: instance.tool_input?.action || instance.tool_input?.details,
          colorClass: 'text-green-400',
          bgClass: 'bg-green-500/10 border-green-500/30',
          dotClass: 'bg-green-400',
          animate: true,
        };
      case 'idle':
        return {
          icon: '💭',
          label: '等待输入',
          subLabel: '等待 prompt',
          colorClass: 'text-white/50',
          bgClass: 'bg-white/[0.04] border-white/10',
          dotClass: 'bg-white/40',
          animate: false,
        };
      case 'waiting':
        return {
          icon: '⏳',
          label: '等待响应',
          subLabel: '等待 LLM 返回',
          colorClass: 'text-yellow-400',
          bgClass: 'bg-yellow-500/10 border-yellow-500/30',
          dotClass: 'bg-yellow-400',
          animate: true,
        };
      case 'error':
        return {
          icon: '❌',
          label: '执行失败',
          subLabel: '检查错误日志',
          colorClass: 'text-red-400',
          bgClass: 'bg-red-500/10 border-red-500/30',
          dotClass: 'bg-red-400',
          animate: false,
        };
      case 'compacting':
        return {
          icon: '📦',
          label: '压缩对话',
          subLabel: '清理上下文',
          colorClass: 'text-purple-400',
          bgClass: 'bg-purple-500/10 border-purple-500/30',
          dotClass: 'bg-purple-400',
          animate: true,
        };
      case 'ended':
        return {
          icon: '🏁',
          label: '会话结束',
          subLabel: '',
          colorClass: 'text-gray-400',
          bgClass: 'bg-gray-500/10 border-gray-500/30',
          dotClass: 'bg-gray-400',
          animate: false,
        };
      default:
        return {
          icon: '•',
          label: instance.status,
          subLabel: '',
          colorClass: 'text-white/50',
          bgClass: 'bg-white/[0.04] border-white/10',
          dotClass: 'bg-white/40',
          animate: false,
        };
    }
  };

  const status = getStatusDisplay();
  const projectName = instance.custom_name || instance.project_name;

  return (
    <motion.div
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors ${status.bgClass} hover:bg-white/[0.08]`}
    >
      {/* 状态指示灯 */}
      <div className={`w-2.5 h-2.5 rounded-full ${status.dotClass} ${status.animate ? 'animate-pulse' : ''}`} />

      {/* 项目名 */}
      <div className="flex-shrink-0">
        <span className="text-white/40 text-xs">APP:</span>
        <span className={`text-sm font-semibold ml-0.5 ${status.colorClass}`}>{projectName}</span>
      </div>

      {/* 状态信息 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{status.icon}</span>
          <span className={`text-sm font-medium ${status.colorClass}`}>{status.label}</span>
        </div>
        {(status.subLabel || status.detail) && (
          <div className="text-white/40 text-xs truncate ml-5">
            {status.subLabel}
            {status.detail && <span className="text-white/30 ml-1">({status.detail})</span>}
          </div>
        )}
      </div>

      {/* Jump 按钮 */}
      {instance.status !== 'ended' && (
        <button
          onClick={() => onJump(instance.session_id)}
          className="px-2.5 py-1 text-xs text-white/50 bg-white/[0.08] hover:bg-white/[0.15] hover:text-white/80 rounded transition-colors flex-shrink-0"
        >
          Jump
        </button>
      )}
    </motion.div>
  );
}