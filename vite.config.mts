/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    // 5173 落在 Windows Hyper-V 保留端口区间 5141-5240 内，bind 会 EACCES。
    // 5800 位于 5697-5961 的安全区间。
    port: 5800,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      // 浏览器走相对路径 /rtc → 由 Vite 代理转发到真实服务端，避开 CORS。
      // 默认转发到本地 mock；指向自建/远端服务端时通过 VITE_API_BASE_URL 覆盖。
      '/rtc': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8787',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src/_legacy/**'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/__tests__/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
