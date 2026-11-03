import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    allowedHosts: ['terminal.local'],
    proxy: {
      '/api': {
        target: 'https://coldspan-api.tajudeenowoeteniyan.workers.dev',
        changeOrigin: true,
        headers: { Origin: 'https://coldspan-preview.deeen-code.chatgpt.site' },
      },
    },
  },
});
