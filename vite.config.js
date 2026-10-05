import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: { exclude: ['oxigraph'] },
  server: { port: 5173, open: false },
})
