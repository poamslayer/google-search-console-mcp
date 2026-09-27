import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Dummy Google client values so tests never depend on a local .dev.vars,
        // a short execute time limit so the timeout test runs in a second, and
        // a daily cap small enough that the cap test stays quick.
        bindings: {
          GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'test-client-secret',
          MCP_RESOURCE: 'http://localhost/mcp',
          EXECUTE_TIMEOUT_MS: '1000',
          DAILY_EXECUTE_CAP: '20'
        }
      }
    })
  ],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/msw.ts']
  }
})
