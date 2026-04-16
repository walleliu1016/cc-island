// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState } from 'react';

interface AddDeviceModalProps {
  onClose: () => void;
  onAdd: (token: string) => void;
}

export function AddDeviceModal({ onClose, onAdd }: AddDeviceModalProps) {
  const [token, setToken] = useState('');
  const [mode, setMode] = useState<'input' | 'scan'>('input');

  const handleSubmit = () => {
    if (token.trim()) {
      onAdd(token.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-black border border-white/10 rounded-lg w-[90%] max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white text-lg">添加设备</span>
          <button onClick={onClose} className="text-white/50">×</button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('input')}
              className={`flex-1 py-2 rounded text-sm ${
                mode === 'input' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'
              }`}
            >
              手动输入
            </button>
            <button
              onClick={() => setMode('scan')}
              className={`flex-1 py-2 rounded text-sm ${
                mode === 'scan' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'
              }`}
            >
              扫二维码
            </button>
          </div>

          {mode === 'input' ? (
            <div>
              <label className="text-white/60 text-xs block mb-1">设备Token</label>
              <input
                type="text"
                placeholder="粘贴从桌面端复制的Token"
                value={token}
                onChange={e => setToken(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-white text-sm"
              />
              <button
                onClick={handleSubmit}
                disabled={!token.trim()}
                className="w-full mt-4 py-2 bg-white rounded text-black text-sm disabled:bg-white/30"
              >
                添加
              </button>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-white/40 text-sm">二维码扫描功能将在Phase 2实现</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}