/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#0A0F16',
        surface: {
          1: '#111926',
          2: '#17202F',
          3: '#1E293B',
        },
        line: {
          DEFAULT: 'rgba(148,163,184,0.13)',
          strong: 'rgba(148,163,184,0.25)',
        },
        ink: {
          DEFAULT: '#EDF2F9',
          secondary: '#A9B6C9',
          muted: '#67758B',
        },
        accent: {
          DEFAULT: '#3987E5',
          hover: '#5598E7',
          deep: '#256ABF',
        },
        good: '#0CA30C',
        warn: '#FAB219',
        crit: '#D03B3B',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.35), 0 8px 24px -12px rgba(0,0,0,0.5)',
        pop: '0 4px 12px rgba(0,0,0,0.4), 0 16px 48px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'scale-in': 'scale-in 0.18s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
