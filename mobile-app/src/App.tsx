// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { DeviceListPage } from './components/DeviceListPage';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AddDeviceModal } from './components/AddDeviceModal';
import { SettingsModal } from './components/SettingsModal';

function App() {
  const [devices, setDevices] = useState<string[]>(() => {
    const saved = localStorage.getItem('cc-cloud-devices');
    return saved ? JSON.parse(saved) : [];
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

  const handleSaveSettings = (url: string) => {
    localStorage.setItem('cloud-server-url', url);
    setServerUrl(url);
    setShowSettings(false);
  };

  return (
    <div className="h-screen bg-black">
      {activeDevice ? (
        <DeviceDetailPage
          deviceToken={activeDevice}
          onBack={() => setActiveDevice(null)}
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
        <SettingsModal
          initialServerUrl={serverUrl}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;