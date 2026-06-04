import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/setup/',
  server: {
    port: 5174,
    proxy: {
      '/setup/api': { target: 'http://localhost:5600', changeOrigin: true },
      '/setup': { target: 'http://localhost:5600', changeOrigin: true },
    },
  },
});
