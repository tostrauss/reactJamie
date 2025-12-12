import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // API Requests
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // WebSocket Requests
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true // Wichtig für WebSockets!
      }
    }
  }
})