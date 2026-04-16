// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
interface DeviceListPageProps {
  devices: string[];
  onSelectDevice: (token: string) => void;
  onAddDevice: () => void;
  onOpenSettings: () => void;
}

export function DeviceListPage({ devices, onSelectDevice, onAddDevice, onOpenSettings }: DeviceListPageProps) {
  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-white text-lg font-medium">我的设备</span>
        <div className="flex gap-2">
          <button
            onClick={onOpenSettings}
            className="text-white/70 hover:text-white text-sm"
          >
            ⚙
          </button>
          <button
            onClick={onAddDevice}
            className="text-white/70 hover:text-white text-sm"
          >
            + 添加
          </button>
        </div>
      </div>

      {/* Device List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {devices.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-white/40 text-sm">暂无设备</div>
            <button
              onClick={onAddDevice}
              className="mt-4 px-4 py-2 bg-white/10 rounded text-white/70 text-sm"
            >
              添加设备
            </button>
          </div>
        ) : (
          devices.map(token => (
            <DeviceCard
              key={token}
              token={token}
              onClick={() => onSelectDevice(token)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DeviceCard({ token, onClick }: { token: string; onClick: () => void }) {
  const displayName = token.slice(0, 8) + '...';

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between p-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] cursor-pointer mb-2"
    >
      <div>
        <div className="text-white text-sm">{displayName}</div>
        <div className="text-white/40 text-xs mt-1">设备Token</div>
      </div>
      <div className="text-white/30">→</div>
    </div>
  );
}