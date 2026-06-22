// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IslandLayout } from './components/IslandLayout';
import { DesktopLayout } from './components/DesktopLayout';

function App() {
  const [windowLabel, setWindowLabel] = useState<string>('');

  useEffect(() => {
    invoke<string>('get_window_label').then(setWindowLabel).catch(() => setWindowLabel('main'));
  }, []);

  if (windowLabel === '') return null;
  if (windowLabel === 'desktop') return <DesktopLayout />;
  return <IslandLayout />;
}

export default App;
