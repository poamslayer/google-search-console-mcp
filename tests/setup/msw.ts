// Adapted from cloudflare/mcp tests/setup/msw.ts (Apache-2.0). Modified by Arnold De La Vega.
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'

/**
 * The fake Search Console API. Outbound `fetch()` is the only thing tests mock.
 * The MCP transport, the Worker Loader and the outbound entrypoint run for real
 * in workerd. Register per-test handlers with `server.use(...)`.
 */
export const server = setupServer()

// Fail on any request that isn't mocked, so nothing reaches the real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
