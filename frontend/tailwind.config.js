/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50:'#f0f4ff', 500:'#4f6ef7', 600:'#3d5ce5', 700:'#2f4bcc' },
      },
    },
  },
  plugins: [],
}
