// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { DeviceListPage } from './components/DeviceListPage';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AddDeviceModal } from './components/AddDeviceModal';
import { SettingsPage } from './components/SettingsPage';
import { Toast } from './components/Toast';
import { useToast } from './hooks/useToast';

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
  const [showSettings, setShowSettings] = useState(false);
  const [serverConnected, _setServerConnected] = useState(false);

  // Save devices to localStorage
  useEffect(() => {
    localStorage.setItem('cc-cloud-devices', JSON.stringify(devices));
  }, [devices]);

  const handleAddDevice = (token: string) => {
    if (!devices.includes(token)) {
      setDevices([...devices, token]);
    }
  };

  const handleSaveServer = (url: string) => {
    localStorage.setItem('cloud-server-url', url);
    setServerUrl(url);
  };

  const handleDeleteDevice = (token: string) => {
    setDevices(devices.filter(d => d !== token));
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

  return (
    <div className="h-screen bg-black">
      {activeDevice ? (
        <DeviceDetailPage
          deviceToken={activeDevice}
          deviceName={getDeviceName(activeDevice)}
          onBack={() => setActiveDevice(null)}
          showToast={showToast}
        />
      ) : (
        <DeviceListPage
          devices={devices}
          onSelectDevice={setActiveDevice}
          onAddDevice={() => setShowAddModal(true)}
          onOpenSettings={() => setShowSettings(true)}
          serverConnected={serverConnected}
        />
      )}

      {showAddModal && (
        <AddDeviceModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddDevice}
        />
      )}

      {showSettings && (
        <SettingsPage
          serverUrl={serverUrl}
          serverConnected={serverConnected}
          devices={devices}
          onSaveServer={handleSaveServer}
          onDeleteDevice={handleDeleteDevice}
          onToggleAutoAllow={handleToggleAutoAllow}
          onBack={() => setShowSettings(false)}
        />
      )}

      <Toast visible={toast.visible} message={toast.message} type={toast.type} />
    </div>
  );
}

export default App;