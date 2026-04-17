// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { DeviceListPage } from './components/DeviceListPage';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AddDeviceModal } from './components/AddDeviceModal';
import { SettingsPage } from './components/SettingsPage';
import { Toast } from './components/Toast';
import { useToast } from './hooks/useToast';
import { useAllDevicesWebSocket } from './hooks/useAllDevicesWebSocket';
import { DeviceInfo } from './types';

type View = 'devices' | 'detail' | 'settings';

// Extended device info with cached hostname for offline display
interface CachedDeviceInfo extends DeviceInfo {
  cached_hostname?: string;  // Persisted hostname for offline display
}

function App() {
  const { toast, showSuccess, showError, showWarning } = useToast()

  // User-added device tokens
  const [devices, setDevices] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cc-cloud-devices');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Cached device info map (hostname for offline display)
  const [deviceInfoMap, setDeviceInfoMap] = useState<Record<string, CachedDeviceInfo>>(() => {
    try {
      const saved = localStorage.getItem('cc-cloud-device-info');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [serverUrl, setServerUrl] = useState<string>(() => {
    return localStorage.getItem('cloud-server-url') || '';
  });

  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [view, setView] = useState<View>('devices');

  // WebSocket connection
  const { state, sendHookResponse, requestChatHistory, forceSubscribe } = useAllDevicesWebSocket({
    devices,
    serverUrl,
  });

  // Save devices to localStorage
  useEffect(() => {
    localStorage.setItem('cc-cloud-devices', JSON.stringify(devices));
  }, [devices]);

  // Save device info map to localStorage
  useEffect(() => {
    localStorage.setItem('cc-cloud-device-info', JSON.stringify(deviceInfoMap));
  }, [deviceInfoMap]);

  // Update device info map when online devices change
  useEffect(() => {
    const updates: Record<string, CachedDeviceInfo> = {};
    state.onlineDevices.forEach(device => {
      const existing = deviceInfoMap[device.token];
      // Update cached_hostname when device comes online with hostname
      if (device.hostname && (!existing || existing.hostname !== device.hostname)) {
        updates[device.token] = {
          ...device,
          cached_hostname: device.hostname,
        };
      }
    });

    if (Object.keys(updates).length > 0) {
      setDeviceInfoMap(prev => ({ ...prev, ...updates }));
    }
  }, [state.onlineDevices]);

  const handleAddDevice = (token: string) => {
    if (!devices.includes(token)) {
      setDevices([...devices, token]);
      showSuccess('设备已添加');
    } else {
      showWarning('设备已存在');
    }
  };

  const handleSaveServer = (url: string) => {
    localStorage.setItem('cloud-server-url', url);
    setServerUrl(url);
    showSuccess('设置已保存');
  };

  const handleDeleteDevice = (token: string) => {
    setDevices(devices.filter(d => d !== token));
    showSuccess('设备已删除');
  };

  const handleToggleAutoAllow = (token: string, enabled: boolean) => {
    console.log(`Toggle auto-allow for ${token}: ${enabled}`);
  };

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    switch (type) {
      case 'success': showSuccess(message); break
      case 'error': showError(message); break
      case 'warning': showWarning(message); break
    }
  }

  // Render based on view state
  if (view === 'settings') {
    return (
      <div className="h-screen">
        <SettingsPage
          serverUrl={serverUrl}
          serverConnected={state.serverConnected}
          serverConnecting={state.serverConnecting}
          connectionError={state.connectionError}
          devices={devices}
          deviceInfoMap={deviceInfoMap}
          onSaveServer={handleSaveServer}
          onDeleteDevice={handleDeleteDevice}
          onToggleAutoAllow={handleToggleAutoAllow}
          onBack={() => setView('devices')}
        />
        <Toast visible={toast.visible} message={toast.message} type={toast.type} />
      </div>
    )
  }

  if (view === 'detail' && activeDevice) {
    const deviceInfo = state.onlineDevices.find(d => d.token === activeDevice)
    const cachedInfo = deviceInfoMap[activeDevice]
    // Merge online info with cached info
    const mergedDeviceInfo = {
      ...cachedInfo,
      ...(deviceInfo || {}),
      online: !!deviceInfo,
    }
    const deviceSessions = state.sessions[activeDevice] || []
    const deviceHints = state.hookHints[activeDevice] || []

    return (
      <div className="h-screen">
        <DeviceDetailPage
          deviceInfo={mergedDeviceInfo}
          sessions={deviceSessions}
          hookHints={deviceHints}
          chatMessages={state.chatMessages}
          connected={mergedDeviceInfo.online}
          onBack={() => setView('devices')}
          onRespondHook={(sessionId, decision, answers) => sendHookResponse(activeDevice, sessionId, decision, answers)}
          onRequestChatHistory={(sessionId) => requestChatHistory(activeDevice, sessionId)}
          showToast={showToast}
        />
        <Toast visible={toast.visible} message={toast.message} type={toast.type} />
      </div>
    )
  }

  return (
    <div className="h-screen">
      <DeviceListPage
        userDevices={devices}
        onlineDevices={state.onlineDevices}
        deviceInfoMap={deviceInfoMap}
        hookHints={state.hookHints}
        serverConnected={state.serverConnected}
        serverUrl={serverUrl}
        onSelectDevice={(token) => {
          // Auto-subscribe device if not already in list
          if (!devices.includes(token)) {
            setDevices([...devices, token]);
          } else {
            // Device already in list, force send subscription
            forceSubscribe();
          }
          setActiveDevice(token);
          setView('detail');
        }}
        onRespondHook={(deviceToken, sessionId, decision, answers) => sendHookResponse(deviceToken, sessionId, decision, answers)}
        onAddDevice={() => setShowAddModal(true)}
        onOpenSettings={() => setView('settings')}
      />

      {showAddModal && (
        <AddDeviceModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddDevice}
        />
      )}

      <Toast visible={toast.visible} message={toast.message} type={toast.type} />
    </div>
  );
}

export default App;