import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

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
            const monacoPath = normalizedId.split('/node_modules/monaco-editor/esm/')[1] ?? '';
            const monacoContribMatch = monacoPath.match(/^vs\/editor\/contrib\/([^/]+)/);
            const monacoBaseMatch = monacoPath.match(/^vs\/base\/([^/]+)/);
            const monacoStandaloneMatch = monacoPath.match(/^vs\/editor\/standalone\/([^/]+)/);
            const monacoPlatformMatch = monacoPath.match(/^vs\/platform\/([^/]+)/);
            const monacoEditorBrowserMatch = monacoPath.match(/^vs\/editor\/browser\/([^/]+)/);
            const monacoEditorCommonMatch = monacoPath.match(/^vs\/editor\/common\/([^/]+)/);

            if (monacoContribMatch) {
              return `monaco-contrib-${monacoContribMatch[1]}`;
            }

            if (monacoBaseMatch) {
              return `monaco-base-${monacoBaseMatch[1]}`;
            }

            if (
              normalizedId.includes('/monaco-editor/esm/vs/editor/contrib/')
              || normalizedId.includes('/monaco-editor/esm/vs/editor/standalone/browser/quickAccess/')
            ) {
              return 'monaco-quickaccess';
            }

            if (
              normalizedId.includes('/monaco-editor/esm/vs/basic-languages/')
              || normalizedId.includes('/monaco-editor/esm/vs/language/')
            ) {
              return 'monaco-language';
            }

            if (monacoStandaloneMatch) {
              return 'monaco-standalone';
            }

            if (monacoPlatformMatch) {
              return 'monaco-platform';
            }

            if (monacoEditorBrowserMatch) {
              return 'monaco-editor-browser';
            }

            if (monacoEditorCommonMatch) {
              return 'monaco-editor-common';
            }

            return 'monaco-core';
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
