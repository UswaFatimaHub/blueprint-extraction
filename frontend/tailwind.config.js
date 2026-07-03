/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // all colors resolve through CSS variables (RGB triples) set in index.css,
      // so every component themes automatically — light on :root, dark on .dark
      colors: {
        page: 'rgb(var(--page) / <alpha-value>)',
        surface: {
          1: 'rgb(var(--surface-1) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
        },
        line: {
          faint: 'rgb(var(--line-rgb) / 0.07)',
          DEFAULT: 'rgb(var(--line-rgb) / var(--line-a))',
          strong: 'rgb(var(--line-rgb) / var(--line-a-strong))',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          hi: 'rgb(var(--ink-hi) / <alpha-value>)',
          secondary: 'rgb(var(--ink-secondary) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          bright: 'rgb(var(--accent-bright) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',
        },
        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        crit: 'rgb(var(--crit) / <alpha-value>)',
      },
      // enlarged type ramp — primary users are elderly; keep everything readable
      fontSize: {
        xs: ['13.5px', { lineHeight: '1.45' }],
        sm: ['15.5px', { lineHeight: '1.5' }],
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Space Grotesk Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        beam: 'var(--shadow-beam)',
        'beam-soft': 'var(--shadow-beam-soft)',
      },
      letterSpacing: {
        label: '0.14em',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        ants: {
          to: { strokeDashoffset: '-24' },
        },
        scan: {
          '0%': { top: '-8%' },
          '100%': { top: '108%' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.7)', opacity: '0.7' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'fade-up': 'fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.18s ease-out both',
        ants: 'ants 0.7s linear infinite',
        scan: 'scan 2.6s cubic-bezier(0.45, 0, 0.55, 1) infinite',
        blink: 'blink 1.6s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite',
      },
    },
  },
  plugins: [],
}
