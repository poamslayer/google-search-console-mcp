import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse
} from '@modelcontextprotocol/server'
import { env } from 'cloudflare:workers'
import { createServer } from './server'

// The execute sandbox's outbound fetch goes through this entrypoint.
export { GscOutbound } from './tools/execute'

export const MCP_ROUTE = '/mcp'

const ALLOWED_HOSTNAMES = [...localhostAllowedHostnames()]
const ALLOWED_ORIGINS = [...localhostAllowedOrigins()]

// Stateless: a fresh server per request, and no subscriptions, so no SSE
// stream pins an isolate. Same choice as cloudflare/mcp src/mcp-handler.ts.
const handler = createMcpHandler(() => createServer(env), { maxSubscriptions: 0 })

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== MCP_ROUTE) return new Response('Not Found', { status: 404 })

    const rejected =
      hostHeaderValidationResponse(request, ALLOWED_HOSTNAMES) ??
      originValidationResponse(request, ALLOWED_ORIGINS)
    if (rejected) return rejected

    return handler.fetch(request)
  }
} satisfies ExportedHandler<Env>
