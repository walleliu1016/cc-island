import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ccisland.remote',
  appName: 'CC-Island Remote',
  webDir: 'dist',
  server: {
    // 允许混合内容（WebSocket 连接）
    allowNavigation: ['*'],
    // 允许所有外部 URL
    externalUrls: ['ws://*', 'wss://*'],
  },
  android: {
    backgroundColor: '#0f172a',
    // 允许混合内容
    mixedContent: 'allow',
  },
  ios: {
    backgroundColor: '#0f172a',
    contentInset: 'automatic',
  },
  plugins: {
    // 状态栏配置
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
  },
};

export default config;