import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The shipped policy in index.html forbids inline scripts and remote connections, which is
 * exactly what Vite's HMR client needs during development. Rather than shipping a loose
 * policy and hoping to remember to tighten it, the strict one is the default and this widens
 * it only while the dev server is running.
 */
function relaxCspForDev(): Plugin {
  return {
    name: 'airbridge-dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: http: https:">`
      )
  }
}

export default defineConfig({
  main: {
    // chokidar ships ESM only, and the main bundle is CommonJS because that is what Electron
    // preloads need. It is pure JavaScript, so Rollup can convert it on the way in — the
    // alternative is pinning an older major.
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar'] })],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), tailwindcss(), relaxCspForDev()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
