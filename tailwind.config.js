/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 24px 90px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.16)',
        glow: '0 0 55px rgba(255, 255, 255, 0.16)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(16px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.54', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.2)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(120%)' },
        },
      },
      animation: {
        rise: 'rise 520ms cubic-bezier(.2,.8,.2,1) both',
        breathe: 'breathe 1.8s ease-in-out infinite',
        shimmer: 'shimmer 2.8s linear infinite',
      },
    },
  },
  plugins: [],
};
