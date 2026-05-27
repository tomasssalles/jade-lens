import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { execSync } from 'node:child_process'

let buildSha = 'dev'
try {
  buildSha = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  // Not in a git checkout (or git unavailable); fall back to 'dev'.
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), svgr()],
  base: '/jade-lens/',
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
})