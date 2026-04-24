import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  preview: {
    port: 1421,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        welcome: fileURLToPath(new URL('./welcome.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (
            normalizedId.includes('/node_modules/vue/') ||
            normalizedId.includes('/node_modules/vue-router/') ||
            normalizedId.includes('/node_modules/pinia/')
          ) {
            return 'vendor-core';
          }

          if (normalizedId.includes('/node_modules/monaco-editor/')) {
            return 'vendor-monaco';
          }

          if (normalizedId.includes('/node_modules/@xterm/')) {
            return 'vendor-xterm';
          }

          if (
            normalizedId.includes('/node_modules/web-tree-sitter/') ||
            normalizedId.includes('/node_modules/tree-sitter-bash/') ||
            normalizedId.includes('/node_modules/@wasm-fmt/shfmt/') ||
            normalizedId.includes('/src/utils/shell-completion.ts') ||
            normalizedId.includes('/src/constants/shell-command-catalog.ts') ||
            normalizedId.includes('/src/generated/fig-shell-command-catalog.ts') ||
            normalizedId.includes('/src/utils/shfmt.ts')
          ) {
            return 'vendor-shell-analysis';
          }
        },
      },
    },
  },
}));
