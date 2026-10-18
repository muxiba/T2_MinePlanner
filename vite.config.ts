/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Separa bibliotecas grandes para carregamento mais rápido e cache melhor.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          neon: ['@neondatabase/neon-js'],
          charts: ['chart.js', 'react-chartjs-2'],
          pdf: ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
