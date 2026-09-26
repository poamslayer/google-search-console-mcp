import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { initialize } from './helpers/mcp'

describe('the MCP endpoint', () => {
  it('answers the MCP handshake at /mcp', async () => {
    const result = await initialize()
    expect(result.error).toBeUndefined()
    expect(result.result?.serverInfo?.name).toBe('google-search-console')
  })

  it('returns 404 for other paths', async () => {
    const res = await exports.default.fetch(new Request('http://localhost/other'))
    expect(res.status).toBe(404)
  })
})
