import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Passport design tokens (lock at White belt — Kaan).
        ink: '#0b0b14',
        stellar: '#f7c948',
        sigil: '#7c5cff',
      },
    },
  },
  plugins: [],
};

export default config;
