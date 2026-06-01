import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [
    vue(),
    tailwindcss(),
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap', // 还可选 'sunburst' / 'network'
      gzipSize: true,
      brotliSize: true,
      open: true,
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo workspace 把编译产物放在仓库根目录的 target/（不是 src-tauri/target/）。
      // Vite 不能监听这里：Windows 上被锁住的 calamex.exe 会触发 EBUSY 并使 dev server 崩溃。
      ignored: ['**/target/**', '**/src-tauri/**'],
    },
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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          // ── 核心框架 ────────────────────────────────────────────────────
          if (
            normalizedId.includes('/node_modules/vue/') ||
            normalizedId.includes('/node_modules/vue-router/') ||
            normalizedId.includes('/node_modules/pinia/')
          ) {
            return 'vendor-core';
          }

          // ── xterm ──────────────────────────────────────────────────────
          if (normalizedId.includes('/node_modules/@xterm/')) {
            return 'vendor-xterm';
          }

          // ── shell 分析 ─────────────────────────────────────────────────
          if (
            normalizedId.includes('/node_modules/web-tree-sitter/') ||
            normalizedId.includes('/node_modules/tree-sitter-bash/') ||
            normalizedId.includes('/node_modules/@wasm-fmt/shfmt/') ||
            normalizedId.includes('/src/utils/shell-completion.ts') ||
            normalizedId.includes('/src/constants/shell/command-catalog.ts') ||
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
