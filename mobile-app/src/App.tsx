// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { DeviceListPage } from './components/DeviceListPage';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AddDeviceModal } from './components/AddDeviceModal';

function App() {
  const [devices, setDevices] = useState<string[]>(() => {
    const saved = localStorage.getItem('cc-cloud-devices');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Save devices to localStorage
  useEffect(() => {
    localStorage.setItem('cc-cloud-devices', JSON.stringify(devices));
  }, [devices]);

  const handleAddDevice = (token: string) => {
    if (!devices.includes(token)) {
      setDevices([...devices, token]);
    }
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
        />
      )}

      {showAddModal && (
        <AddDeviceModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddDevice}
        />
      )}
    </div>
  );
}

export default App;