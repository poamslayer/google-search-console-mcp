import OAuthProvider, { getOAuthApi, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider'
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse
} from '@modelcontextprotocol/server'
import { createAuthHandlers, handleTokenExchangeCallback } from './auth/handlers'
import { AuthProps } from './auth/props'
import { createServer } from './server'

// The execute sandbox's outbound fetch goes through this entrypoint.
export { GscOutbound } from './tools/execute'

// Not exported: Workers accepts only handlers and entrypoints from the main module.
const MCP_ROUTE = '/mcp'
const PUBLIC_HOSTNAMES = ['google-search-console-mcp.arnolddlv-1e4.workers.dev', 'gsc.poamslayer.com']
const ALLOWED_HOSTNAMES = [...localhostAllowedHostnames(), ...PUBLIC_HOSTNAMES]
const ALLOWED_ORIGINS = [...localhostAllowedOrigins(), ...PUBLIC_HOSTNAMES]

/** Serves /mcp for a request the provider has already authenticated. */
const mcpHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = AuthProps.parse((ctx as ExecutionContext & { props: unknown }).props)
    // Stateless: a fresh server per request, and no subscriptions, so no SSE
    // stream pins an isolate. Same choice as cloudflare/mcp src/mcp-handler.ts.
    const handler = createMcpHandler(() => createServer(env, props), { maxSubscriptions: 0 })
    return handler.fetch(request)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === MCP_ROUTE) {
      const rejected =
        hostHeaderValidationResponse(request, ALLOWED_HOSTNAMES) ??
        originValidationResponse(request, ALLOWED_ORIGINS)
      if (rejected) return rejected
    }

    // Built per request so the refresh callback can reach env. Adapted from
    // cloudflare/mcp src/index.ts (Apache-2.0).
    const options: OAuthProviderOptions<Env> = {
      apiHandlers: { [MCP_ROUTE]: mcpHandler },
      defaultHandler: createAuthHandlers(),
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      clientIdMetadataDocumentEnabled: true,
      tokenExchangeCallback: (exchange) =>
        handleTokenExchangeCallback(
          exchange,
          env.GOOGLE_CLIENT_ID,
          env.GOOGLE_CLIENT_SECRET,
          // env.OAUTH_PROVIDER is not injected at the token endpoint, so the
          // helpers are built here, and only when a grant must be revoked.
          () => getOAuthApi(options, env)
        ),
      resourceMetadata: { resource: env.MCP_RESOURCE, resource_name: 'Search Console MCP' },
      accessTokenTTL: 3600,
      refreshTokenTTL: 30 * 24 * 60 * 60
    }
    return new OAuthProvider(options).fetch(request, env, ctx)
  }
} satisfies ExportedHandler<Env>
