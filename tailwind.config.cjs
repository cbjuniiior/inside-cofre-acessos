/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Hanken Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque', 'Hanken Grotesk', 'ui-sans-serif', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      colors: {
        // Destaque (rosa/magenta)
        brand: {
          50: '#fdf0f8',
          100: '#fbd9ee',
          300: '#f08fcb',
          400: '#ec6fb8',
          500: '#E550A5',
          600: '#d63d95',
          700: '#b82f7e'
        },
        // Superfícies escuras
        ink: {
          950: '#0e0e0e',
          900: '#141414',
          850: '#191919',
          800: '#1c1c1c',
          750: '#232323',
          700: '#2b2b2b',
          600: '#383838'
        }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(229,80,165,0.30), 0 16px 50px -20px rgba(229,80,165,0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -28px rgba(0,0,0,0.8)'
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.22,1,0.36,1) both'
      }
    }
  },
  plugins: []
}
