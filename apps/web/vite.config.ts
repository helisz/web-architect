import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  /**
   * 部署到 GitHub Pages 时站点在子路径下（/web-architect/），资源必须带同样的前缀。
   * 本地开发保持 `/`；CI 里由工作流传 VITE_BASE_PATH（见 .github/workflows/pages.yml）。
   */
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  // monorepo：环境变量文件放在仓库根（.env.local），而 Vite 默认只读 apps/web 下
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: {
    // 5173 在开发机上被别的项目占用；固定 5273 + strictPort，保证地址可预测
    port: 5273,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // supabase-js 体积大且首屏不需要抢跑，单独拆包
        manualChunks(id: string) {
          if (id.includes('@supabase/supabase-js')) return 'supabase';
          return undefined;
        },
      },
    },
  },
});