// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { ClaudeInstance } from '../types'

interface InstanceListProps {
  instances: ClaudeInstance[]
}

export function InstanceList({ instances }: InstanceListProps) {
  return (
    <div className="flex flex-col gap-2">
      {instances.map(instance => (
        <InstanceCard key={instance.session_id} instance={instance} />
      ))}
    </div>
  )
}

function InstanceCard({ instance }: { instance: ClaudeInstance }) {
  const statusColor = getStatusColor(instance.status.type)
  const statusText = getStatusText(instance.status)

  return (
    <div className="bg-nexus-bg2 border border-nexus-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-nexus-text font-medium text-sm truncate">
          {instance.project_name}
        </span>
      </div>

      {instance.current_tool && (
        <div className="text-nexus-text2 text-xs truncate">
          {instance.status.type === 'waitingForApproval'
            ? `需要授权: ${instance.current_tool}`
            : instance.status.type === 'thinking'
            ? '思考中...'
            : instance.status.type === 'working'
            ? `运行: ${instance.current_tool}`
            : statusText}
        </div>
      )}

      {instance.tool_input && (
        <div className="text-nexus-text2 text-xs mt-1 truncate">
          {instance.tool_input.action || instance.tool_input.details || instance.tool_input.command}
        </div>
      )}
    </div>
  )
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'thinking':
      return 'bg-nexus-warning'
    case 'working':
      return 'bg-nexus-accent animate-pulse'
    case 'waitingForApproval':
      return 'bg-nexus-warning'
    case 'error':
      return 'bg-nexus-error'
    case 'idle':
      return 'bg-nexus-success'
    default:
      return 'bg-nexus-text2'
  }
}

function getStatusText(status: { type: string; tool?: string }): string {
  switch (status.type) {
    case 'thinking':
      return '思考中'
    case 'working':
      return `运行 ${status.tool || '工具'}`
    case 'waiting':
      return '等待'
    case 'waitingForApproval':
      return '需要授权'
    case 'error':
      return '错误'
    case 'idle':
      return '空闲'
    case 'compacting':
      return '压缩中'
    default:
      return status.type
  }
}