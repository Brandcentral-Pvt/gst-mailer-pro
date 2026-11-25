/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#061420',
          900: '#0a1e2e',
          800: '#10293c',
          700: '#1b3a50',
          600: '#2b5069',
          500: '#48687f',
          400: '#6e8ba0',
          300: '#9db2c2',
          200: '#c7d6e1',
          100: '#e6eef4',
          50: '#f3f8fb',
        },
        brand: {
          950: '#04222b',
          900: '#06323f',
          800: '#084555',
          700: '#0a5b6e',
          600: '#0b7285',
          500: '#0e8ba3',
          400: '#22a7c0',
          300: '#5fc6da',
          200: '#a5e2ec',
          100: '#dcf4f8',
          50: '#eefafc',
        },
        mint: { 500: '#19c37d', 100: '#dcf9ec' },
        amberish: { 500: '#f59e0b', 100: '#fef3c7' },
        rose: { 500: '#ef4444', 100: '#fee2e2' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(10,30,46,.05), 0 8px 24px -12px rgba(10,30,46,.18)',
        lift: '0 2px 4px rgba(10,30,46,.05), 0 18px 40px -18px rgba(10,30,46,.28)',
        glow: '0 0 0 1px rgba(11,114,133,.15), 0 12px 40px -12px rgba(11,114,133,.45)',
      },
      backgroundImage: {
        'grid-fade': 'radial-gradient(circle at 20% 0%, rgba(34,167,192,.10), transparent 45%), radial-gradient(circle at 90% 10%, rgba(11,114,133,.08), transparent 40%)',
        'brand-sheen': 'linear-gradient(135deg, #06323f 0%, #0a5b6e 55%, #0e8ba3 100%)',
        'brand-line': 'linear-gradient(90deg, #22a7c0, #19c37d)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-500px 0' }, '100%': { backgroundPosition: '500px 0' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } },
        pulseSoft: { '0%,100%': { opacity: 1 }, '50%': { opacity: .55 } },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        floaty: 'floaty 5s ease-in-out infinite',
        pulseSoft: 'pulseSoft 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
