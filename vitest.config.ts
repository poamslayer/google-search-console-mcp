import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // A dummy token so tests never depend on a local .dev.vars.
        bindings: { GSC_ACCESS_TOKEN: 'test-access-token' }
      }
    })
  ],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/msw.ts']
  }
})
