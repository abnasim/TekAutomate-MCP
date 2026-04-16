/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blue: {
          50:  '#f0fbfd',
          100: '#d0f3f9',
          200: '#a1e7f4',
          300: '#63d5ec',
          400: '#2ec4e2',
          500: '#1cb5d8',
          600: '#1598b8',
          700: '#127b97',
          800: '#136278',
          900: '#145165',
          950: '#073544',
        },
      },
    },
  },
  plugins: [],
}

