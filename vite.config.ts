import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { bymonLanDiscoveryPlugin } from './vite.lanDiscovery'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), bymonLanDiscoveryPlugin()],
import { bymonLanRoomsPlugin } from './vite.lanRooms'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), bymonLanRoomsPlugin()],
})
