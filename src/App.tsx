// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './stores/appStore';
import { IslandLayout } from './components/IslandLayout';
import { DesktopLayout } from './components/DesktopLayout';

function App() {
  const [windowLabel, setWindowLabel] = useState<string>('');
  const setTheme = useAppStore(s => s.setTheme);
  const theme = useAppStore(s => s.theme);

  // Sync theme class on <html> for CSS variable overrides
  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  useEffect(() => {
    invoke<string>('get_window_label').then(setWindowLabel).catch(() => setWindowLabel('main'));

    // Load theme from saved settings on startup
    invoke<{ theme: string }>('get_settings')
      .then(s => {
        if (s.theme) {
          setTheme(s.theme);
          invoke('set_app_theme', { theme: s.theme }).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  if (windowLabel === '') return null;
  if (windowLabel === 'desktop') return <DesktopLayout />;
  return <IslandLayout />;
}

export default App;
