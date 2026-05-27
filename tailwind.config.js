/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        island: {
          bg: 'rgba(0, 0, 0, 0.85)',
          card: 'rgba(255, 255, 255, 0.08)',
          border: 'rgba(255, 255, 255, 0.12)',
        },
        // 紫色主题色系
        purple: {
          deep: '#0f0f23',
          surface: '#1a1a2e',
          elevated: '#22223a',
          primary: '#2d2b55',
          secondary: '#5a4fcf',
          accent: '#7c3aed',
          light: '#8b5cf6',
        },
        // 文字颜色
        text: {
          primary: '#f1f5f9',
          secondary: '#94a3b8',
          muted: '#64748b',
        },
        // 状态颜色
        status: {
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          info: '#60a5fa',
        },
      },
      borderRadius: {
        island: '22px',
        card: '12px',
        badge: '10px',
      },
      backdropBlur: {
        island: '20px',
      },
    },
  },
  plugins: [],
};