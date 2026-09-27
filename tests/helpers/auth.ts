// The flow helpers are adapted from cloudflare/mcp tests/auth/oauth-routes.test.ts
// (Apache-2.0). Modified by Arnold De La Vega: Google as the upstream.
import { exports } from 'cloudflare:workers'
import { http, HttpResponse } from 'msw'
import { expect } from 'vitest'
import { server } from '../setup/msw'

export const ORIGIN = 'http://localhost'
export const MCP_RESOURCE = `${ORIGIN}/mcp`
const REDIRECT_URI = 'https://app.example.com/cb'
// Fixed downstream PKCE pair (S256 of the verifier), as in cloudflare/mcp's tests.
const CODE_VERIFIER = 'test-downstream-code-verifier'
const CODE_CHALLENGE = 'I4fhllfHqqQsgap17V2SDI0scSei8H7U0e0rZBDIcbo'

export const READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const FULL_SCOPE = 'https://www.googleapis.com/auth/webmasters'

export interface LoginOptions {
  /** What the user picks on our consent page. */
  accessLevel?: 'read-only' | 'full'
  /** The Search Console scope Google actually grants. Defaults to the one asked for. */
  grantedScope?: string
  googleAccessToken?: string
  googleRefreshToken?: string
  sub?: string
  email?: string
}

export interface LoginResult {
  /** The MCP access token our server issued. */
  accessToken: string
  refreshToken: string
  clientId: string
  /** Where our server sent the browser at Google. */
  googleAuthorizeUrl: URL
}

export function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .filter(Boolean)
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

/** Register an MCP client through the provider's dynamic registration endpoint. */
async function registerClient(): Promise<string> {
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' })
    })
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { client_id: string }).client_id
}

/** Show the consent page and submit it. Returns the redirect to Google and the session cookie. */
export async function beginLogin(accessLevel: 'read-only' | 'full' = 'read-only') {
  const clientId = await registerClient()
  const authorize = new URL(`${ORIGIN}/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    resource: MCP_RESOURCE,
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256'
  })) {
    authorize.searchParams.set(key, value)
  }
  const consent = await exports.default.fetch(new Request(authorize))
  expect(consent.status).toBe(200)
  const html = await consent.text()
  const state = html.match(/name="state" value="([^"]+)"/)?.[1]
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)?.[1]
  expect(state && csrf).toBeTruthy()

  const submitted = await exports.default.fetch(
    new Request(`${ORIGIN}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiesFrom(consent) },
      body: new URLSearchParams({ state: state!, csrf_token: csrf!, access_level: accessLevel }).toString(),
      redirect: 'manual'
    })
  )
  expect(submitted.status).toBe(302)
  return {
    clientId,
    googleAuthorizeUrl: new URL(submitted.headers.get('location')!),
    sessionCookie: cookiesFrom(submitted)
  }
}

/** Fake Google's token and userinfo endpoints for one login. */
export function fakeGoogle(options: Required<Omit<LoginOptions, 'accessLevel'>> & { code: string }) {
  server.use(
    http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
      const form = new URLSearchParams(await request.text())
      if (form.get('grant_type') !== 'authorization_code' || form.get('code') !== options.code) return
      return HttpResponse.json({
        access_token: options.googleAccessToken,
        refresh_token: options.googleRefreshToken,
        expires_in: 3599,
        token_type: 'Bearer',
        scope: `openid https://www.googleapis.com/auth/userinfo.email ${options.grantedScope}`
      })
    }),
    http.get('https://openidconnect.googleapis.com/v1/userinfo', ({ request }) => {
      if (request.headers.get('Authorization') !== `Bearer ${options.googleAccessToken}`) return
      return HttpResponse.json({ sub: options.sub, email: options.email, email_verified: true })
    })
  )
}

/** Log in through the whole flow and return the MCP tokens our server issued. */
export async function login(options: LoginOptions = {}): Promise<LoginResult> {
  const accessLevel = options.accessLevel ?? 'read-only'
  const { clientId, googleAuthorizeUrl, sessionCookie } = await beginLogin(accessLevel)
  const code = `google-code-${crypto.randomUUID()}`
  fakeGoogle({
    code,
    grantedScope: options.grantedScope ?? (accessLevel === 'full' ? FULL_SCOPE : READ_ONLY_SCOPE),
    googleAccessToken: options.googleAccessToken ?? 'test-access-token',
    googleRefreshToken: options.googleRefreshToken ?? 'google-refresh-token',
    sub: options.sub ?? 'google-user-1',
    email: options.email ?? 'user@example.com'
  })

  const callback = await exports.default.fetch(
    new Request(
      `${ORIGIN}/oauth/callback?code=${code}&state=${googleAuthorizeUrl.searchParams.get('state')}`,
      { headers: { Cookie: sessionCookie }, redirect: 'manual' }
    )
  )
  expect(callback.status).toBe(302)
  const downstreamCode = new URL(callback.headers.get('location')!).searchParams.get('code')!

  const token = await exports.default.fetch(
    new Request(`${ORIGIN}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: downstreamCode,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: CODE_VERIFIER,
        resource: MCP_RESOURCE
      }).toString()
    })
  )
  expect(token.status).toBe(200)
  const body = (await token.json()) as { access_token: string; refresh_token: string }
  return { accessToken: body.access_token, refreshToken: body.refresh_token, clientId, googleAuthorizeUrl }
}
