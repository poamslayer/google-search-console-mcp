// Structure adapted from cloudflare/mcp tests/auth/oauth-handler.test.ts (Apache-2.0).
// Modified by Arnold De La Vega: Google refresh behaviour.
import { GrantType, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { env } from 'cloudflare:workers'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTokenExchangeCallback } from '../../src/auth/handlers'
import { clearKv } from '../helpers/kv'
import { server } from '../setup/msw'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PROPS = {
  version: 1,
  user: { id: 'google-user-1', email: 'user@example.com' },
  accessToken: 'old-google-access-token',
  refreshToken: 'google-refresh-token',
  accessLevel: 'read-only'
}

let grantId: string
let grantSequence = 0
beforeEach(() => {
  grantId = `grant-${++grantSequence}`
})
afterEach(async () => {
  vi.restoreAllMocks()
  await clearKv(env.OAUTH_KV)
})

function helpers() {
  return { revokeGrant: vi.fn(async () => undefined) } as unknown as OAuthHelpers & {
    revokeGrant: ReturnType<typeof vi.fn>
  }
}

function refresh(getHelpers?: () => OAuthHelpers, grantType: GrantType = GrantType.REFRESH_TOKEN) {
  return handleTokenExchangeCallback(
    { grantType, clientId: 'mcp-client', userId: 'google-user-1', grantId, scope: ['read-only'], requestedScope: [], props: PROPS },
    'client-id',
    'client-secret',
    getHelpers
  )
}

describe('refreshing the Google token', () => {
  it('gets a new access token and keeps the refresh token when Google sends none', async () => {
    let form: URLSearchParams | undefined
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        form = new URLSearchParams(await request.text())
        return HttpResponse.json({ access_token: 'new-google-access-token', expires_in: 3599, token_type: 'Bearer' })
      })
    )
    expect(await refresh()).toEqual({
      newProps: { ...PROPS, accessToken: 'new-google-access-token' },
      accessTokenTTL: 3599
    })
    expect(form?.get('grant_type')).toBe('refresh_token')
    expect(form?.get('refresh_token')).toBe('google-refresh-token')
    expect(form?.get('client_id')).toBe('client-id')
    expect(form?.get('client_secret')).toBe('client-secret')
  })

  it('stores a new refresh token when Google rotates it', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: 'new-google-access-token', refresh_token: 'rotated-refresh-token', expires_in: 3599 })
      )
    )
    const result = await refresh()
    expect((result?.newProps as typeof PROPS).refreshToken).toBe('rotated-refresh-token')
  })

  it('revokes the grant when Google says invalid_grant', async () => {
    const h = helpers()
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })
      )
    )
    await expect(refresh(() => h)).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(h.revokeGrant).toHaveBeenCalledWith(grantId, 'google-user-1')
  })

  it('keeps the grant on other Google errors', async () => {
    const h = helpers()
    server.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ error: 'invalid_request', error_description: 'Bad request' }, { status: 400 }))
    )
    await expect(refresh(() => h)).rejects.toMatchObject({ code: 'invalid_request' })
    expect(h.revokeGrant).not.toHaveBeenCalled()
  })

  it('keeps the grant when Google is down', async () => {
    const h = helpers()
    server.use(http.post(TOKEN_URL, () => new HttpResponse('upstream error', { status: 503 })))
    await expect(refresh(() => h)).rejects.toMatchObject({ code: 'temporarily_unavailable' })
    expect(h.revokeGrant).not.toHaveBeenCalled()
  })

  it('does nothing for the first token exchange', async () => {
    expect(await refresh(undefined, GrantType.AUTHORIZATION_CODE)).toBeUndefined()
  })
})
