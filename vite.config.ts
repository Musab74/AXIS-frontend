import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Connect } from 'vite'
import type { ServerResponse } from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Bare `/axis_manager` → `/axis_manager/` (Vite dev + preview). */
function axisManagerTrailingSlash(): Plugin {
  const redirect = (
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const raw = req.url ?? ''
    const pathOnly = raw.split('?')[0]
    if (pathOnly === '/axis_manager') {
      const qs = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
      res.writeHead(301, { Location: `/axis_manager/${qs}` })
      res.end()
      return
    }
    next()
  }
  return {
    name: 'axis-manager-trailing-slash',
    configureServer(server) {
      server.middlewares.use(redirect)
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect)
    },
  }
}

/** Bare `/axis_expert` → `/axis_expert/`. */
function axisExpertTrailingSlash(): Plugin {
  const redirect = (
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const raw = req.url ?? ''
    const pathOnly = raw.split('?')[0]
    if (pathOnly === '/axis_expert') {
      const qs = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
      res.writeHead(301, { Location: `/axis_expert/${qs}` })
      res.end()
      return
    }
    next()
  }
  return {
    name: 'axis-expert-trailing-slash',
    configureServer(server) {
      server.middlewares.use(redirect)
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect)
    },
  }
}

/**
 * Apache nosniff + wrong text/html MIME on subpath module URLs → blank portal pages.
 */
function fixSubpathModuleMimeTypes(): Plugin {
  return {
    name: 'fix-subpath-module-mime-types',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url ?? '').split('?')[0]
        const isModule =
          pathOnly.includes('/@vite/') ||
          pathOnly.includes('/@react-refresh') ||
          pathOnly.includes('/node_modules/') ||
          /\.(tsx?|jsx?|mjs|cjs|css)(?:\?|$)/.test(pathOnly)
        if (!isModule) return next()

        const setHeader = res.setHeader.bind(res)
        res.setHeader = (name: string, value: unknown) => {
          if (typeof name === 'string' && name.toLowerCase() === 'content-type') {
            const current = String(value)
            if (current.includes('text/html')) {
              const fixed =
                pathOnly.endsWith('.css') || pathOnly.includes('.css?')
                  ? 'text/css'
                  : 'text/javascript'
              return setHeader('Content-Type', fixed)
            }
          }
          return setHeader(name, value as string | number | readonly string[])
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    axisManagerTrailingSlash(),
    axisExpertTrailingSlash(),
    fixSubpathModuleMimeTypes(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@admin': resolve(__dirname, 'src/portals/admin'),
      '@expert': resolve(__dirname, 'src/portals/expert'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: ['axisexam.com', 'www.axisexam.com', 'm.k-hrd.com', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Inquiry attachments & other Nest static files (defense in depth for local/dev).
      '/uploads': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
})
