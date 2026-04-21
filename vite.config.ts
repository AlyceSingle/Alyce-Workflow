import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': {}
  },
  build: {
    outDir: '.', // 输出到扩展根目录
    emptyOutDir: false, // 绝对不能清空目录！
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      name: 'AlyceWorkflow',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      external: [
        'st-script',
        'st-extensions',
        'st-context',
        'st-popup',
        'st-openai',
        'st-textgen',
        'st-nai',
        'st-kai'
      ],
      output: {
        paths: {
          'st-script': '../../../../script.js',
          'st-extensions': '../../../extensions.js',
          'st-context': '../../../st-context.js',
          'st-popup': '../../../popup.js',
          'st-openai': '../../../openai.js',
          'st-textgen': '../../../textgen-settings.js',
          'st-nai': '../../../nai-settings.js',
          'st-kai': '../../../kai-settings.js'
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'style.css';
          return assetInfo.name || 'asset.js';
        }
      }
    },
    minify: 'terser',
    sourcemap: false
  }
});
