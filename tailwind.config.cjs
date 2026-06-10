/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
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
          800: '#1e1e1e',
          750: '#242424',
          700: '#2b2b2b',
          600: '#383838'
        }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(229,80,165,0.35), 0 8px 30px -12px rgba(229,80,165,0.45)'
      }
    }
  },
  plugins: []
}
