/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'nexus-bg': '#0f172a',
        'nexus-bg2': '#1e293b',
        'nexus-border': '#334155',
        'nexus-text': '#f1f5f9',
        'nexus-text2': '#94a3b8',
        'nexus-accent': '#3b82f6',
        'nexus-success': '#22c55e',
        'nexus-warning': '#f59e0b',
        'nexus-error': '#ef4444',
      },
    },
  },
  plugins: [],
}