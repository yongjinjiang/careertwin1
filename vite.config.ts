import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Local-only API: serves /api/* from the same shared server module the Vercel entries use.
 * Server env (non-VITE_ names) is read here and passed to the handler, never to the client bundle.
 */
function devApi(): Plugin {
  return {
    name: 'careertwin1-dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const { apiEnvironment, handleApiRequest } = await server.ssrLoadModule('/server/api.ts')
          const headers = new Headers()
          for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value)
          const response: Response = await handleApiRequest(new Request(new URL(req.url, 'http://127.0.0.1'), { method: req.method, headers }), apiEnvironment(env))
          res.statusCode = response.status
          response.headers.forEach((value, name) => res.setHeader(name, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end('{"error":"internal_error"}')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
  preview: { host: '127.0.0.1', port: 5182, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
})
