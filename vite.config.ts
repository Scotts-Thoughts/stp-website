import path from 'node:path'
import os from 'node:os'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Cache in OS temp dir to avoid EBUSY when project is in Dropbox and multiple devs run dev server
const cacheDir = path.join(os.tmpdir(), 'vite', 'stp-website')

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  cacheDir,
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    // Ensure assets use relative paths for Electron
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // Ensure chunk names don't have problematic characters
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
})
