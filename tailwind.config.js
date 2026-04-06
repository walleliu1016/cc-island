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
      },
      borderRadius: {
        island: '22px',
        card: '12px',
      },
      backdropBlur: {
        island: '20px',
      },
    },
  },
  plugins: [],
};