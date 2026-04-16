// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { DeviceListPage } from './components/DeviceListPage';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AddDeviceModal } from './components/AddDeviceModal';
import { SettingsPage } from './components/SettingsPage';
import { Toast } from './components/Toast';
import { useToast } from './hooks/useToast';

type View = 'devices' | 'detail' | 'settings';

function App() {
  const { toast, showSuccess, showError, showWarning } = useToast()

  const [devices, setDevices] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cc-cloud-devices');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [serverUrl, setServerUrl] = useState<string>(() => {
    return localStorage.getItem('cloud-server-url') || '';
  });

  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [view, setView] = useState<View>('devices');
  const [serverConnected, _setServerConnected] = useState(false);

  // Save devices to localStorage
  useEffect(() => {
    localStorage.setItem('cc-cloud-devices', JSON.stringify(devices));
  }, [devices]);

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
    // TODO: Send to cloud server via WebSocket
  };

  // Wrapper function to match DeviceDetailPage's showToast signature
  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    switch (type) {
      case 'success':
        showSuccess(message)
        break
      case 'error':
        showError(message)
        break
      case 'warning':
        showWarning(message)
        break
    }
  }

  const getDeviceName = (token: string) => token.slice(0, 8) + '...'

  // Render based on view state
  if (view === 'settings') {
    return (
      <div className="h-screen">
        <SettingsPage
          serverUrl={serverUrl}
          serverConnected={serverConnected}
          devices={devices}
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
    return (
      <div className="h-screen">
        <DeviceDetailPage
          deviceToken={activeDevice}
          deviceName={getDeviceName(activeDevice)}
          onBack={() => setView('devices')}
          showToast={showToast}
        />
        <Toast visible={toast.visible} message={toast.message} type={toast.type} />
      </div>
    )
  }

  return (
    <div className="h-screen">
      <DeviceListPage
        devices={devices}
        onSelectDevice={(token) => {
          setActiveDevice(token);
          setView('detail');
        }}
        onAddDevice={() => setShowAddModal(true)}
        onOpenSettings={() => setView('settings')}
        serverConnected={serverConnected}
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