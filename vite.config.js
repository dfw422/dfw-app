import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5176',
    },
  },
  build: {
    rollupOptions: {
      input: path.resolve(rootDir, 'index.html'),
    },
  },
})
